// Pipeline de importación de premiaciones: staging versionado por lote con
// validación antes de publicar (swap atómico), checksum, conservación del
// último dataset válido y registro en sync_runs y award_import_batches.

import type {
  AwardCeremony,
  ImportRunResult,
  ImportTarget,
  ParsedEdition,
} from "./types";
import type { CeremonyParser, ParserMeta } from "./parser";
import { makeImportKey, normalizeTitle, workKey } from "./normalize";
import { CEREMONIES, ceremonyOrder } from "./schema";
import { fetchHtml, sha256Checksum } from "./fetch";
import { PARSERS } from "./parsers";
import { ensureMediaLinks, type ResolveEnv } from "./resolve";
import { parseEditionOrThrow } from "./parser";
import { syncManifest } from "./manifest";
import { wikipediaPageUrl, wikipediaParser } from "./parsers/wikipedia";
import { normalizePersonName } from "./people";

export interface ImportEnv extends ResolveEnv {
  AWARDS_DB: D1Database;
}

interface ExistingRecordRow {
  import_key: string;
}

interface EditionRow {
  ceremony: string;
  edition: number;
  award_year: number;
  coverage: string;
  status: string;
  source_url: string;
  fetched_at: string;
  checksum: string;
  record_count: number;
  updated_at: string;
}

async function getEditionRow(env: ImportEnv, ceremony: string, edition: number): Promise<EditionRow | null> {
  return (await env.AWARDS_DB.prepare(
    `SELECT ceremony, edition, award_year, coverage, status, source_url, fetched_at, checksum, record_count, updated_at
     FROM award_editions WHERE ceremony = ? AND edition = ?`,
  ).bind(ceremony, edition).first<EditionRow>()) ?? null;
}

async function existingImportKeys(env: ImportEnv, ceremony: string, edition: number): Promise<Set<string>> {
  const rows = await env.AWARDS_DB.prepare(
    `SELECT import_key FROM award_records WHERE ceremony = ? AND edition = ?`,
  ).bind(ceremony, edition).all<ExistingRecordRow>();
  return new Set((rows.results ?? []).map(row => row.import_key));
}

async function getManifestRow(env: ImportEnv, ceremony: string, edition: number): Promise<{ coverage_expected: string } | null> {
  return (await env.AWARDS_DB.prepare(
    `SELECT coverage_expected FROM award_edition_manifest WHERE ceremony = ? AND edition = ?`,
  ).bind(ceremony, edition).first<{ coverage_expected: string }>()) ?? null;
}

interface ExistingFingerprints {
  recordCount: number;
  officialCount: number;
  winners: Set<string>;
  categories: Set<string>;
}

/** Huellas del dataset activo para validar que un reemplazo no lo degrade. */
async function loadExistingFingerprints(
  env: ImportEnv,
  ceremony: string,
  edition: number,
): Promise<ExistingFingerprints> {
  const rows = await env.AWARDS_DB.prepare(
    `SELECT source_tier, category_original, status, work_title FROM award_records WHERE ceremony = ? AND edition = ?`,
  ).bind(ceremony, edition).all<{ source_tier: string; category_original: string; status: string; work_title: string }>();
  const winners = new Set<string>();
  const categories = new Set<string>();
  let officialCount = 0;
  for (const row of rows.results ?? []) {
    if (row.source_tier === "official") officialCount += 1;
    categories.add(normalizeTitle(row.category_original));
    if (row.status === "winner") {
      winners.add(`${normalizeTitle(row.category_original)}\u0000${normalizeTitle(row.work_title)}`);
    }
  }
  return { recordCount: (rows.results ?? []).length, officialCount, winners, categories };
}

function overlapOf(active: Set<string>, candidate: Set<string>): number {
  if (active.size === 0) return 1;
  let covered = 0;
  for (const key of active) {
    if (candidate.has(key)) covered += 1;
  }
  return covered / active.size;
}

/**
 * Valida que un dataset nuevo no degrade el activo:
 * - la fuente secundaria nunca reemplaza una edición con datos oficiales;
 * - los ganadores y las categorías activas deben cubrirse al menos a la mitad
 *   (regresión de parser que pierde ganadoras/nominadas se rechaza).
 */
