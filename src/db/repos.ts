import { D1Client } from './d1';
import { Track, TrackUpdatePatch } from '../core/types';

export class TrackRepository {
  constructor(private client: D1Client) {}

  async upsertUser(tgUserId: string): Promise<number> {
    const sql =
      'INSERT INTO users (tg_user_id) VALUES (?) ON CONFLICT(tg_user_id) DO UPDATE SET tg_user_id = excluded.tg_user_id RETURNING id';
    const stmt = this.client.prepare<{ id: number }>(sql);
    const res = await stmt.first([tgUserId]);
    if (!res) throw new Error('Failed to upsert user');
    return res.id;
  }

  async insertTrack(
    userId: number,
    url: string,
    host: string,
    hash: string,
    nextCheckISO: string | null,
    extras?: { variantId?: string | null; variantLabel?: string | null; variantOptions?: string | null }
  ): Promise<number> {
    const sql =
      'INSERT INTO tracks (user_id, url, site_host, url_hash, status, status_conf_count, fail_count, backoff_sec, variant_id, variant_label, variant_options, next_check_at) VALUES (?,?,?,?,"UNKNOWN",0,0,60,?,?,?,?) RETURNING id';
    const stmt = this.client.prepare<{ id: number }>(sql);
    const res = await stmt.first([
      userId,
      url,
      host,
      hash,
      extras?.variantId ?? null,
      extras?.variantLabel ?? null,
      extras?.variantOptions ?? null,
      nextCheckISO,
    ]);
    if (!res) throw new Error('Failed to insert track');
    return res.id;
  }

  async getActiveTracksByUser(userId: number): Promise<Track[]> {
    const sql = 'SELECT * FROM tracks WHERE user_id = ? ORDER BY id ASC LIMIT 3';
    const stmt = this.client.prepare<Track>(sql);
    const { results } = await stmt.all([userId]);
    return results;
  }

  async getTrackByUserAndHash(userId: number, hash: string): Promise<Track | null> {
    const sql = 'SELECT * FROM tracks WHERE user_id = ? AND url_hash = ? LIMIT 1';
    const stmt = this.client.prepare<Track>(sql);
    return stmt.first([userId, hash]);
  }

  async getDueTracks(nowISO: string, limit: number): Promise<(Track & { tg_user_id: string })[]> {
    const sql =
      'SELECT tracks.*, users.tg_user_id FROM tracks JOIN users ON tracks.user_id = users.id WHERE tracks.next_check_at IS NOT NULL AND tracks.next_check_at <= ? ORDER BY tracks.next_check_at ASC LIMIT ?';
    const stmt = this.client.prepare<Track & { tg_user_id: string }>(sql);
    const { results } = await stmt.all([nowISO, limit]);
    return results;
  }

  async updateAfterCheck(trackId: number, patch: TrackUpdatePatch): Promise<void> {
    const entries = Object.entries(patch);
    if (entries.length === 0) return;

    const sets = entries.map(([key]) => `${key} = ?`);
    const sql = `UPDATE tracks SET ${sets.join(', ')} WHERE id = ?`;
    const params = [...entries.map(([, value]) => value ?? null), trackId];
    await this.client.prepare(sql).run(params);
  }

  async deleteTrack(trackId: number): Promise<void> {
    await this.client.prepare('DELETE FROM tracks WHERE id = ?').run([trackId]);
  }

  async deleteAllByUser(userId: number): Promise<number> {
    const result = await this.client.prepare('DELETE FROM tracks WHERE user_id = ?').run([userId]);
    // D1Result exposes meta.changes with the number of rows affected
    return (result as unknown as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  }
}
