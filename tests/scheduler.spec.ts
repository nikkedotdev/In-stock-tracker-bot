import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { D1Client } from '../src/db/d1';
import { TrackRepository } from '../src/db/repos';
import { MockD1Database } from './helpers/mockD1';
import type { EnvBindings } from '../src/core/types';
import { FetchError } from '../src/core/errors';

vi.mock('../src/checker/fetcher', () => ({
  fetchTrack: vi.fn(),
}));

vi.mock('../src/bot/handlers', () => ({
  sendTelegramMessage: vi.fn(),
}));

vi.mock('../src/telemetry/metrics', () => ({
  recordMetric: vi.fn(),
}));

vi.mock('../src/telemetry/audit', () => ({
  recordAudit: vi.fn(),
}));

vi.mock('../src/core/logging', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchTrack } from '../src/checker/fetcher';
import { handleCron } from '../src/checker/scheduler';
import { sendTelegramMessage } from '../src/bot/handlers';

const fetchTrackMock = vi.mocked(fetchTrack);
const sendTelegramMessageMock = vi.mocked(sendTelegramMessage);

describe('handleCron diagnostics', () => {
  let db: MockD1Database;
  let repo: TrackRepository;
  let env: EnvBindings;

  beforeEach(() => {
    vi.resetAllMocks();
    db = new MockD1Database();
    repo = new TrackRepository(new D1Client(db));
    env = {
      D1_DB: db,
      TELEGRAM_BOT_TOKEN: 'token',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists cloudflare challenge details on HTTP 403 failures', async () => {
    const userId = await repo.upsertUser('123');
    await repo.insertTrack(userId, 'https://jellycat.com/test-product/', 'jellycat.com', 'hash1', '2024-01-01T00:00:00.000Z');
    fetchTrackMock.mockRejectedValue(
      new FetchError('Request failed', {
        status: 403,
        kind: 'HTTP',
        stateReason: 'CLOUDFLARE_CHALLENGE',
      })
    );

    await handleCron(env);

    const [track] = await repo.getActiveTracksByUser(userId);
    expect(track.status).toBe('ERROR');
    expect(track.last_http_status).toBe(403);
    expect(track.last_error_kind).toBe('HTTP');
    expect(track.state_reason).toBe('CLOUDFLARE_CHALLENGE');
  });

  it('persists rate-limit details on HTTP 429 failures', async () => {
    const userId = await repo.upsertUser('123');
    await repo.insertTrack(userId, 'https://jellycat.com/test-product/', 'jellycat.com', 'hash1', '2024-01-01T00:00:00.000Z');
    fetchTrackMock.mockRejectedValue(
      new FetchError('Request failed', {
        status: 429,
        kind: 'HTTP',
        stateReason: 'RATE_LIMITED',
      })
    );

    await handleCron(env);

    const [track] = await repo.getActiveTracksByUser(userId);
    expect(track.status).toBe('ERROR');
    expect(track.last_http_status).toBe(429);
    expect(track.last_error_kind).toBe('HTTP');
    expect(track.state_reason).toBe('RATE_LIMITED');
  });

  it('sends an informational notice when a track first enters manual review', async () => {
    const userId = await repo.upsertUser('123');
    const trackId = await repo.insertTrack(userId, 'https://jellycat.com/test-product/', 'jellycat.com', 'hash1', '2024-01-01T00:00:00.000Z');
    await repo.updateAfterCheck(trackId, {
      title: 'Test Product',
      last_checked_at: '2024-01-01T00:00:00.000Z',
    });
    fetchTrackMock.mockResolvedValue({
      status: 'ok',
      url: 'https://jellycat.com/test-product/',
      finalUrl: 'https://jellycat.com/test-product/',
      html: '<html><body><h1>Test Product</h1><p>captcha</p></body></html>',
      headers: new Headers(),
    });

    await handleCron(env);

    expect(sendTelegramMessageMock).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessageMock).toHaveBeenCalledWith(
      env,
      123,
      expect.stringContaining('may be blocked or unreliable right now')
    );

    const [track] = await repo.getActiveTracksByUser(userId);
    expect(track.state_reason).toBe('MANUAL_REVIEW');
  });
});
