-- Migration 0003: add deprecated column to files table.
-- Pages with `status: deprecated` or `deprecated: true` in frontmatter
-- get deprecated=1 on ingest, which triggers a score penalty in retrieve
-- so they sink below fresh content without being removed from the index.
ALTER TABLE files ADD COLUMN deprecated INTEGER NOT NULL DEFAULT 0;
