-- Primary store for query popularity.
-- query_text is normalized (trimmed, lower-cased, single-spaced) before insert.
CREATE TABLE IF NOT EXISTS queries (
  query_text TEXT PRIMARY KEY,
  count      BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- text_pattern_ops lets B-tree serve `query_text LIKE 'prefix%'` as a range scan
-- even though the DB's default collation would otherwise prevent index use for LIKE.
CREATE INDEX IF NOT EXISTS idx_queries_prefix ON queries (query_text text_pattern_ops);

-- Helps the ORDER BY count DESC when a prefix matches many rows.
CREATE INDEX IF NOT EXISTS idx_queries_count ON queries (count DESC);
