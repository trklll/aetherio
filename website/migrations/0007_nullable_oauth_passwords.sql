PRAGMA foreign_keys = OFF;

CREATE TABLE users_v2 (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (password_hash IS NULL AND password_salt IS NULL AND password_iterations IS NULL)
    OR
    (password_hash IS NOT NULL AND password_salt IS NOT NULL AND password_iterations IS NOT NULL)
  )
);

INSERT INTO users_v2 (
  id, email, display_name, password_hash, password_salt,
  password_iterations, created_at, updated_at
)
SELECT
  id,
  email,
  display_name,
  CASE WHEN password_iterations = 1 THEN NULL ELSE password_hash END,
  CASE WHEN password_iterations = 1 THEN NULL ELSE password_salt END,
  CASE WHEN password_iterations = 1 THEN NULL ELSE password_iterations END,
  created_at,
  updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_v2 RENAME TO users;

PRAGMA foreign_keys = ON;
