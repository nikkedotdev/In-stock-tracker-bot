# Product Title Labels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every bot message or inline button that identifies a tracked item show the product title first, with the site host only as fallback or secondary context.

**Architecture:** Keep the data model unchanged because tracks already persist `title` and `site_host`. Add one shared bot-side label formatter so acknowledgements, `/list`, remove flows, and variant flows all use the same title-first rule and the same fallback behavior when preview/title extraction fails.

**Tech Stack:** TypeScript, Cloudflare Workers, Telegram Bot API, Vitest

---

### Task 1: Add tests for title-first labels and host fallback

**Files:**
- Create: `tests/bot-labels.spec.ts`
- Modify: `tests/bot-variant.spec.ts`
- Reference: `tests/helpers/mockD1.ts`

**Step 1: Write the failing formatter/list test**

```ts
import { describe, expect, it } from 'vitest';
import { formatList, formatTrackingAck } from '../src/bot/formatter';
import type { Track } from '../src/core/types';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    user_id: 1,
    url: 'https://jellycat.com/zumblebi-alien/',
    url_hash: 'hash',
    site_host: 'jellycat.com',
    title: 'Zumblebi Alien',
    price: null,
    variant_summary: null,
    variant_id: null,
    variant_label: null,
    variant_options: null,
    status: 'UNKNOWN',
    status_conf_count: 0,
    fail_count: 0,
    backoff_sec: 60,
    needs_manual: 0,
    etag: null,
    content_sig: null,
    created_at: '2026-03-18T00:00:00.000Z',
    last_checked_at: null,
    next_check_at: null,
    ...overrides,
  };
}

describe('bot labels', () => {
  it('uses title first in tracking acknowledgement and /list output', () => {
    expect(formatTrackingAck(1, 'Zumblebi Alien', 'jellycat.com')).toContain('**Zumblebi Alien** (jellycat.com)');
    expect(formatList([makeTrack()])).toContain('#1 Zumblebi Alien | jellycat.com | UNKNOWN | --');
  });

  it('falls back to host when title is missing', () => {
    expect(formatTrackingAck(1, 'jellycat.com', 'jellycat.com')).toContain('**jellycat.com**');
    expect(formatList([makeTrack({ title: null })])).toContain('#1 jellycat.com | UNKNOWN | --');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot-labels.spec.ts`
Expected: FAIL because `formatTrackingAck` still only accepts `host`, and `/list` still renders `track.site_host`.

**Step 3: Add handler-level failing tests for picker/remove surfaces**

```ts
it('uses title-first labels in remove and variant pickers', async () => {
  const userId = await repo.upsertUser('123');
  await repo.insertTrack(userId, 'https://one.example/item', 'jellycat.com', 'h1', null, {
    variantOptions: JSON.stringify(sampleOptions('Small', 'Medium')),
  });
  await repo.updateAfterCheck(1, { title: 'Zumblebi Alien' });

  await handler.handle(messageUpdate('/variant'));
  await handler.handle(messageUpdate('/remove'));

  const messages = endpointBodies(fetchMock, '/sendMessage');
  expect(JSON.stringify(messages)).toContain('Zumblebi Alien');
});
```

**Step 4: Run the handler test to verify it fails**

Run: `npm test -- tests/bot-variant.spec.ts`
Expected: FAIL because picker button labels still use `track.site_host`.

**Step 5: Commit**

```bash
git add tests/bot-labels.spec.ts tests/bot-variant.spec.ts
git commit -m "test: cover title-first track labels"
```

### Task 2: Centralize tracked-item display labels

**Files:**
- Create: `src/bot/labels.ts`
- Modify: `src/bot/formatter.ts`
- Test: `tests/bot-labels.spec.ts`

**Step 1: Write the minimal shared helper**

