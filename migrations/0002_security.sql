-- Browser-bound OAuth flow id (must match HttpOnly cookie at callback)
ALTER TABLE oauth_states ADD COLUMN flow_id TEXT;

-- Simple abuse controls for unauthenticated start endpoint
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_flow ON oauth_states(flow_id);
