import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotHandler } from '../src/bot/handlers';
import { TrackRepository } from '../src/db/repos';
import { D1Client } from '../src/db/d1';
import { MockD1Database } from './helpers/mockD1';
import type { EnvBindings, TelegramUpdate, VariantOption } from '../src/core/types';
import { parseCommand } from '../src/bot/commands';
import { previewProduct } from '../src/bot/preview';

vi.mock('../src/bot/preview', () => ({
  previewProduct: vi.fn(),
}));

const previewProductMock = vi.mocked(previewProduct);

describe('variant picker flows', () => {
  let db: MockD1Database;
  let repo: TrackRepository;
  let handler: BotHandler;
  let env: EnvBindings;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
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

  it('parses /variant without arguments', async () => {
    await expect(parseCommand('/variant')).resolves.toEqual({ type: 'variant' });
  });

  it('sends tap-to-select variant buttons when a new URL has multiple variants', async () => {
    previewProductMock.mockResolvedValue({
      status: 'UNKNOWN',
      signals: {
        ctaTexts: [],
        ctaEnabled: false,
        oosTexts: [],
        soonTexts: [],
        variantOptions: [
          { id: 'size_s', label: 'Small', available: false },
          { id: 'size_m', label: 'Medium', available: true },
        ],
      },
      variantsSummary: 'Small, Medium',
      title: 'Test Item',
      price: '£10',
    });

    await handler.handle(messageUpdate('https://shop.example/item'));

    const messages = endpointBodies(fetchMock, '/sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].reply_markup.inline_keyboard).toHaveLength(2);
    expect(messages[0].reply_markup.inline_keyboard[0][0].callback_data).toBe('variant-pick:1:0');

    const userId = await repo.upsertUser('123');
    const tracks = await repo.getActiveTracksByUser(userId);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].next_check_at).toBeNull();
    expect(tracks[0].variant_id).toBeNull();
  });

  it('opens URL-first picker for /variant when multiple tracked URLs have variants', async () => {
    const userId = await repo.upsertUser('123');
    const firstTrackId = await repo.insertTrack(userId, 'https://one.example/item', 'one.example', 'h1', null, {
      variantOptions: JSON.stringify(sampleOptions('S', 'M')),
    });
    const secondTrackId = await repo.insertTrack(userId, 'https://two.example/item', 'two.example', 'h2', null, {
      variantOptions: JSON.stringify(sampleOptions('Red', 'Blue')),
    });
    await repo.updateAfterCheck(firstTrackId, { title: 'Zumblebi Alien' });
    await repo.updateAfterCheck(secondTrackId, { title: 'Bashful Cream Bunny' });

    await handler.handle(messageUpdate('/variant'));

    const messages = endpointBodies(fetchMock, '/sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('Choose a tracked URL first');
    expect(messages[0].reply_markup.inline_keyboard).toHaveLength(2);
    expect(messages[0].reply_markup.inline_keyboard[0][0].text).toContain('Zumblebi Alien');
    expect(messages[0].reply_markup.inline_keyboard[1][0].text).toContain('Bashful Cream Bunny');
    expect(messages[0].reply_markup.inline_keyboard[0][0].callback_data).toBe('variant-track:1');
    expect(messages[0].reply_markup.inline_keyboard[1][0].callback_data).toBe('variant-track:2');
  });

  it('uses title-first labels in remove picker buttons', async () => {
    const userId = await repo.upsertUser('123');
    const trackId = await repo.insertTrack(userId, 'https://one.example/item', 'one.example', 'h1', null, {});
    await repo.updateAfterCheck(trackId, { title: 'Zumblebi Alien' });

    await handler.handle(messageUpdate('/remove'));

    const messages = endpointBodies(fetchMock, '/sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].reply_markup.inline_keyboard[0][0].text).toContain('Zumblebi Alien');
  });

  it('supports callback flow: choose URL then variant', async () => {
    const userId = await repo.upsertUser('123');
    const trackId = await repo.insertTrack(userId, 'https://one.example/item', 'one.example', 'h1', null, {
      variantOptions: JSON.stringify([
        { id: 'v1', label: 'Small', available: false },
        { id: 'v2', label: 'Large', available: true },
      ]),
    });

    await handler.handle(callbackUpdate(`variant-track:${trackId}`, 'cb-track', 10));

    let messages = endpointBodies(fetchMock, '/sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].reply_markup.inline_keyboard[0][0].callback_data).toBe(`variant-pick:${trackId}:0`);
    expect(messages[0].reply_markup.inline_keyboard[1][0].callback_data).toBe(`variant-pick:${trackId}:1`);

    fetchMock.mockClear();
    await handler.handle(callbackUpdate(`variant-pick:${trackId}:1`, 'cb-pick', 11));

    const tracks = await repo.getActiveTracksByUser(userId);
    expect(tracks[0].variant_id).toBe('v2');
    expect(tracks[0].variant_label).toBe('Large');
    expect(tracks[0].next_check_at).not.toBeNull();

    messages = endpointBodies(fetchMock, '/sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('Tracking #1: now monitoring **one.example** [Large]');
  });
});

function sampleOptions(first: string, second: string): VariantOption[] {
  return [
    { id: first.toLowerCase(), label: first, available: false },
    { id: second.toLowerCase(), label: second, available: true },
  ];
}

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

function callbackUpdate(data: string, callbackId: string, messageId: number): TelegramUpdate {
  return {
    update_id: 2,
    callback_query: {
      id: callbackId,
      from: { id: 123 },
      data,
      message: {
        message_id: messageId,
        chat: { id: 456, type: 'private' },
      },
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
