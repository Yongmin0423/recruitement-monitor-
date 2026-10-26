ALTER TABLE searches ADD COLUMN backfill_next_page INTEGER NOT NULL DEFAULT 1;
ALTER TABLE searches ADD COLUMN backfill_cutoff TEXT;
ALTER TABLE searches ADD COLUMN backfill_complete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE searches ADD COLUMN backfill_old_streak INTEGER NOT NULL DEFAULT 0;

ALTER TABLE jobs ADD COLUMN posted_at TEXT;
ALTER TABLE jobs ADD COLUMN deadline_label TEXT;
ALTER TABLE jobs ADD COLUMN deadline_date TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at DESC);
