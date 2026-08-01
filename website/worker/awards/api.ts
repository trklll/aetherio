// API pública e interna del catálogo de premiaciones.
// La API pública se revalida para que un backfill nuevo llegue al cliente sin
// quedar oculto por una caché de 24 horas.

import type {
  AwardCeremony,
  AwardCoverage,
  AwardEmptyReason,
  AwardMediaResponse,
  AwardRecord,
  AwardStatus,
  AwardSubject,
  CoverageResponse,
  EditionStatus,
  ImportRunResult,
  MediaType,
} from "./types";
import { CEREMONIES, CEREMONY_IDS, ceremonyOrder } from "./schema";
import { runImport, weeklyTargets, importCapturedHtml, type ImportEnv } from "./import";
import { sha256Checksum } from "./fetch";
import { coverageByCeremony, loadManifestRows, syncManifest, type ManifestRow } from "./manifest";
import { resolveIdentitiesBatch } from "./resolve";

export interface AwardsApiEnv extends ImportEnv {
  AWARDS_DB: D1Database;
  AWARDS_IMPORT_TOKEN?: string;
}

const COVERAGE_MAX_AGE = 300; // 5 min

interface RecordRow {
  id: string;
  ceremony: AwardCeremony;
  edition: number | null;
  award_year: number;
  category_es: string;
  category_original: string;
  status: AwardStatus;
  subject: AwardSubject;
  recipients: string;
  work_title: string;
  work_year: number | null;
  section: string | null;
  source_url: string;
  source_tier: "official" | "secondary";
}

function recordFromRow(row: RecordRow): AwardRecord {
  return {
    id: row.id,
    ceremony: row.ceremony,
    edition: row.edition,
    awardYear: row.award_year,
    categoryEs: row.category_es,
    categoryOriginal: row.category_original,
    status: row.status,
    subject: row.subject,
    recipients: safeJsonArray(row.recipients),
    workTitle: row.work_title,
    workYear: row.work_year ?? undefined,
    sourceUrl: row.source_url,
    sourceTier: row.source_tier,
  };
}

function safeJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function jsonResponse(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Expose-Headers": "Cache-Control, ETag",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Cache-Control, ETag",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function withEtag(request: Request, body: unknown, cacheControl: string): Promise<Response> {
  // generatedAt es informativo y cambia en cada lectura; no debe invalidar
  // el ETag cuando el dataset real no cambió.
  const stableBody = body && typeof body === "object"
    ? Object.fromEntries(Object.entries(body as Record<string, unknown>).filter(([key]) => key !== "generatedAt"))
    : body;
  const payload = JSON.stringify(stableBody);
  const etag = `"${await sha256Checksum(payload)}"`;
  const ifNoneMatch = request.headers.get("If-None-Match");
  const matchesEtag = ifNoneMatch
    ?.split(",")
    .map(value => value.trim().replace(/^W\//, ""))
    .includes(etag) ?? false;
  if (matchesEtag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }
  return jsonResponse(body, 200, { ETag: etag, "Cache-Control": cacheControl });
}

interface EditionRow {
  ceremony: AwardCeremony;
  edition: number;
  award_year: number;
  coverage: AwardCoverage;
  status: EditionStatus;
  updated_at: string;
}

async function loadEditionRows(env: AwardsApiEnv): Promise<EditionRow[]> {
  const result = await env.AWARDS_DB.prepare(
    `SELECT ceremony, edition, award_year, coverage, status, updated_at FROM award_editions`,
  ).all<EditionRow>();
  return result.results ?? [];
}

export function coverageSummary(rows: EditionRow[], manifestRows: ManifestRow[] = []): CoverageResponse["byCeremony"] {
  const byCeremony: CoverageResponse["byCeremony"] = {} as CoverageResponse["byCeremony"];
  for (const ceremony of CEREMONY_IDS) {
    byCeremony[ceremony] = coverageByCeremony(ceremony, rows, manifestRows);
  }
  return byCeremony;
}

/**
 * Razón por la que una obra resuelta no tiene registros. Diferencia los casos
 * de sincronización pendiente/fallida de la ausencia real de premiaciones.
 */
export function emptyReason(input: {
  workKeys: string[];
  resolutionStatus: string;
  recordsCount: number;
  workYear?: number | null;
  editionRows: EditionRow[];
  manifestRows: ManifestRow[];
}): AwardEmptyReason | null {
  const { workKeys, resolutionStatus, recordsCount, workYear, editionRows, manifestRows } = input;
  if (recordsCount > 0) return null;
  if (workKeys.length === 0 || resolutionStatus !== "resolved") {
    return resolutionStatus === "ambiguous" ? "identity_ambiguous" : "identity_unresolved";
  }

  const relevant = manifestRows.filter(
    row => row.coverage_expected !== "gap" && (workYear == null || Math.abs(row.award_year - workYear) <= 2),
  );
  const imported = new Set(editionRows.filter(row => row.status === "ok").map(row => `${row.ceremony}:${row.edition}`));
  if (editionRows.some(row => row.status === "parser_failed" && relevant.some(m => m.ceremony === row.ceremony))) {
    return "sync_failed";
  }
  if (relevant.some(row => !imported.has(`${row.ceremony}:${row.edition}`))) return "edition_not_imported";
  return "no_matching_records";
}

/** Selección determinista del destacado (un único registro). */
export function pickFeatured(records: AwardRecord[]): AwardRecord | null {
  if (records.length === 0) return null;
  const statusRank: Record<AwardStatus, number> = { winner: 0, nominee: 1, official_selection: 2 };
  const subjectRank: Record<AwardSubject, number> = { work: 0, person: 1, song: 1, episode: 1, technical: 1 };
  const sorted = [...records].sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status];
    if (subjectRank[a.subject] !== subjectRank[b.subject]) return subjectRank[a.subject] - subjectRank[b.subject];
    if (b.awardYear !== a.awardYear) return b.awardYear - a.awardYear;
    if ((b.edition ?? 0) !== (a.edition ?? 0)) return (b.edition ?? 0) - (a.edition ?? 0);
    return ceremonyOrder(a.ceremony) - ceremonyOrder(b.ceremony);
  });
  return sorted[0];
}

