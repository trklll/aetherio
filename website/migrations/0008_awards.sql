-- Catálogo centralizado de premiaciones (AWARDS_DB)
-- Fuentes oficiales: Oscar, BAFTA, Golden Globes, Emmy, Goya,
-- Japan Academy Prize, Crunchyroll Anime Awards, Cannes, Venice y Mar del Plata.

CREATE TABLE IF NOT EXISTS award_editions (
  ceremony TEXT NOT NULL,
  edition INTEGER NOT NULL,
  award_year INTEGER NOT NULL,
  coverage TEXT NOT NULL DEFAULT 'complete' CHECK (coverage IN ('complete', 'partial')),
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'stale', 'parser_failed')),
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  checksum TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ceremony, edition)
);
CREATE INDEX IF NOT EXISTS idx_award_editions_year ON award_editions (award_year);

CREATE TABLE IF NOT EXISTS award_records (
  id TEXT PRIMARY KEY,
  ceremony TEXT NOT NULL,
  edition INTEGER NOT NULL,
  award_year INTEGER NOT NULL,
  category_es TEXT NOT NULL,
  category_original TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('winner', 'nominee', 'official_selection')),
  subject TEXT NOT NULL CHECK (subject IN ('work', 'person', 'episode', 'song', 'technical')),
  recipients TEXT NOT NULL DEFAULT '[]',
  work_title TEXT NOT NULL,
  work_year INTEGER,
  work_key TEXT NOT NULL,
  section TEXT,
  source_url TEXT NOT NULL,
  source_tier TEXT NOT NULL DEFAULT 'official' CHECK (source_tier IN ('official', 'secondary')),
  import_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_award_records_work ON award_records (work_key);
CREATE INDEX IF NOT EXISTS idx_award_records_ceremony ON award_records (ceremony, edition);

CREATE TABLE IF NOT EXISTS award_media_links (
  id TEXT PRIMARY KEY,
  work_key TEXT NOT NULL UNIQUE,
  work_title TEXT NOT NULL,
  work_year INTEGER,
  media_type TEXT CHECK (media_type IN ('movie', 'tv', 'anime')),
  tmdb_id INTEGER,
  imdb_id TEXT,
  anilist_id INTEGER,
  resolve_status TEXT NOT NULL DEFAULT 'pending' CHECK (resolve_status IN ('pending', 'resolved', 'ambiguous', 'unresolved', 'secondary')),
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_award_media_tmdb ON award_media_links (tmdb_id);
CREATE INDEX IF NOT EXISTS idx_award_media_imdb ON award_media_links (imdb_id);
CREATE INDEX IF NOT EXISTS idx_award_media_anilist ON award_media_links (anilist_id);

CREATE TABLE IF NOT EXISTS award_aliases (
  id TEXT PRIMARY KEY,
  work_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'original',
  UNIQUE (work_key, alias_norm)
);
CREATE INDEX IF NOT EXISTS idx_award_aliases_norm ON award_aliases (alias_norm);

CREATE TABLE IF NOT EXISTS award_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  scope TEXT NOT NULL DEFAULT 'manual',
  outcome TEXT NOT NULL DEFAULT 'running',
  records_imported INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  editions_ok INTEGER NOT NULL DEFAULT 0,
  editions_failed INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

-- Casos ambiguos de resolución de identidades, pendientes de revisión humana.
CREATE TABLE IF NOT EXISTS award_resolution_review (
  id TEXT PRIMARY KEY,
  work_key TEXT NOT NULL,
  work_title TEXT NOT NULL,
  work_year INTEGER,
  media_type TEXT,
  candidates_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_award_review_reviewed ON award_resolution_review (reviewed);
