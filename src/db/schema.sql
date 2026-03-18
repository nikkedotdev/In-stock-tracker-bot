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
