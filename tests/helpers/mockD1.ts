import type { Track } from '../../src/core/types';

interface UserRow {
  id: number;
  tg_user_id: string;
  created_at: string;
}

interface TrackRow extends Track {}

export class MockD1Database implements D1Database {
  private users: UserRow[] = [];
  private tracks: TrackRow[] = [];
  private userSeq = 1;
  private trackSeq = 1;

  prepare(query: string) {
    return {
      bind: (...params: unknown[]) => {
        const bound = params;
        return {
          run: async () => this.execRun(query, bound),
          all: async () => ({ results: this.execSelect(query, bound) }),
          first: async () => this.execSelect(query, bound)[0] ?? null,
        };
      },
    } as D1PreparedStatement;
  }

  dump(): ArrayBuffer {
    return new ArrayBuffer(0);
  }

  async batch(statements: D1PreparedStatement[]) {
    const results: D1Result<unknown>[] = [];
    for (const stmt of statements) {
      const runner = stmt as unknown as { run: () => Promise<D1Result<unknown>> };
      results.push((await runner.run()) ?? {});
    }
    return results;
  }

  private execRun(query: string, params: unknown[]) {
    return this.routeRun(query, params);
  }

  private execSelect(query: string, params: unknown[]) {
    return this.route(query, params);
  }

  private routeRun(query: string, params: unknown[]): D1Result<unknown> {
    if (query === 'DELETE FROM tracks WHERE user_id = ?') {
      const userId = Number(params[0]);
      const before = this.tracks.length;
      this.tracks = this.tracks.filter((t) => t.user_id !== userId);
      return { meta: { changes: before - this.tracks.length } } as D1Result<unknown>;
    }

    this.route(query, params);
    return {};
  }

  private route(query: string, params: unknown[]): unknown[] {
    if (query.startsWith('INSERT INTO users')) {
      const tgId = String(params[0]);
      let user = this.users.find((u) => u.tg_user_id === tgId);
      if (!user) {
        user = { id: this.userSeq++, tg_user_id: tgId, created_at: new Date().toISOString() };
        this.users.push(user);
      }
      return [user];
    }

    if (query.startsWith('INSERT INTO tracks')) {
      const [userId, url, host, hash, variantId, variantLabel, variantOptions, nextCheck] = params as [
        number,
        string,
        string,
        string,
        string | null,
        string | null,
        string | null,
        string | null,
      ];
      const row: TrackRow = {
        id: this.trackSeq++,
        user_id: Number(userId),
        url,
        site_host: host,
        url_hash: hash,
        status: 'UNKNOWN',
        status_conf_count: 0,
        fail_count: 0,
        backoff_sec: 60,
        needs_manual: 0,
        last_http_status: null,
        last_error_kind: null,
        state_reason: null,
        created_at: new Date().toISOString(),
        last_checked_at: null,
        next_check_at: nextCheck,
        title: null,
        price: null,
        variant_summary: null,
        variant_id: variantId,
        variant_label: variantLabel,
        variant_options: variantOptions,
        etag: null,
        content_sig: null,
      };
      this.tracks.push(row);
      return [row];
    }

    if (query.startsWith('SELECT * FROM tracks WHERE user_id = ? ORDER BY id')) {
      const [userId] = params as [number];
      return this.tracks.filter((t) => t.user_id === Number(userId)).sort((a, b) => a.id - b.id).slice(0, 3);
    }

    if (query.startsWith('SELECT * FROM tracks WHERE user_id = ? AND url_hash')) {
      const [userId, hash] = params as [number, string];
      const track = this.tracks.find((t) => t.user_id === Number(userId) && t.url_hash === hash);
      return track ? [track] : [];
    }

    if (query.startsWith('SELECT tracks.*, users.tg_user_id')) {
      const [nowISO, limit] = params as [string, number];
      const cutoff = new Date(nowISO).getTime();
      const rows = this.tracks
        .filter((t) => t.next_check_at && new Date(t.next_check_at).getTime() <= cutoff)
        .sort((a, b) => {
          if (!a.next_check_at && !b.next_check_at) return 0;
          if (!a.next_check_at) return -1;
          if (!b.next_check_at) return 1;
          return new Date(a.next_check_at).getTime() - new Date(b.next_check_at).getTime();
        })
        .slice(0, Number(limit))
        .map((t) => ({ ...t, tg_user_id: this.users.find((u) => u.id === t.user_id)?.tg_user_id ?? '' }));
      return rows;
    }

    if (query.startsWith('UPDATE tracks SET')) {
      const setClause = query.split('SET')[1].split('WHERE')[0].trim();
      const fields = setClause.split(',').map((s) => s.trim().split('=')[0].trim());
      const values = params.slice(0, fields.length);
      const trackId = Number(params[fields.length]);
      const track = this.tracks.find((t) => t.id === trackId);
      if (track) {
        fields.forEach((field, idx) => {
          Reflect.set(track, field, values[idx] ?? null);
        });
      }
      return [];
    }

    if (query === 'DELETE FROM tracks WHERE id = ?') {
      const trackId = Number(params[0]);
      this.tracks = this.tracks.filter((t) => t.id !== trackId);
      return [];
    }

    if (query.startsWith('SELECT COUNT(*) as count FROM tracks')) {
      const [userId] = params as [number];
      const count = this.tracks.filter((t) => t.user_id === Number(userId)).length;
      return [{ count }];
    }

    if (query === 'DELETE FROM tracks WHERE user_id = ?') {
      const userId = Number(params[0]);
      this.tracks = this.tracks.filter((t) => t.user_id !== userId);
      return [];
    }

    return [];
  }
}
