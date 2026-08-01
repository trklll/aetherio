-- Archivo histórico completo de premiaciones.
-- Manifest por edición (qué se espera importar y qué huecos son legítimos),
-- staging versionado (un swap solo se publica si la edición parseada es válida)
-- y huellas de importación por lote para reanudar backfills.

CREATE TABLE IF NOT EXISTS award_edition_manifest (
  ceremony TEXT NOT NULL,
  edition INTEGER NOT NULL,
  award_year INTEGER NOT NULL,
  coverage_expected TEXT NOT NULL DEFAULT 'complete' CHECK (coverage_expected IN ('complete', 'partial', 'gap')),
  gap_type TEXT CHECK (gap_type IN ('canceled', 'no_archive', 'blocked')),
  primary_url TEXT NOT NULL,
  extra_sources_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ceremony, edition)
);
CREATE INDEX IF NOT EXISTS idx_award_manifest_expected ON award_edition_manifest (coverage_expected);

CREATE TABLE IF NOT EXISTS award_import_batches (
  id TEXT PRIMARY KEY,
  ceremony TEXT NOT NULL,
  edition INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  source_tier TEXT NOT NULL DEFAULT 'official',
  checksum TEXT NOT NULL,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'staged' CHECK (outcome IN ('staged', 'committed', 'rejected', 'failed')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  committed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_award_batches_edition ON award_import_batches (ceremony, edition);

CREATE TABLE IF NOT EXISTS award_records_staging (
  batch_id TEXT NOT NULL,
  import_key TEXT NOT NULL,
  id TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, import_key)
);
CREATE INDEX IF NOT EXISTS idx_award_staging_edition ON award_records_staging (ceremony, edition);

ALTER TABLE award_media_links ADD COLUMN matched_title TEXT;
ALTER TABLE award_media_links ADD COLUMN matched_year INTEGER;
ALTER TABLE award_media_links ADD COLUMN last_attempted_at TEXT;