function parseOptionalInt(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export async function handleAwardsRequest(
  request: Request,
  env: AwardsApiEnv,
  url: URL,
): Promise<Response | null> {
  if (url.pathname === "/api/awards/media" && request.method === "GET") {
    return mediaEndpoint(request, env, url);
  }
  if (url.pathname === "/api/awards/coverage" && request.method === "GET") {
    return coverageEndpoint(request, env);
  }
  if (url.pathname === "/api/internal/awards/import" && request.method === "POST") {
    return importEndpoint(request, env);
  }
  if (url.pathname === "/api/internal/awards/manifest/sync" && request.method === "POST") {
    return manifestSyncEndpoint(request, env);
  }
  if (url.pathname === "/api/internal/awards/resolve" && request.method === "POST") {
    return resolveEndpoint(request, env);
  }
  if (url.pathname === "/api/internal/awards/import" && request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
  }
  return null;
}

async function authorizeInternal(request: Request, env: AwardsApiEnv): Promise<Response | null> {
  if (!env.AWARDS_IMPORT_TOKEN) return errorResponse(503, "La importación interna no está configurada.");
  const authorization = request.headers.get("Authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(token, env.AWARDS_IMPORT_TOKEN.trim())) return errorResponse(401, "No autorizado.");
  return null;
}

async function manifestSyncEndpoint(request: Request, env: AwardsApiEnv): Promise<Response> {
  const unauthorized = await authorizeInternal(request, env);
  if (unauthorized) return unauthorized;
  try {
    const synced = await syncManifest(env);
    return jsonResponse({ ok: true, synced });
  } catch (error) {
    return errorResponse(500, `No se pudo sincronizar el manifest: ${describeError(error)}`);
  }
}

async function resolveEndpoint(request: Request, env: AwardsApiEnv): Promise<Response> {
  const unauthorized = await authorizeInternal(request, env);
  if (unauthorized) return unauthorized;
  let body: { limit?: unknown; force?: unknown } = {};
  try { body = await request.json(); } catch { /* payload vacío = valores por defecto */ }
  const rawLimit = typeof body.limit === "number" ? body.limit : 40;
  const limit = Number.isInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 40;
  try {
    const result = await resolveIdentitiesBatch(env, limit, body.force === true);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(500, `No se pudo resolver identidades: ${describeError(error)}`);
  }
}

async function mediaEndpoint(request: Request, env: AwardsApiEnv, url: URL): Promise<Response> {
  const rawType = url.searchParams.get("type");
  const tmdbId = parseOptionalInt(url.searchParams.get("tmdbId"));
  const imdbId = url.searchParams.get("imdbId")?.trim() || null;
  const anilistId = parseOptionalInt(url.searchParams.get("anilistId"));

  const mediaType: MediaType | null = rawType === "movie" || rawType === "tv" || rawType === "anime" ? rawType : null;
  const hasId = tmdbId !== null || imdbId !== null || anilistId !== null;
  if (!hasId) return errorResponse(400, "Se requiere al menos uno de tmdbId, imdbId o anilistId.");

  let rows: EditionRow[];
  let manifestRows: ManifestRow[];
  let coverage: CoverageResponse["byCeremony"];
  try {
    rows = await loadEditionRows(env);
    manifestRows = await loadManifestRows(env);
    coverage = coverageSummary(rows, manifestRows);
  } catch (error) {
    return errorResponse(502, `No se pudo consultar la cobertura: ${describeError(error)}`);
  }

  const clauses: string[] = [];
  const binds: Array<number | string> = [];
  if (tmdbId !== null) { clauses.push("tmdb_id = ?"); binds.push(tmdbId); }
  if (imdbId) { clauses.push("imdb_id = ?"); binds.push(imdbId); }
  if (anilistId !== null) { clauses.push("anilist_id = ?"); binds.push(anilistId); }

  let links;
  try {
    links = await env.AWARDS_DB.prepare(
      `SELECT work_key, work_title, work_year, media_type, resolve_status, tmdb_id, imdb_id, anilist_id, matched_title, matched_year
       FROM award_media_links WHERE ${clauses.join(" OR ")} LIMIT 5`,
    ).bind(...binds).all<{ work_key: string; work_title: string; work_year: number | null; media_type: string | null; resolve_status: string; tmdb_id: number | null; imdb_id: string | null; anilist_id: number | null; matched_title: string | null; matched_year: number | null }>();
  } catch (error) {
    return errorResponse(502, `No se pudo consultar la obra: ${describeError(error)}`);
  }

  const linksList = links.results ?? [];
  const workKeys = linksList.map(link => link.work_key);
  const firstLink = linksList[0] ?? null;
  const resolutionStatus = linksList.length > 0 ? linksList[0].resolve_status : "unresolved";

  let records: AwardRecord[] = [];
  if (workKeys.length > 0) {
    try {
      const placeholders = workKeys.map(() => "?").join(",");
      const rowsFound = await env.AWARDS_DB.prepare(
        `SELECT id, ceremony, edition, award_year, category_es, category_original, status,
                subject, recipients, work_title, work_year, section, source_url, source_tier
         FROM award_records WHERE work_key IN (${placeholders})`,
      ).bind(...workKeys).all<RecordRow>();
      records = (rowsFound.results ?? []).map(recordFromRow);
      records.sort((a, b) => {
        const orderDiff = ceremonyOrder(a.ceremony) - ceremonyOrder(b.ceremony);
        if (orderDiff !== 0) return orderDiff;
        if (b.awardYear !== a.awardYear) return b.awardYear - a.awardYear;
        return (b.edition ?? 0) - (a.edition ?? 0);
      });
    } catch (error) {
      return errorResponse(502, `No se pudieron consultar los registros: ${describeError(error)}`);
    }
  }

  const workYear = firstLink?.work_year ?? null;
  const relevantCeremonies = new Set<string>();
  for (const row of manifestRows) {
    if (workYear == null || Math.abs(row.award_year - workYear) <= 2) relevantCeremonies.add(row.ceremony);
  }
  for (const row of rows) {
    if (workYear == null || Math.abs(row.award_year - workYear) <= 2) relevantCeremonies.add(row.ceremony);
  }
  const relevantCoverage: CoverageResponse["byCeremony"] = {} as CoverageResponse["byCeremony"];
  for (const ceremony of CEREMONY_IDS) {
    if (relevantCeremonies.has(ceremony)) relevantCoverage[ceremony] = coverage[ceremony];
  }

  const reason = emptyReason({
    workKeys,
    resolutionStatus,
    recordsCount: records.length,
    workYear,
    editionRows: rows,
    manifestRows,
  });

  const response: AwardMediaResponse = {
    mediaType: mediaType ?? undefined,
    tmdbId: tmdbId ?? firstLink?.tmdb_id ?? null,
    imdbId: imdbId ?? firstLink?.imdb_id ?? null,
    anilistId: anilistId ?? firstLink?.anilist_id ?? null,
    records,
    featured: pickFeatured(records),
    reason,
    resolution: {
      status: (resolutionStatus as AwardMediaResponse["resolution"]["status"]) ?? "unresolved",
      workKey: workKeys[0] ?? null,
      matchedTitle: firstLink?.matched_title ?? null,
      matchedYear: firstLink?.matched_year ?? null,
    },
    matched: firstLink
      ? {
          workKey: firstLink.work_key,
          workTitle: firstLink.work_title,
          workYear: firstLink.work_year,
          matchedTitle: firstLink.matched_title,
          matchedYear: firstLink.matched_year,
          tmdbId: firstLink.tmdb_id,
          imdbId: firstLink.imdb_id,
          anilistId: firstLink.anilist_id,
        }
      : null,
    coverage,
    relevantCoverage,
    generatedAt: new Date().toISOString(),
  };

  const cacheControl = records.length > 0 && resolutionStatus === "resolved"
    ? "public, max-age=0, must-revalidate"
    : "no-store";
  return withEtag(request, response, cacheControl);
}

async function coverageEndpoint(request: Request, env: AwardsApiEnv): Promise<Response> {
  try {
    const [rows, manifestRows] = await Promise.all([loadEditionRows(env), loadManifestRows(env)]);
    const response: CoverageResponse = { byCeremony: coverageSummary(rows, manifestRows), generatedAt: new Date().toISOString() };
    return withEtag(request, response, `public, max-age=${COVERAGE_MAX_AGE}, must-revalidate`);
  } catch (error) {
    return errorResponse(502, `No se pudo consultar la cobertura: ${describeError(error)}`);
  }
}

interface ImportBody {
  scope?: unknown;
  targets?: unknown;
}

const IMPORT_SCOPES = new Set(["backfill", "weekly", "manual"]);

async function importEndpoint(request: Request, env: AwardsApiEnv): Promise<Response> {
  const unauthorized = await authorizeInternal(request, env);
  if (unauthorized) return unauthorized;

  let body: ImportBody;
  try {
    body = await request.json<ImportBody>();
  } catch {
    return errorResponse(400, "Payload inválido.");
  }

  const scope = typeof body.scope === "string" && IMPORT_SCOPES.has(body.scope) ? body.scope : null;
  if (!scope) return errorResponse(400, "El scope debe ser backfill, weekly o manual.");

  let targets: Array<{ ceremony: AwardCeremony; edition: number; html?: string; tier?: "official" | "secondary"; url?: string; force?: boolean }>;
  if (body.targets === undefined || body.targets === null) {
    targets = scope === "weekly" ? weeklyTargets() : [];
  } else if (Array.isArray(body.targets)) {
    targets = [];
    if (body.targets.length > 50) return errorResponse(400, "Máximo 50 ediciones por importación.");
    for (const raw of body.targets) {
      const target = raw as { ceremony?: unknown; edition?: unknown; html?: unknown; tier?: unknown; url?: unknown; force?: unknown };
      const ceremony = typeof target?.ceremony === "string" && (CEREMONY_IDS as string[]).includes(target.ceremony)
        ? (target.ceremony as AwardCeremony)
        : null;
      const edition = typeof target?.edition === "number" && Number.isInteger(target.edition) && target.edition > 0
        ? target.edition
        : null;
      if (!ceremony || edition === null) {
        return errorResponse(400, "Cada target requiere ceremony válida y edition entera positiva.");
      }
      const html = typeof target?.html === "string" ? target.html : undefined;
      if (html !== undefined && html.length > 8 * 1024 * 1024) {
        return errorResponse(400, "El HTML capturado excede el tamaño máximo de 8 MB por edición.");
      }
      const tier = target?.tier === "secondary" ? "secondary" : "official";
      const url = typeof target?.url === "string" && target.url.length > 0 && target.url.length <= 2048 ? target.url : undefined;
      targets.push({ ceremony, edition, html, tier, url, force: target.force === true });
    }
  } else {
    return errorResponse(400, "targets debe ser un arreglo.");
  }

  if (targets.length === 0) {
    return errorResponse(400, "No hay ediciones para importar.");
  }

  try {
    const hasCaptured = targets.some(target => typeof target.html === "string");
    if (hasCaptured) {
      const results = [];
      let outcome: ImportRunResult["outcome"] = "success";
      let recordsImported = 0;
      let editionsOk = 0;
      let editionsFailed = 0;
      const errors: string[] = [];
      for (const target of targets) {
        if (typeof target.html !== "string") {
          const error = "Mezclar targets con y sin HTML capturado no está soportado.";
          results.push({ ceremony: target.ceremony, edition: target.edition, ok: false, error });
          errors.push(error);
          editionsFailed += 1;
          outcome = "partial";
          continue;
        }
        const result = await importCapturedHtml(env, target.ceremony, target.edition, target.html, { tier: target.tier ?? "official", url: target.url, force: target.force });
        results.push(result);
        if (result.ok) {
          editionsOk += 1;
          recordsImported += result.imported ?? 0;
        } else {
          editionsFailed += 1;
          errors.push(`[${target.ceremony} ${target.edition}] ${result.error ?? "Fallo."}`);
          outcome = "partial";
        }
      }
      const result: ImportRunResult = {
        runId: null,
        scope,
        outcome,
        recordsImported,
        recordsUpdated: 0,
        editionsOk,
        editionsFailed,
        errors,
        results,
      };
      const status = outcome === "success" ? 200 : 207;
      return jsonResponse(result, status, { "Cache-Control": "no-store" });
    }
    const result: ImportRunResult = await runImport(env, scope, targets);
    const status = result.outcome === "success" ? 200 : result.outcome === "partial" ? 207 : 500;
    return jsonResponse(result, status, { "Cache-Control": "no-store" });
  } catch (error) {
    return errorResponse(500, `La importación falló: ${describeError(error)}`);
  }
}

function constantTimeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}
