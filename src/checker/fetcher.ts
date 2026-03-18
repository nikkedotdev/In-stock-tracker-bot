import { ACCEPT_LANGUAGE, DEFAULT_REQUEST_TIMEOUT_MS, USER_AGENT } from '../core/config';
import { FetchError } from '../core/errors';
import { Track, EnvBindings } from '../core/types';

export interface FetchOutcome {
  status: 'ok' | 'not-modified';
  html?: string;
  headers: Headers;
}

export async function fetchTrack(track: Track, env: EnvBindings): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timeoutMs = Number(env.REQUEST_TIMEOUT_MS ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = new Headers({
      'User-Agent': USER_AGENT,
      'Accept-Language': ACCEPT_LANGUAGE,
    });
    if (track.etag) headers.set('If-None-Match', track.etag);

    const res = await fetch(track.url, { headers, signal: controller.signal });
    if (res.status === 304) {
      return { status: 'not-modified', headers: res.headers };
    }
    if (!res.ok) {
      throw await toFetchError(res);
    }
    const html = await res.text();
    return { status: 'ok', html, headers: res.headers };
  } catch (err) {
    if (err instanceof FetchError) throw err;
    throw classifyUnknownFetchError(err);
  } finally {
    clearTimeout(timeout);
  }
}

async function toFetchError(res: Response): Promise<FetchError> {
  const status = res.status;
  const cfMitigated = res.headers.get('cf-mitigated');

  if (status === 429) {
    return new FetchError('Request failed', {
      status,
      kind: 'HTTP',
      stateReason: 'RATE_LIMITED',
    });
  }

  if (status === 403) {
    const body = await res.text().catch(() => '');
    const isChallenge =
      cfMitigated === 'challenge' ||
      /cf-challenge|captcha|attention required|please enable javascript/i.test(body);

    return new FetchError('Request failed', {
      status,
      kind: 'HTTP',
      stateReason: isChallenge ? 'CLOUDFLARE_CHALLENGE' : 'FETCH_BLOCKED',
    });
  }

  return new FetchError('Request failed', {
    status,
    kind: 'HTTP',
  });
}

function classifyUnknownFetchError(err: unknown): FetchError {
  const message = err instanceof Error ? err.message : 'Unknown fetch failure';
  const name = err instanceof Error ? err.name : '';

  if (name === 'AbortError') {
    return new FetchError(message, {
      kind: 'TIMEOUT',
      stateReason: 'TIMEOUT',
    });
  }

  if (err instanceof TypeError) {
    return new FetchError(message, {
      kind: 'NETWORK',
      stateReason: 'NETWORK_ERROR',
    });
  }

  return new FetchError(message, {
    kind: 'UNKNOWN_ERROR',
  });
}
