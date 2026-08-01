-- Identidades verificadas de destinatarios y relaciones por registro.
-- Las relaciones se crean para todos los recipients, sin depender de subject.

CREATE TABLE IF NOT EXISTS award_people (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  canonical_name_norm TEXT NOT NULL,
  tmdb_id INTEGER UNIQUE,
  imdb_id TEXT UNIQUE,
  wikidata_id TEXT UNIQUE,
  anilist_staff_id INTEGER UNIQUE,
  resolution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending', 'resolved', 'ambiguous', 'unresolved')),
  resolution_reason TEXT,
  confidence REAL,
  matched_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_award_people_name_norm ON award_people (canonical_name_norm);
CREATE INDEX IF NOT EXISTS idx_award_people_status ON award_people (resolution_status);

CREATE TABLE IF NOT EXISTS award_person_aliases (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import',
  UNIQUE (person_id, alias_norm)
);
CREATE INDEX IF NOT EXISTS idx_award_person_aliases_norm ON award_person_aliases (alias_norm);

CREATE TABLE IF NOT EXISTS award_record_people (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  recipient_index INTEGER NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_norm TEXT NOT NULL,
  person_id TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (resolution_status IN ('pending', 'resolved', 'ambiguous', 'unresolved')),
  resolution_reason TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (record_id, recipient_index)
);
CREATE INDEX IF NOT EXISTS idx_award_record_people_person ON award_record_people (person_id);
CREATE INDEX IF NOT EXISTS idx_award_record_people_record ON award_record_people (record_id);
CREATE INDEX IF NOT EXISTS idx_award_record_people_status ON award_record_people (resolution_status);
CREATE INDEX IF NOT EXISTS idx_award_record_people_norm ON award_record_people (recipient_norm);

CREATE TABLE IF NOT EXISTS award_record_people_staging (
  batch_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  recipient_index INTEGER NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_norm TEXT NOT NULL,
  PRIMARY KEY (batch_id, record_id, recipient_index)
);
CREATE INDEX IF NOT EXISTS idx_award_record_people_staging_batch ON award_record_people_staging (batch_id);

-- Bootstrap idempotente de registros ya importados antes de esta migración.
INSERT INTO award_record_people
  (id, record_id, recipient_index, recipient_name, recipient_norm, resolution_status, updated_at)
SELECT lower(hex(randomblob(16))), r.id, CAST(j.key AS INTEGER), trim(CAST(j.value AS TEXT)),
       lower(trim(CAST(j.value AS TEXT))), 'pending', datetime('now')
FROM award_records r, json_each(r.recipients) j
WHERE trim(CAST(j.value AS TEXT)) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM award_record_people p
    WHERE p.record_id = r.id AND p.recipient_index = CAST(j.key AS INTEGER)
  );
