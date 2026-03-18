import { describe, expect, it } from 'vitest';
import { D1Client } from '../src/db/d1';
import { runMigrations } from '../src/db/migrations';

describe('runMigrations', () => {
  it('adds diagnostic columns to an existing tracks table when they are missing', async () => {
    const db = new MigrationMockD1Database();
    const client = new D1Client(db as unknown as D1Database);

    await runMigrations(client);

    expect(db.addedColumns).toEqual([
      'variant_id',
      'variant_label',
      'variant_options',
      'last_http_status',
      'last_error_kind',
      'state_reason',
    ]);
  });
});

class MigrationMockD1Database {
  readonly addedColumns: string[] = [];
  private readonly existingColumns = new Set([
    'id',
    'user_id',
    'url',
    'url_hash',
    'site_host',
    'title',
    'price',
    'variant_summary',
    'status',
    'status_conf_count',
    'fail_count',
    'backoff_sec',
    'needs_manual',
    'etag',
    'content_sig',
    'created_at',
    'last_checked_at',
    'next_check_at',
  ]);

  prepare(query: string) {
    return {
      bind: (...params: unknown[]) => {
        const bound = params;
        return {
          run: async () => this.execRun(query, bound),
          all: async () => ({ results: [] }),
          first: async () => this.execFirst(query, bound),
        };
      },
    };
  }

  private execRun(query: string, params: unknown[]) {
    void params;
    const alterMatch = /ALTER TABLE tracks ADD COLUMN ([a-z_]+)/i.exec(query);
    if (alterMatch) {
      const column = alterMatch[1];
      this.existingColumns.add(column);
      this.addedColumns.push(column);
    }
    return {};
  }

  private execFirst(query: string, params: unknown[]) {
    if (query === "SELECT name FROM pragma_table_info('tracks') WHERE name = ?") {
      const name = String(params[0]);
      return this.existingColumns.has(name) ? { name } : null;
    }
    return null;
  }
}
