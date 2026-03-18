import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotHandler } from '../src/bot/handlers';
import { TrackRepository } from '../src/db/repos';
import { D1Client } from '../src/db/d1';
import { MockD1Database } from './helpers/mockD1';
import type { EnvBindings, TelegramUpdate } from '../src/core/types';

describe('/list', () => {
  let db: MockD1Database;
  let repo: TrackRepository;
  let handler: BotHandler;
  let env: EnvBindings;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new MockD1Database();
    repo = new TrackRepository(new D1Client(db));
    env = {
      D1_DB: db,
      TELEGRAM_BOT_TOKEN: 'test-token',
    };
    handler = new BotHandler({ repo, env });
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends /list as plain text without markdown parse mode', async () => {
    const userId = await repo.upsertUser('123');
    const trackId = await repo.insertTrack(userId, 'https://jellycat.com/zumblebi-alien/', 'jellycat.com', 'h1', null, {});
    await repo.updateAfterCheck(trackId, {
      title: 'Zumblebi Alien',
      status: 'AVAILABLE',
      last_checked_at: '2026-03-18T10:14:54.933Z',
    });

    await handler.handle(messageUpdate('/list'));

    const messages = endpointBodies(fetchMock, '/sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('#1 Zumblebi Alien');
    expect(messages[0].text).not.toContain('```');
    expect(messages[0].parse_mode).toBeUndefined();
  });
});

function messageUpdate(text: string): TelegramUpdate {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 123 },
      chat: { id: 456, type: 'private' },
      date: Date.now(),
      text,
    },
  };
}

function endpointBodies(
  fetchMock: ReturnType<typeof vi.fn>,
  endpoint: string
): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes(endpoint))
    .map(([, init]) => {
      const body = (init as RequestInit | undefined)?.body;
      return JSON.parse(typeof body === 'string' ? body : '{}');
    });
}
