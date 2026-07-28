CREATE TABLE IF NOT EXISTS app_releases (
  version TEXT PRIMARY KEY,
  version_major INTEGER NOT NULL,
  version_minor INTEGER NOT NULL,
  version_patch INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  installer_url TEXT NOT NULL,
  installer_size INTEGER,
  installer_sha256 TEXT NOT NULL,
  signature_current TEXT NOT NULL,
  signature_legacy TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS app_releases_version_idx
  ON app_releases(version_major DESC, version_minor DESC, version_patch DESC);
