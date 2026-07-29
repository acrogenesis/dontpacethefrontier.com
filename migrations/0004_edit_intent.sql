-- OAuth intent: 'sign' (new) or 'edit' (update existing after re-auth)
ALTER TABLE oauth_states ADD COLUMN intent TEXT NOT NULL DEFAULT 'sign';

-- Track last edit time (created_at remains first signature)
ALTER TABLE signatories ADD COLUMN updated_at TEXT;
