-- Siri/macOS projection: a durable content revision plus an append-only
-- change feed lets a local Spotlight index catch up without polling GitHub.
ALTER TABLE files ADD COLUMN content_revision TEXT;

CREATE TABLE IF NOT EXISTS siri_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  file_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  content_revision TEXT,
  changed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_siri_changes_sequence
  ON siri_changes(sequence);
