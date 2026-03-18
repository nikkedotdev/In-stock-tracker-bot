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
  it('uses title first in tracking acknowledgement', () => {
    const ack = (formatTrackingAck as unknown as (order: number, displayName: string, host: string) => string)(
      1,
      'Zumblebi Alien',
      'jellycat.com'
    );

    expect(ack).toBe('Tracking #1: **Zumblebi Alien** (jellycat.com) - I will notify you when it is available.');
  });

  it('uses title first in /list output and falls back to host when missing', () => {
    const list = formatList([makeTrack(), makeTrack({ id: 2, title: null })]);

    expect(list).toBe(
      [
        '#1 Zumblebi Alien',
        'jellycat.com • UNKNOWN',
        'Last checked: --',
        '',
        '#2 jellycat.com',
        'UNKNOWN',
        'Last checked: --',
      ].join('\n')
    );
  });

  it('does not show select variant when variant options are empty', () => {
    const list = formatList([makeTrack({ variant_options: '[]' })]);

    expect(list).toBe(['#1 Zumblebi Alien', 'jellycat.com • UNKNOWN', 'Last checked: --'].join('\n'));
    expect(list).not.toContain('[select variant]');
  });
});
