-- Signatories: identity verified via X (Twitter) OAuth
CREATE TABLE IF NOT EXISTS signatories (
  id TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL UNIQUE,
  x_handle TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  company TEXT,
  title TEXT,
  comment TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_signatories_created ON signatories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signatories_company ON signatories(company);
CREATE INDEX IF NOT EXISTS idx_signatories_handle ON signatories(x_handle);

-- OAuth PKCE state + optional form draft (company, comment, etc.)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  company TEXT,
  title TEXT,
  comment TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_expires ON oauth_states(expires_at);