export function validateEditionQuality(
  existing: ExistingFingerprints,
  records: ParsedEdition["records"],
  tier: "official" | "secondary",
): string | null {
  if (existing.recordCount <= 0) return null;
  if (tier === "secondary" && existing.officialCount > 0) {
    return "La fuente secundaria no puede reemplazar el archivo oficial de esta edición.";
  }
  const newWinners = new Set<string>();
  const newCategories = new Set<string>();
  for (const record of records) {
    newCategories.add(normalizeTitle(record.categoryOriginal));
    if (record.status === "winner") {
      newWinners.add(`${normalizeTitle(record.categoryOriginal)}\u0000${normalizeTitle(record.workTitle)}`);
    }
  }
  const winnerCoverage = overlapOf(existing.winners, newWinners);
  if (winnerCoverage < 0.5) {
    return `Caída anormal de ganadores: el dataset nuevo cubre ${Math.round(winnerCoverage * 100)}% de los ganadores activos.`;
  }
  const categoryCoverage = overlapOf(existing.categories, newCategories);
  if (categoryCoverage < 0.5) {
    return `Caída anormal de categorías: el dataset nuevo cubre ${Math.round(categoryCoverage * 100)}% de las categorías activas.`;
  }
  return null;
}

interface BatchInfo {
  id: string;
  ceremony: AwardCeremony;
  edition: number;
  url: string;
  checksum: string;
  parsedCount: number;
  sourceTier: "official" | "secondary";
}

/** Registra (o actualiza) la huella de un lote de importación. */
async function recordBatch(env: ImportEnv, batch: BatchInfo, outcome: string, reason?: string): Promise<void> {
  const now = new Date().toISOString();
  await env.AWARDS_DB.prepare(
    `INSERT INTO award_import_batches (
      id, ceremony, edition, source_url, source_tier, checksum, parsed_count, outcome, rejection_reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      outcome = excluded.outcome,
      rejection_reason = excluded.rejection_reason,
      committed_at = excluded.committed_at`,
  )
    .bind(batch.id, batch.ceremony, batch.edition, batch.url, batch.sourceTier, batch.checksum, batch.parsedCount, outcome, reason ?? null, now)
    .run();
}

