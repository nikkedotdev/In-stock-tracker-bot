import { ProfileResult, SiteProfile } from '..';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../core/config';
import { logger } from '../../core/logging';

const GROOBEE_API = 'https://shop.api.groobee.com';

interface GroobeeSearchProduct {
  slug: string;
  name: string;
  price: number;
  isSoldOut: boolean;
  imageUrl?: string;
}

interface GroobeeSearchResponse {
  _embedded?: { products?: GroobeeSearchProduct[] };
  total?: number;
}

/**
 * Extracts the site code from a friedpotato.com hostname.
 * e.g. "ado-officialshop-friedpotato.com" → "ado-officialshop"
 * Returns null if the extracted code contains invalid characters.
 */
export function extractSiteCode(host: string): string | null {
  const code = host.replace(/-friedpotato\.com$/, '');
  // Reject codes with characters that could cause header injection
  if (!code || /[\r\n\0]/.test(code)) return null;
  return code;
}

/**
 * Extracts the product slug from a friedpotato.com URL path.
 * e.g. "/products/Ado26Ao_015" → "Ado26Ao_015"
 */
export function extractProductSlug(url: string): string | null {
  const match = url.match(/\/products\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Calls the Groobee search API and returns stock status for a given product slug.
 */
export async function checkFriedpotatoStock(
  url: string,
  host: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<ProfileResult> {
  const siteCode = extractSiteCode(host);
  const slug = extractProductSlug(url);
  if (!siteCode || !slug) return {};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const searchUrl = `${GROOBEE_API}/products/search?per_page=50&current_page=1`;
    const res = await fetch(searchUrl, {
      headers: {
        'X-Bet-Site-Code': siteCode,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) return {};

    const data = (await res.json()) as GroobeeSearchResponse;
    const products = data._embedded?.products;
    if (!products) return {};

    const product = products.find((p) => p.slug === slug);
    if (!product) {
      // Product might be on a later page — check up to 4 pages
      for (let page = 2; page <= 4; page++) {
        const pageRes = await fetch(
          `${GROOBEE_API}/products/search?per_page=50&current_page=${page}`,
          {
            headers: { 'X-Bet-Site-Code': siteCode, Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        if (!pageRes.ok) break;
        const pageData = (await pageRes.json()) as GroobeeSearchResponse;
        const found = pageData._embedded?.products?.find((p) => p.slug === slug);
        if (found) {
          return toProfileResult(found);
        }
        if (!pageData._embedded?.products?.length) break;
      }
      return {};
    }

    return toProfileResult(product);
  } catch (err) {
    logger.warn('friedpotato API check failed', { url, host, error: (err as Error).message });
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

function toProfileResult(product: GroobeeSearchProduct): ProfileResult {
  return {
    statusHint: product.isSoldOut ? 'NOT_AVAILABLE' : 'AVAILABLE',
    title: product.name,
    price: `¥${new Intl.NumberFormat('ja-JP').format(product.price)}`,
  };
}

export const friedpotatoProfile: SiteProfile = {
  hosts: ['friedpotato.com'],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parse(html: string): ProfileResult {
    // HTML parse is a no-op for this site; stock check is done via API in scheduler.
    // This profile exists so hasDedicatedProfile() returns true.
    return {};
  },
};
