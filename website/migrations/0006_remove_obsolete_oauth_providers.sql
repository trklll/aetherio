DELETE FROM oauth_accounts WHERE provider IN ('discord', 'mal');
DELETE FROM oauth_states WHERE provider IN ('discord', 'mal');
