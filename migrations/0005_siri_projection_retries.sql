-- Retry metadata only: GitHub remains the sole source of page content.
CREATE TABLE IF NOT EXISTS siri_projection_retries (
  file_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  queued_at TEXT NOT NULL
);
