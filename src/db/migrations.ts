import { D1Client } from './d1';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_user_id TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  site_host TEXT NOT NULL,
  title TEXT,
  price TEXT,
  variant_summary TEXT,
  variant_id TEXT,
  variant_label TEXT,
  variant_options TEXT,
  status TEXT CHECK(status IN ('UNKNOWN','NOT_AVAILABLE','COMING_SOON','AVAILABLE','ERROR')) DEFAULT 'UNKNOWN',
  status_conf_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  backoff_sec INTEGER DEFAULT 60,
  needs_manual INTEGER DEFAULT 0,
  last_http_status INTEGER,
  last_error_kind TEXT,
  state_reason TEXT,
  etag TEXT,
  content_sig TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_checked_at DATETIME,
  next_check_at DATETIME,
  UNIQUE(user_id, url_hash)
);

CREATE INDEX IF NOT EXISTS idx_tracks_due ON tracks(next_check_at);
CREATE INDEX IF NOT EXISTS idx_tracks_host ON tracks(site_host);
CREATE INDEX IF NOT EXISTS idx_tracks_user ON tracks(user_id);
`;

export async function runMigrations(client: D1Client): Promise<void> {
  const statements = SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await client.prepare(stmt).run();
  }

  const columns: Array<{ name: string; sql: string }> = [
    { name: 'variant_id', sql: 'ALTER TABLE tracks ADD COLUMN variant_id TEXT' },
    { name: 'variant_label', sql: 'ALTER TABLE tracks ADD COLUMN variant_label TEXT' },
    { name: 'variant_options', sql: 'ALTER TABLE tracks ADD COLUMN variant_options TEXT' },
    { name: 'last_http_status', sql: 'ALTER TABLE tracks ADD COLUMN last_http_status INTEGER' },
    { name: 'last_error_kind', sql: 'ALTER TABLE tracks ADD COLUMN last_error_kind TEXT' },
    { name: 'state_reason', sql: 'ALTER TABLE tracks ADD COLUMN state_reason TEXT' },
  ];

  for (const column of columns) {
    const exists = await client
      .prepare<{ name: string }>("SELECT name FROM pragma_table_info('tracks') WHERE name = ?")
      .first([column.name]);
    if (!exists) {
      await client.prepare(column.sql).run();
    }
  }
}
