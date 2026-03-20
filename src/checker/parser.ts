import { ScrapeResult, ScrapeSignals } from '../core/types';
import { applyProfile } from '../profiles';
import { determineStatus } from './normaliser';

const CTA_PATTERN = '(add to (bag|basket|cart)|buy now|checkout|add to trolley)';
const CTA_REGEX = new RegExp(CTA_PATTERN, 'gi');
const CTA_DISABLED_REGEX = /(disabled|aria-disabled="?true"?)/i;
const OOS_REGEX = /(out of stock|sold out|currently unavailable|notify me when in stock)/gi;
const SOON_REGEX = /(coming soon|pre-?order|launches)/gi;
const CTA_KEYWORDS = ['add to bag', 'add to basket', 'add to cart', 'buy now', 'checkout'];

export function parsePage(html: string, host: string, headers: Headers): ScrapeResult {
  const signals: ScrapeSignals = {
    ctaTexts: findMatches(html, CTA_REGEX),
    ctaEnabled: detectCtaEnabled(html),
    oosTexts: findMatches(html, OOS_REGEX),
    soonTexts: findMatches(html, SOON_REGEX),
    schemaAvailability: extractSchemaAvailability(html),
    inStockFlag: extractInStockFlag(html),
    variantsAvailable: extractVariants(html),
    variantOptions: undefined,
    title: extractTitle(html),
    priceText: extractPrice(html),
  };

  const profile = applyProfile(host, html, headers);
  if (profile.signals) {
    Object.assign(signals, profile.signals);
  }
  if (profile.variantOptions) {
    signals.variantOptions = profile.variantOptions;
  }

  const variantsSummary = profile.variantsSummary ?? signals.variantsAvailable?.join(', ');

  return {
    status: profile.statusHint ?? determineStatus(signals, 'UNKNOWN'),
    variantsSummary,
    price: profile.price ?? signals.priceText,
    title: profile.title ?? signals.title,
    signals,
  };
}

function findMatches(html: string, regex: RegExp): string[] {
  const clone = new RegExp(regex.source, regex.flags);
  const matches = [...html.matchAll(clone)].map((match) => match[0]);
  if (!matches) return [];
  return [...new Set(matches.map((m) => cleanText(m)))];
}

function cleanText(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, '').trim());
}

function detectCtaEnabled(html: string): boolean {
  const tagRegex = /<(button|a)\b([^>]*)>(.*?)<\/\1>/gis;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    const [, , attrsRaw, innerRaw] = match;
    if (CTA_DISABLED_REGEX.test(attrsRaw) || /class="[^"]*(disabled|unavailable)[^"]*"/i.test(attrsRaw)) {
      continue;
    }
    const attrs = extractAttributes(attrsRaw);
    const candidates = [
      cleanText(innerRaw),
      attrs['aria-label'],
      attrs['title'],
      attrs['data-label'],
      attrs['data-text'],
      attrs['data-action'],
      attrs['data-add-to-cart'],
      attrs['data-button-text'],
    ]
      .filter(Boolean)
      .map((value) => value!.toLowerCase());
    if (CTA_KEYWORDS.some((kw) => candidates.some((text) => text.includes(kw)))) {
      return true;
    }
  }

  const inputRegex = /<input\b([^>]*)>/gi;
  while ((match = inputRegex.exec(html)) !== null) {
    const [, attrsRaw] = match;
    if (CTA_DISABLED_REGEX.test(attrsRaw) || /class="[^"]*(disabled|unavailable)[^"]*"/i.test(attrsRaw)) {
      continue;
    }
    const attrs = extractAttributes(attrsRaw);
    const candidates = [
      attrs.value,
      attrs['aria-label'],
      attrs['title'],
      attrs['data-label'],
      attrs['data-text'],
      attrs['data-action'],
      attrs['data-add-to-cart'],
      attrs['data-button-text'],
    ]
      .filter(Boolean)
      .map((value) => value!.toLowerCase());
    if (CTA_KEYWORDS.some((kw) => candidates.some((text) => text.includes(kw)))) {
      return true;
    }
  }
  return false;
}

function extractAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][\w:.-]*)\s*=\s*"(.*?)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    attrs[key] = cleanText(match[2]);
  }
  return attrs;
}

function extractSchemaAvailability(html: string): string | undefined {
  const scripts = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (!scripts) return undefined;
  for (const script of scripts) {
    try {
      const jsonText = script.replace(/^[^>]*>/, '').replace(/<\/script>$/, '');
      const data = JSON.parse(jsonText.trim());
      const offers = Array.isArray(data.offers) ? data.offers : [data.offers];
      for (const offer of offers) {
        if (offer && typeof offer === 'object' && offer.availability) {
          return String(offer.availability);
        }
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractInStockFlag(html: string): boolean | undefined {
  const match = html.match(/"inStock"\s*:\s*(true|false)/i);
  if (match) return match[1].toLowerCase() === 'true';
  return undefined;
}

function extractVariants(html: string): string[] | undefined {
  const optionMatches = html.match(/<option[^>]+>/gi);
  if (!optionMatches) return undefined;
  const available: string[] = [];
  for (const opt of optionMatches) {
    const disabled = /disabled/i.test(opt) || /unavailable/i.test(opt);
    if (disabled) continue;
    const labelMatch = opt.match(/>([^<]+)</);
    if (labelMatch) available.push(cleanText(labelMatch[1]));
  }
  return available.length ? available : undefined;
}

function extractTitle(html: string): string | undefined {
  const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (og) return og[1].trim();
  const title = html.match(/<title>([^<]+)<\/title>/i);
  if (title) return cleanText(title[1]);
  const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1) return cleanText(h1[1]);
  return undefined;
}

function extractPrice(html: string): string | undefined {
  const meta = html.match(/<meta[^>]+itemprop="price"[^>]+content="([^"]+)"/i);
  if (meta) return meta[1];
  const og = html.match(/<meta[^>]+property="og:price:amount"[^>]+content="([^"]+)"/i);
  if (og) return og[1];
  const priceText = html.match(/£\s?\d+[\d.,]*/);
  if (priceText) return priceText[0];
  return undefined;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
