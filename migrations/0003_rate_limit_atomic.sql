-- Prefer integer window timestamps for atomic rate-limit upserts.
-- Recreate table (ephemeral abuse-control data only).
DROP TABLE IF EXISTS rate_limits;

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start_ms);
