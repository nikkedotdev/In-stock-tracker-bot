import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTrack } from '../src/checker/fetcher';
import { FetchError } from '../src/core/errors';
import type { EnvBindings, Track } from '../src/core/types';

const baseTrack: Track = {
  id: 1,
  user_id: 1,
  url: 'https://jellycat.com/test-product/',
  url_hash: 'hash1',
  site_host: 'jellycat.com',
  status: 'UNKNOWN',
  status_conf_count: 0,
  fail_count: 0,
  backoff_sec: 60,
  needs_manual: 0,
  last_http_status: null,
  last_error_kind: null,
  state_reason: null,
  created_at: '2026-03-18T00:00:00.000Z',
  last_checked_at: null,
  next_check_at: null,
};

const env: EnvBindings = {
  D1_DB: {} as D1Database,
  TELEGRAM_BOT_TOKEN: 'token',
  REQUEST_TIMEOUT_MS: '5',
};

describe('fetchTrack', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves HTTP status and classifies Cloudflare challenges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('blocked', {
          status: 403,
          headers: {
            'cf-mitigated': 'challenge',
          },
        })
      )
    );

    await expect(fetchTrack(baseTrack, env)).rejects.toMatchObject<Partial<FetchError>>({
      status: 403,
      kind: 'HTTP',
      stateReason: 'CLOUDFLARE_CHALLENGE',
    });
  });

  it('classifies aborted requests as timeouts', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          })
      )
    );

    const pending = fetchTrack(baseTrack, env);
    const assertion = expect(pending).rejects.toMatchObject<Partial<FetchError>>({
      status: undefined,
      kind: 'TIMEOUT',
      stateReason: 'TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});
