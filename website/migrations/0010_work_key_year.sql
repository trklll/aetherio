-- B6: work_key incluye el año de la obra.
-- Antes las obras homónimas de años distintos compartían identidad
-- (work_key solo título, UNIQUE en award_media_links). A partir de ahora
-- workKey(title, year) produce "<título> [año]" cuando el año se conoce.
-- Estas actualizaciones conservan los IDs y el estado de resolución; solo
-- cambian la clave técnica para que el reprocesamiento progresivo pueda
-- distinguir obras homónimas. Son idempotentes para entornos locales.

UPDATE award_aliases
SET work_key = work_key || ' [' || (
  SELECT work_year FROM award_media_links link
  WHERE link.work_key = award_aliases.work_key AND link.work_year IS NOT NULL
  LIMIT 1
) || ']'
WHERE work_key IN (SELECT work_key FROM award_media_links WHERE work_year IS NOT NULL)
  AND work_key NOT LIKE '% [' || (SELECT work_year FROM award_media_links link WHERE link.work_key = award_aliases.work_key LIMIT 1) || ']';

UPDATE award_resolution_review
SET work_key = work_key || ' [' || (
  SELECT work_year FROM award_media_links link
  WHERE link.work_key = award_resolution_review.work_key AND link.work_year IS NOT NULL
  LIMIT 1
) || ']'
WHERE work_key IN (SELECT work_key FROM award_media_links WHERE work_year IS NOT NULL)
  AND work_key NOT LIKE '% [' || (SELECT work_year FROM award_media_links link WHERE link.work_key = award_resolution_review.work_key LIMIT 1) || ']';

UPDATE award_media_links
SET work_key = work_key || ' [' || work_year || ']'
WHERE work_year IS NOT NULL AND work_key NOT LIKE '% [' || work_year || ']';

UPDATE award_records
SET work_key = work_key || ' [' || work_year || ']'
WHERE work_year IS NOT NULL AND work_key NOT LIKE '% [' || work_year || ']';

UPDATE award_records_staging
SET work_key = work_key || ' [' || work_year || ']'
WHERE work_year IS NOT NULL AND work_key NOT LIKE '% [' || work_year || ']';

UPDATE award_resolution_review
SET work_key = work_key || ' [' || work_year || ']'
WHERE work_year IS NOT NULL AND work_key NOT LIKE '% [' || work_year || ']';
