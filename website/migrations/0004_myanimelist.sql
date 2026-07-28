ALTER TABLE oauth_states ADD COLUMN pkce_verifier TEXT;

ALTER TABLE oauth_accounts ADD COLUMN provider_username TEXT;
ALTER TABLE oauth_accounts ADD COLUMN access_token_ciphertext TEXT;
ALTER TABLE oauth_accounts ADD COLUMN refresh_token_ciphertext TEXT;
ALTER TABLE oauth_accounts ADD COLUMN token_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS oauth_accounts_provider_user_idx
  ON oauth_accounts(provider, user_id);
