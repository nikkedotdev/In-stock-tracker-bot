const MARKETING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'yclid',
  'gbraid',
  'wbraid',
]);

export interface NormalisedUrl {
  normalizedUrl: string;
  siteHost: string;
  urlHash: string;
}

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const data = encoder.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 127) return true;                        // 127.x.x.x loopback
  if (a === 10) return true;                         // 10.x.x.x private
  if (a === 192 && b === 168) return true;           // 192.168.x.x private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16-31.x.x private
  if (a === 169 && b === 254) return true;           // 169.254.x.x link-local/metadata
  if (a === 0) return true;                          // 0.x.x.x
  return false;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Named loopback and special addresses
  if (h === 'localhost' || h === '0.0.0.0') return true;

  // Strip IPv6 brackets for numeric checks
  const bare = h.replace(/^\[|\]$/g, '');

  // Parse dotted-decimal IPv4
  const parts = bare.split('.');
  if (parts.length === 4) {
    const octets = parts.map(Number);
    if (octets.every((o) => !Number.isNaN(o) && o >= 0 && o <= 255)) {
      return isPrivateIPv4(octets);
    }
  }

  // IPv6: loopback (::1) and unspecified (::)
  if (bare === '::1' || bare === '::') return true;

  // IPv4-mapped IPv6 dotted-quad form: ::ffff:x.x.x.x
  const ipv4Mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) {
    const embeddedOctets = ipv4Mapped[1].split('.').map(Number);
    if (embeddedOctets.every((o) => !Number.isNaN(o) && o >= 0 && o <= 255)) {
      return isPrivateIPv4(embeddedOctets);
    }
  }

  // IPv4-mapped IPv6 hex form: ::ffff:XXXX:XXXX (WHATWG canonical form)
  // e.g. ::ffff:127.0.0.1 is canonicalized to ::ffff:7f00:1 by the URL parser
  const ipv4MappedHex = bare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (ipv4MappedHex) {
    const high = parseInt(ipv4MappedHex[1], 16);
    const low = parseInt(ipv4MappedHex[2], 16);
    return isPrivateIPv4([(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff]);
  }

  // ULA: fc00::/7 — starts with fc or fd
  if (/^f[cd][0-9a-f]{0,2}:/i.test(bare)) return true;

  // Link-local: fe80::/10 — starts with fe8x, fe9x, feax, febx
  if (/^fe[89ab][0-9a-f]?:/i.test(bare)) return true;

  return false;
}

export async function normaliseUrl(raw: string): Promise<NormalisedUrl> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL must be http/https');
  }

  if (isPrivateHost(url.hostname)) {
    throw new Error('URL points to a private or reserved address');
  }

  url.hash = '';

  const params = Array.from(url.searchParams.entries()).filter(([key]) => {
    if (key.startsWith('utm_')) return false;
    if (MARKETING_PARAMS.has(key)) return false;
    return true;
  });

  params.sort(([a], [b]) => a.localeCompare(b));

  url.search = '';
  for (const [key, value] of params) {
    url.searchParams.append(key, value);
  }

  const normalizedUrl = url.toString();
  const siteHost = url.host.toLowerCase();
  const urlHash = await sha256Hex(normalizedUrl);
  return { normalizedUrl, siteHost, urlHash };
}

export async function hashContent(value: string): Promise<string> {
  return sha256Hex(value);
}