```ts
import type { Track } from '../core/types';

type TrackLabelSource = Pick<Track, 'title' | 'site_host' | 'variant_label'>;

export function getTrackDisplayName(track: Pick<Track, 'title' | 'site_host'>): string {
  const title = track.title?.trim();
  return title && title.length > 0 ? title : track.site_host;
}

export function getTrackDisplayLabel(track: TrackLabelSource, includeHost = true): string {
  const name = getTrackDisplayName(track);
  const variant = track.variant_label ? ` [${track.variant_label}]` : '';
  if (!includeHost || name === track.site_host) return `${name}${variant}`;
  return `${name}${variant} (${track.site_host})`;
}
```

**Step 2: Update formatter functions to use the helper**

```ts
export function formatTrackingAck(order: number, displayName: string, host: string): string {
  const label = displayName === host ? `**${host}**` : `**${displayName}** (${host})`;
  return `Tracking #${order}: ${label} - I will notify you when it is available.`;
}
```

Also update `/list`, remove confirmation, and any formatter output that currently uses `track.site_host` as the identifier.

**Step 3: Run focused tests**

Run: `npm test -- tests/bot-labels.spec.ts`
Expected: PASS

**Step 4: Run broader bot tests**

Run: `npm test -- tests/bot-variant.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/labels.ts src/bot/formatter.ts tests/bot-labels.spec.ts tests/bot-variant.spec.ts
git commit -m "feat(bot): centralize title-first track labels"
```

### Task 3: Update handler flows and inline keyboards to use shared labels everywhere

**Files:**
- Modify: `src/bot/handlers.ts`
- Modify: `src/bot/formatter.ts`
- Test: `tests/bot-variant.spec.ts`
- Test: `tests/bot-labels.spec.ts`

**Step 1: Update new-track acknowledgement flow**

Change the acknowledgement call in `handleTrack` to pass title-aware values from `preview`:

```ts
const displayName = preview?.title?.trim() || siteHost;
await sendTelegramMessage(this.deps.env, chatId, formatTrackingAck(index, displayName, siteHost), 'Markdown');
```

**Step 2: Update variant prompts and selection confirmation**

Use the tracked title instead of host in:

```ts
formatVariantPrompt(index, displayName, siteHost, variantOptions)
this.formatVariantPickerMessage(trackIdx + 1, displayName, track.site_host)
`Tracking #${trackIdx + 1}: now monitoring **${displayName}** [${option.label}]`
```

Keep the variant label additive, not a replacement for the product identity.

**Step 3: Update remove/variant button labels**

Refactor these helpers to use the shared label function:

```ts
function formatRemoveButtonLabel(track: Track, order: number): string {
  const raw = `#${order} ${getTrackDisplayLabel(track, false)}`;
  return raw.length <= 50 ? raw : `${raw.slice(0, 47)}...`;
}

function formatVariantTrackButtonLabel(track: Track, order: number): string {
  const raw = `#${order} ${getTrackDisplayLabel(track, false)}`;
  return raw.length <= 60 ? raw : `${raw.slice(0, 57)}...`;
}
```

**Step 4: Run the affected test suite**

Run: `npm test -- tests/bot-labels.spec.ts tests/bot-variant.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/handlers.ts src/bot/formatter.ts src/bot/labels.ts tests/bot-labels.spec.ts tests/bot-variant.spec.ts
git commit -m "feat(bot): show product titles across track flows"
```

### Task 4: Verify no host-only identifiers remain in active track UX

**Files:**
- Modify: `src/bot/formatter.ts`
- Modify: `src/bot/handlers.ts`
- Reference: `README.md`

**Step 1: Search for remaining host-only labels**

Run: `rg -n "site_host|Tracking #|Choose a tracked URL|Removed tracking" src/bot`
Expected: Review each remaining occurrence and keep host-only output only where it is fallback or secondary context.

**Step 2: Update any missed copy**

Examples to check:

```ts
formatRemoveConfirmation(...)
private formatVariantPickerMessage(...)
formatVariantPrompt(...)
```

**Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS

**Step 4: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/formatter.ts src/bot/handlers.ts README.md
git commit -m "chore: verify title-first track messaging"
```