function hashKey(importKey: string): string {
  let hash = 0;
  for (let index = 0; index < importKey.length; index += 1) {
    hash = (hash * 31 + importKey.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function upsertEdition(
  env: ImportEnv,
  ceremony: AwardCeremony,
  edition: number,
  awardYear: number,
  coverage: "complete" | "partial",
  status: "ok" | "stale" | "parser_failed",
  sourceUrl: string,
  checksum: string,
  recordCount: number,
): Promise<void> {
  const now = new Date().toISOString();
  await env.AWARDS_DB.prepare(
    `INSERT INTO award_editions (
      ceremony, edition, award_year, coverage, status, source_url, fetched_at, checksum, record_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ceremony, edition) DO UPDATE SET
      award_year = excluded.award_year,
      coverage = excluded.coverage,
      status = excluded.status,
      source_url = excluded.source_url,
      fetched_at = excluded.fetched_at,
      checksum = excluded.checksum,
      record_count = excluded.record_count,
      updated_at = excluded.updated_at`,
  )
    .bind(ceremony, edition, awardYear, coverage, status, sourceUrl, now, checksum, recordCount, now)
    .run();
}

export interface EditionImportResult {
  ceremony: AwardCeremony;
  edition: number;
  ok: boolean;
  skipped?: boolean;
  imported?: number;
  updated?: number;
  error?: string;
}

/**
 * Importa una edición desde HTML ya obtenido. Publica en dos tiempos:
 * 1) se parsea y se escribe en staging bajo un batch versionado;
 * 2) solo si la edición parseada es válida (categorías, registros, sin caída
 *    anormal, sin duplicados, sin degradar el archivo oficial) se hace el swap
 *    atómico sobre award_records.
 * Un parser roto o una caída de red conservan el último dataset válido.
 * `sourceTier` distingue la captura oficial de la fuente secundaria (Wikipedia):
 * los lotes, los registros y la validación la usan para no degradar datos.
 */
export async function importEditionFromHtml(
  env: ImportEnv,
  parser: CeremonyParser,
  meta: ParserMeta,
  html: string,
  checksum: string,
  extra?: { url: string; html: string },
  sourceTier: "official" | "secondary" = "official",
  allowQualityDrop = false,
): Promise<EditionImportResult> {
  const { ceremony, edition } = meta;
  const tier = sourceTier;
  const batch: BatchInfo = { id: crypto.randomUUID(), ceremony, edition, url: meta.url, checksum, parsedCount: 0, sourceTier: tier };

  try {
    const parsed = parseEditionOrThrow(parser, html, meta, extra);

    if (parsed.records.length === 0) {
      await recordBatch(env, batch, "failed", "El parser devolvió cero registros.");
      const existing = await getEditionRow(env, ceremony, edition);
      if (existing) {
        // Conserva el dataset anterior; señala que el parseo falló.
        await upsertEdition(
          env,
          ceremony,
          edition,
          meta.awardYear,
          meta.coverage,
          "parser_failed",
          existing.source_url,
          existing.checksum,
          existing.record_count,
        );
        return {
          ceremony,
          edition,
          ok: false,
          error: "El parser devolvió cero registros; se conservó el dataset anterior.",
        };
      }
      await upsertEdition(env, ceremony, edition, meta.awardYear, meta.coverage, "parser_failed", meta.url, checksum, 0);
      return { ceremony, edition, ok: false, error: "El parser devolvió cero registros y no había dataset anterior." };
    }

    // Deduplicación dentro de la edición por clave estable de importación.
    const unique = new Map<string, ParsedEdition["records"][number]>();
    for (const record of parsed.records) {
      const importKey = makeImportKey({
        ceremony,
        edition,
        category: record.categoryOriginal,
        status: record.status,
        workTitle: record.workTitle,
        recipients: record.recipients,
      });
      if (!unique.has(importKey)) unique.set(importKey, record);
    }
    const records = [...unique.values()];
    const importKeys = [...unique.keys()];
    batch.parsedCount = records.length;

    // Validación contra el dataset activo (si existe): caída anormal de
    // registros, la fuente secundaria nunca reemplaza el archivo oficial, y
    // los ganadores/categorías activos no pueden desaparecer más de la mitad.
    const existing = await getEditionRow(env, ceremony, edition);
    if (existing && existing.record_count > 0 && records.length < existing.record_count * 0.5) {
      await recordBatch(
        env,
        batch,
        "rejected",
        `Caída anormal de registros: ${records.length} nuevos vs ${existing.record_count} activos.`,
      );
      return {
        ceremony,
        edition,
        ok: false,
        error: `Se rechazó la importación: caída anormal de registros (${records.length} vs ${existing.record_count}).`,
      };
    }
    if (existing && existing.record_count > 0) {
      const fingerprints = await loadExistingFingerprints(env, ceremony, edition);
      const qualityError = validateEditionQuality(fingerprints, records, tier);
      if (qualityError && !allowQualityDrop) {
        await recordBatch(env, batch, "rejected", qualityError);
        return { ceremony, edition, ok: false, error: `Se rechazó la importación: ${qualityError}` };
      }
    }

    // Escribir en staging bajo el batch.
    const now = new Date().toISOString();
    await env.AWARDS_DB.prepare(
      `DELETE FROM award_records_staging WHERE ceremony = ? AND edition = ?`,
    ).bind(ceremony, edition).run();
    await env.AWARDS_DB.prepare(
      `DELETE FROM award_record_people_staging WHERE batch_id IN (
         SELECT id FROM award_import_batches WHERE ceremony = ? AND edition = ?
       )`,
    ).bind(ceremony, edition).run();
    // D1.batch reduce cientos de subrequests a unos pocos por edición. Se
    // mantiene un tamaño conservador para respetar el límite de sentencias.
    for (let start = 0; start < records.length; start += 50) {
      const statements = records.slice(start, start + 50).map((record, offset) => {
        const index = start + offset;
        return env.AWARDS_DB.prepare(
          `INSERT INTO award_records_staging (
            batch_id, import_key, id, ceremony, edition, award_year, category_es, category_original,
            status, subject, recipients, work_title, work_year, work_key, section,
            source_url, source_tier, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          batch.id,
          importKeys[index],
          `${ceremony}-${edition}-${hashKey(importKeys[index])}`,
          ceremony,
          edition,
          meta.awardYear,
          record.categoryEs ?? record.categoryOriginal,
          record.categoryOriginal,
          record.status,
          record.subject,
          JSON.stringify(record.recipients),
          record.workTitle,
          record.workYear ?? null,
          workKey(record.workTitle, record.workYear),
          record.section ?? null,
          record.sourceUrl || meta.url,
          record.sourceTier ?? tier,
          now,
        );
      });
      await env.AWARDS_DB.batch(statements);
    }
    const peopleStaging: D1PreparedStatement[] = [];
    records.forEach((record, index) => {
      const recordId = `${ceremony}-${edition}-${hashKey(importKeys[index])}`;
      record.recipients.forEach((recipient, recipientIndex) => {
        const name = recipient.trim();
        if (!name) return;
        peopleStaging.push(env.AWARDS_DB.prepare(
          `INSERT INTO award_record_people_staging
           (batch_id, record_id, recipient_index, recipient_name, recipient_norm)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(batch.id, recordId, recipientIndex, name, normalizePersonName(name)));
      });
    });
    for (let start = 0; start < peopleStaging.length; start += 80) {
      await env.AWARDS_DB.batch(peopleStaging.slice(start, start + 80));
    }
    await recordBatch(env, batch, "staged");

    const previousKeys = await existingImportKeys(env, ceremony, edition);
    let imported = 0;
    let updated = 0;
    for (const importKey of importKeys) {
      if (previousKeys.has(importKey)) updated += 1;
      else imported += 1;
    }

    // Swap atómico: reemplaza el dataset activo solo si todos los pasos pasan.
    try {
      await env.AWARDS_DB.batch([
        env.AWARDS_DB.prepare(
          `DELETE FROM award_records WHERE ceremony = ? AND edition = ?`,
        ).bind(ceremony, edition),
        env.AWARDS_DB.prepare(
          `INSERT INTO award_records (
            id, ceremony, edition, award_year, category_es, category_original, status,
            subject, recipients, work_title, work_year, work_key, section,
            source_url, source_tier, import_key, created_at, updated_at
          )
          SELECT id, ceremony, edition, award_year, category_es, category_original, status,
                 subject, recipients, work_title, work_year, work_key, section,
                 source_url, source_tier, import_key, created_at, created_at
          FROM award_records_staging WHERE batch_id = ?`,
        ).bind(batch.id),
        env.AWARDS_DB.prepare(
          `INSERT INTO award_record_people (
             id, record_id, recipient_index, recipient_name, recipient_norm,
             person_id, resolution_status, resolution_reason, updated_at
           )
           SELECT lower(hex(randomblob(16))), s.record_id, s.recipient_index, s.recipient_name, s.recipient_norm,
                  old.person_id,
                  CASE WHEN old.recipient_norm = s.recipient_norm THEN old.resolution_status ELSE 'pending' END,
                  CASE WHEN old.recipient_norm = s.recipient_norm THEN old.resolution_reason ELSE NULL END,
                  ?
           FROM award_record_people_staging s
           LEFT JOIN award_record_people old
             ON old.record_id = s.record_id AND old.recipient_index = s.recipient_index
           WHERE s.batch_id = ?
           ON CONFLICT(record_id, recipient_index) DO UPDATE SET
             recipient_name = excluded.recipient_name,
             recipient_norm = excluded.recipient_norm,
             person_id = CASE WHEN award_record_people.recipient_norm = excluded.recipient_norm
                              THEN COALESCE(award_record_people.person_id, excluded.person_id)
                              ELSE NULL END,
             resolution_status = CASE WHEN award_record_people.recipient_norm = excluded.recipient_norm
                                      THEN award_record_people.resolution_status ELSE 'pending' END,
             resolution_reason = CASE WHEN award_record_people.recipient_norm = excluded.recipient_norm
                                      THEN award_record_people.resolution_reason ELSE NULL END,
             updated_at = excluded.updated_at`,
        ).bind(now, batch.id),
        env.AWARDS_DB.prepare(
          `DELETE FROM award_record_people
           WHERE record_id IN (SELECT id FROM award_records WHERE ceremony = ? AND edition = ?)
             AND record_id NOT IN (SELECT record_id FROM award_record_people_staging WHERE batch_id = ?)`,
        ).bind(ceremony, edition, batch.id),
        env.AWARDS_DB.prepare(
          `INSERT INTO award_editions (
            ceremony, edition, award_year, coverage, status, source_url, fetched_at, checksum, record_count, updated_at
          ) VALUES (?, ?, ?, ?, 'ok', ?, ?, ?, ?, ?)
          ON CONFLICT(ceremony, edition) DO UPDATE SET
            award_year = excluded.award_year,
            coverage = excluded.coverage,
            status = 'ok',
            source_url = excluded.source_url,
            fetched_at = excluded.fetched_at,
            checksum = excluded.checksum,
            record_count = excluded.record_count,
            updated_at = excluded.updated_at`,
        ).bind(ceremony, edition, meta.awardYear, parsed.coverage, meta.url, now, checksum, records.length, now),
        env.AWARDS_DB.prepare(
          `UPDATE award_import_batches SET outcome = 'committed', committed_at = ? WHERE id = ?`,
        ).bind(now, batch.id),
      ]);
    } catch (error) {
      await recordBatch(env, batch, "failed", "El swap atómico no se completó; se conservó el dataset activo.");
      return {
        ceremony,
        edition,
        ok: false,
        error: `No se publicó la edición: ${error instanceof Error ? error.message : "fallo del swap."}`,
      };
    }

    await ensureMediaLinks(env, records, CEREMONIES[ceremony].mediaKinds);
    return { ceremony, edition, ok: true, imported, updated };
  } catch (error) {
    await recordBatch(env, batch, "failed", error instanceof Error ? error.message : "Error al importar la edición.");
    const existing = await getEditionRow(env, ceremony, edition);
    if (existing) {
      await upsertEdition(
        env,
        ceremony,
        edition,
        existing.award_year,
        existing.coverage as "complete" | "partial",
        "parser_failed",
        existing.source_url,
        existing.checksum,
        existing.record_count,
      );
    }
    return {
      ceremony,
      edition,
      ok: false,
      error: error instanceof Error ? error.message : "Error al importar la edición.",
    };
  }
}

/** Importa una edición parcial (sin archivo disponible): solo marca cobertura. */
async function importPartialEdition(env: ImportEnv, target: ImportTarget): Promise<EditionImportResult> {
  const parser = PARSERS[target.ceremony];
  const spec = parser.archiveEditions().find(item => item.edition === target.edition);
  if (!spec || spec.coverage !== "partial") {
    return { ceremony: target.ceremony, edition: target.edition, ok: false, error: "Edición no catalogada como parcial." };
  }
  await upsertEdition(env, target.ceremony, target.edition, spec.awardYear, "partial", "ok", spec.url, "", 0);
  return { ceremony: target.ceremony, edition: target.edition, ok: true, skipped: true };
}

/**
 * Intenta importar desde Wikipedia (fuente secundaria verificada) cuando el
 * archivo oficial es inaccesible o incompleto. Los registros quedan
 * etiquetados como secondary y la cobertura como parcial: la fuente
 * secundaria cubre un hueco, no declara completa una edición oficial.
 * Devuelve null si no hay página o falla.
 */
async function tryWikipediaSecondary(
  env: ImportEnv,
  target: ImportTarget,
  spec: { edition: number; awardYear: number },
): Promise<EditionImportResult | null> {
  const url = wikipediaPageUrl(target.ceremony, spec.edition, spec.awardYear);
  if (!url) return null;
  try {
    const fetched = await fetchHtml(url);
    const meta: ParserMeta = {
      ceremony: target.ceremony,
      edition: spec.edition,
      awardYear: spec.awardYear,
      url: fetched.url,
      coverage: "partial",
    };
    return await importEditionFromHtml(env, wikipediaParser(target.ceremony), meta, fetched.html, fetched.checksum, undefined, "secondary");
  } catch {
    return null;
  }
}

/** Importa HTML ya capturado (job Playwright) sin volver a consultar la red.
 * `tier` declara la procedencia: la captura de Wikipedia es "secondary"
 * (nunca reemplaza datos oficiales) y se parsea con wikipediaParser, no con
 * el parser oficial; las capturas de archivos oficiales bloqueados siguen
 * siendo "official". `url` es la URL realmente capturada. */
export async function importCapturedHtml(
  env: ImportEnv,
  ceremony: AwardCeremony,
  edition: number,
  html: string,
  options?: { tier?: "official" | "secondary"; url?: string; force?: boolean },
): Promise<EditionImportResult> {
  const tier = options?.tier ?? "official";
  const officialSpec = PARSERS[ceremony].archiveEditions().find(item => item.edition === edition);
  if (!officialSpec) {
    return { ceremony, edition, ok: false, error: `Edición ${edition} no existe en el archivo de ${ceremony}.` };
  }
  if (html.length > 8 * 1024 * 1024) {
    return { ceremony, edition, ok: false, error: "El HTML capturado excede el tamaño máximo." };
  }
  const parser = tier === "secondary" ? wikipediaParser(ceremony) : PARSERS[ceremony];
  const checksum = await sha256Checksum(html);
  const meta: ParserMeta = {
    ceremony,
    edition,
    awardYear: officialSpec.awardYear,
    url: options?.url ?? (tier === "secondary" ? (wikipediaPageUrl(ceremony, edition, officialSpec.awardYear) ?? officialSpec.url) : officialSpec.url),
    coverage: tier === "secondary" ? "partial" : officialSpec.coverage,
  };
  const existing = await getEditionRow(env, ceremony, edition);
  if (!options?.force && existing && existing.checksum === checksum && existing.status === "ok") {
    return { ceremony, edition, ok: true, skipped: true };
  }
  return importEditionFromHtml(env, parser, meta, html, checksum, undefined, tier, options?.force === true);
}

async function startSyncRun(env: ImportEnv, scope: string): Promise<number | null> {
  const now = new Date().toISOString();
  const result = await env.AWARDS_DB.prepare(
    `INSERT INTO award_sync_runs (created_at, started_at, scope, outcome) VALUES (?, ?, ?, 'running')`,
  ).bind(now, now, scope).run();
  return result.meta?.last_row_id ? Number(result.meta.last_row_id) : null;
}

async function finishSyncRun(env: ImportEnv, runId: number | null, summary: ImportRunResult): Promise<void> {
  if (runId === null) return;
  const finishedAt = new Date().toISOString();
  await env.AWARDS_DB.prepare(
    `UPDATE award_sync_runs
     SET finished_at = ?, outcome = ?, records_imported = ?, records_updated = ?,
         editions_ok = ?, editions_failed = ?, errors_json = ?
     WHERE id = ?`,
  )
    .bind(
      finishedAt,
      summary.outcome,
      summary.recordsImported,
      summary.recordsUpdated,
      summary.editionsOk,
      summary.editionsFailed,
      JSON.stringify(summary.errors),
      runId,
    )
    .run();
}

/**
 * Ejecuta la importación de una lista de ediciones (backfill o revisión semanal).
 * Un fallo de red/D1 propaga el error real: no se convierte en un arreglo vacío.
 */
export async function runImport(env: ImportEnv, scope: string, targets: ImportTarget[]): Promise<ImportRunResult> {
  const runId = await startSyncRun(env, scope);
  const summary: ImportRunResult = {
    runId,
    scope,
    outcome: "success",
    recordsImported: 0,
    recordsUpdated: 0,
    editionsOk: 0,
    editionsFailed: 0,
    errors: [],
    results: [],
  };

  // El manifest declara qué se espera importar; se sincroniza antes de tocar datos.
  try {
    const manifestCount = await env.AWARDS_DB.prepare(
      `SELECT COUNT(*) AS count FROM award_edition_manifest`,
    ).bind().first<{ count: number }>();
    if (Number(manifestCount?.count ?? 0) === 0) await syncManifest(env);
  } catch (error) {
    summary.outcome = "failed";
    summary.errors.push(`No se pudo sincronizar el manifest: ${error instanceof Error ? error.message : "error desconocido."}`);
    await finishSyncRun(env, runId, summary);
    return summary;
  }

  // Orden estable: por ceremonia y edición ascendente.
  const ordered = [...targets].sort((a, b) => {
    const orderDiff = ceremonyOrder(a.ceremony) - ceremonyOrder(b.ceremony);
    if (orderDiff !== 0) return orderDiff;
    return a.edition - b.edition;
  });

  for (const target of ordered) {
    const parser = PARSERS[target.ceremony];
    const spec = parser.archiveEditions().find(item => item.edition === target.edition);
    if (!spec) {
      const error = `Edición ${target.edition} no existe en el archivo de ${target.ceremony}.`;
      summary.errors.push(error);
      summary.editionsFailed += 1;
      summary.outcome = "partial";
      summary.results.push({ ceremony: target.ceremony, edition: target.edition, ok: false, error });
      continue;
    }

    // Huecos explícitos (canceladas, sin archivo, bloqueadas): no son pendientes.
    const manifestRow = await getManifestRow(env, target.ceremony, target.edition);
    if (manifestRow?.coverage_expected === "gap") {
      summary.results.push({ ceremony: target.ceremony, edition: target.edition, ok: true, skipped: true });
      summary.editionsOk += 1;
      continue;
    }

    // Ediciones parciales: se intenta llenar con Wikipedia; si no, solo se
    // marca la cobertura (sin inventar datos).
    if (spec.coverage === "partial") {
      const fallback = await tryWikipediaSecondary(env, target, spec);
      if (fallback) {
        summary.results.push(fallback);
        if (fallback.ok) {
          summary.editionsOk += 1;
          summary.recordsImported += fallback.imported ?? 0;
          summary.recordsUpdated += fallback.updated ?? 0;
        } else {
          summary.editionsFailed += 1;
          summary.errors.push(`[${target.ceremony} ${target.edition}] ${fallback.error ?? "Fallo."}`);
          summary.outcome = "partial";
        }
        continue;
      }
      const result = await importPartialEdition(env, target);
      summary.results.push(result);
      summary.editionsOk += 1;
      continue;
    }

    try {
      const existing = await getEditionRow(env, target.ceremony, target.edition);
      let fetched;
      try {
        fetched = await fetchHtml(spec.url);
      } catch (error) {
        // Archivo oficial inaccesible: Wikipedia secundaria antes de fallar.
        const fallback = await tryWikipediaSecondary(env, target, spec);
        if (fallback) {
          summary.results.push(fallback);
          if (fallback.ok) {
            summary.editionsOk += 1;
            summary.recordsImported += fallback.imported ?? 0;
            summary.recordsUpdated += fallback.updated ?? 0;
          } else {
            summary.editionsFailed += 1;
            summary.errors.push(`[${target.ceremony} ${target.edition}] ${fallback.error ?? "Fallo."}`);
            summary.outcome = "partial";
          }
          continue;
        }
        throw error;
      }
      if (existing && existing.checksum === fetched.checksum) {
        summary.results.push({ ceremony: target.ceremony, edition: target.edition, ok: true, skipped: true });
        summary.editionsOk += 1;
        continue;
      }

      const extraUrl = parser.extraSource ? parser.extraSource(target.edition) : null;
      let extra;
      if (extraUrl) {
        try {
          extra = await fetchHtml(extraUrl);
        } catch {
          // Nominations/selections are an optional second source. A missing
          // archive page must not discard a valid official palmarès page.
          extra = undefined;
        }
      }

      const meta: ParserMeta = {
        ceremony: target.ceremony,
        edition: target.edition,
        awardYear: spec.awardYear,
        url: spec.url,
        coverage: spec.coverage,
      };

      let result = await importEditionFromHtml(
        env,
        parser,
        meta,
        fetched.html,
        fetched.checksum,
        extra ? { url: extra.url, html: extra.html } : undefined,
      );
      // El archivo oficial se obtuvo pero no aportó registros: fuente secundaria.
      if (!result.ok && result.error?.includes("cero registros")) {
        const fallback = await tryWikipediaSecondary(env, target, spec);
        if (fallback) result = fallback;
      }
      summary.results.push(result);
      if (result.ok) {
        summary.editionsOk += 1;
        summary.recordsImported += result.imported ?? 0;
        summary.recordsUpdated += result.updated ?? 0;
      } else {
        summary.editionsFailed += 1;
        summary.errors.push(`[${result.ceremony} ${result.edition}] ${result.error ?? "Fallo."}`);
        summary.outcome = "partial";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error de red o base de datos.";
      summary.errors.push(`[${target.ceremony} ${target.edition}] ${message}`);
      summary.editionsFailed += 1;
      summary.outcome = "partial";
      summary.results.push({ ceremony: target.ceremony, edition: target.edition, ok: false, error: message });
      if (summary.editionsOk === 0 && summary.editionsFailed > 0) {
        summary.outcome = "failed";
      }
    }
  }

  await finishSyncRun(env, runId, summary);
  return summary;
}

/** Ediciones objetivo de la revisión semanal: las dos más recientes por ceremonia. */
export function weeklyTargets(now = new Date()): ImportTarget[] {
  return Object.values(PARSERS).flatMap(parser => parser.recentEditions(now));
}
