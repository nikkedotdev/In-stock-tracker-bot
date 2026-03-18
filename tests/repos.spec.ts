import { describe, it, expect, beforeEach } from 'vitest';
import { TrackRepository } from '../src/db/repos';
import { D1Client } from '../src/db/d1';
import { MockD1Database } from './helpers/mockD1';

let repo: TrackRepository;

beforeEach(() => {
  repo = new TrackRepository(new D1Client(new MockD1Database()));
});

describe('TrackRepository', () => {
  it('inserts and lists tracks per user', async () => {
    const userId = await repo.upsertUser('123');
    await repo.insertTrack(userId, 'https://e.com/1', 'e.com', 'hash1', new Date().toISOString());
    await repo.insertTrack(userId, 'https://e.com/2', 'e.com', 'hash2', new Date().toISOString());
    const tracks = await repo.getActiveTracksByUser(userId);
    expect(tracks).toHaveLength(2);
  });

  it('stores diagnostic fields with null defaults and persists updates', async () => {
    const userId = await repo.upsertUser('123');
    const trackId = await repo.insertTrack(userId, 'https://e.com/1', 'e.com', 'hash1', new Date().toISOString());

    let tracks = await repo.getActiveTracksByUser(userId);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(trackId);
    expect(tracks[0].last_http_status).toBeNull();
    expect(tracks[0].last_error_kind).toBeNull();
    expect(tracks[0].state_reason).toBeNull();

    await repo.updateAfterCheck(trackId, {
      last_http_status: 403,
      last_error_kind: 'HTTP',
      state_reason: 'CLOUDFLARE_CHALLENGE',
    });

    tracks = await repo.getActiveTracksByUser(userId);
    expect(tracks[0].last_http_status).toBe(403);
    expect(tracks[0].last_error_kind).toBe('HTTP');
    expect(tracks[0].state_reason).toBe('CLOUDFLARE_CHALLENGE');
  });

  it('returns due tracks ordered by next_check_at', async () => {
    const userId = await repo.upsertUser('123');
    const now = new Date('2024-01-01T00:00:00Z');
    await repo.insertTrack(userId, 'https://e.com/1', 'e.com', 'hash1', new Date(now.getTime() - 1000).toISOString());
    await repo.insertTrack(
      userId,
      'https://e.com/2',
      'e.com',
      'hash2',
      new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    );
    const due = await repo.getDueTracks(now.toISOString(), 10);
    expect(due).toHaveLength(1);
    expect(due[0].url).toContain('/1');
  });

  it('deletes tracks and reports count for deleteAllByUser', async () => {
    const userId = await repo.upsertUser('123');
    await repo.insertTrack(userId, 'https://e.com/1', 'e.com', 'hash1', new Date().toISOString());
    await repo.insertTrack(userId, 'https://e.com/2', 'e.com', 'hash2', new Date().toISOString());
    const removed = await repo.deleteAllByUser(userId);
    expect(removed).toBe(2);
    const tracks = await repo.getActiveTracksByUser(userId);
    expect(tracks).toHaveLength(0);
  });
});
