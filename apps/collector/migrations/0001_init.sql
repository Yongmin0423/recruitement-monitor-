CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source = 'saramin'),
  query TEXT NOT NULL,
  region TEXT,
  exclude_keywords_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  region TEXT,
  career TEXT,
  tags TEXT,
  posted_label TEXT,
  url TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  saved INTEGER NOT NULL DEFAULT 0 CHECK (saved IN (0, 1)),
  read_at TEXT,
  PRIMARY KEY (source, source_id)
);

CREATE TABLE IF NOT EXISTS search_jobs (
  search_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  matched_at TEXT NOT NULL,
  notified_at TEXT,
  is_initial INTEGER NOT NULL DEFAULT 0 CHECK (is_initial IN (0, 1)),
  PRIMARY KEY (search_id, source, source_id),
  FOREIGN KEY (search_id) REFERENCES searches(id) ON DELETE CASCADE,
  FOREIGN KEY (source, source_id) REFERENCES jobs(source, source_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id TEXT PRIMARY KEY,
  search_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  pages_read INTEGER NOT NULL DEFAULT 0,
  cards_seen INTEGER NOT NULL DEFAULT 0,
  new_matches INTEGER NOT NULL DEFAULT 0,
  browser_ms INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  FOREIGN KEY (search_id) REFERENCES searches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collection_locks (
  search_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (search_id) REFERENCES searches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_jobs_matched ON search_jobs(search_id, matched_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_started ON collection_runs(started_at DESC);
