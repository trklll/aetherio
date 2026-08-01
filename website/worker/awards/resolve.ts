// Resolución de identidades de obras: TMDB (movie/tv), IMDb (vía TMDB) y
// AniList (anime). Solo acepta coincidencias exactas normalizadas con tipo
// compatible y año igual o ±1; los casos ambiguos van a la tabla de revisión.

import { normalizeTitle, workKey } from "./normalize";
import type { MediaType } from "./types";

export interface ResolveEnv {
  AWARDS_DB: D1Database;
  TMDB_API_KEY?: string;
  ANILIST_CLIENT_ID?: string;
}

interface ResolveTarget {
  workKey: string;
  workTitle: string;
  workYear?: number;
  mediaType: MediaType;
}

export interface ResolutionResult {
  workKey: string;
  status: "resolved" | "pending" | "ambiguous" | "unresolved";
  tmdbId?: number | null;
  imdbId?: string | null;
  anilistId?: number | null;
  matchedTitle?: string;
  matchedYear?: number;
}

const TMDB_BASE = "https://api.themoviedb.org/3";
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

function yearOf(dateString: string | null | undefined): number | undefined {
  if (!dateString) return undefined;
  const year = Number(String(dateString).slice(0, 4));
  return Number.isFinite(year) && year >= 1900 ? year : undefined;
}

function yearMatches(candidateYear: number | undefined, targetYear: number | undefined): boolean {
  if (targetYear === undefined || candidateYear === undefined) return true;
  return Math.abs(candidateYear - targetYear) <= 1;
}

function titleMatches(candidate: string, query: string): boolean {
  const candidateKeys = equivalentTitleKeys(candidate);
  const queryKeys = equivalentTitleKeys(query);
  return candidateKeys.some(key => queryKeys.includes(key));
}

// Algunos archivos oficiales publican los títulos con el artículo al final
// (por ejemplo, "Godfather, The"), mientras que TMDB los devuelve como
// "The Godfather". Se mantiene la clave almacenada tal cual para no cambiar
// las claves de importación históricas; la equivalencia se aplica solo al
// resolver la identidad externa.
const TRAILING_ARTICLE = /^(.*)\s+(the|a|an|el|la|los|las|un|una|le|les|der|die|das|den|ein|eine|il|lo|i|gli|uno)\s*$/i;

function equivalentTitleKeys(value: string): string[] {
  const key = normalizeTitle(value);
  if (!key) return [];
  const keys = new Set([key]);
  const match = TRAILING_ARTICLE.exec(key);
  if (match) keys.add(`${match[2].toLowerCase()} ${match[1]}`.trim());
  return [...keys];
}

function searchTitleVariants(value: string): string[] {
  const original = String(value ?? "").trim();
  if (!original) return [];
  const variants = new Set([original]);
  const match = /^(.*?),\s*(the|a|an|el|la|los|las|un|una|le|les|der|die|das|den|ein|eine|il|lo|i|gli|uno)\s*$/i.exec(original);
  if (match) variants.add(`${match[2]} ${match[1]}`.trim());
  return [...variants];
}

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
}

async function searchTmdb(
  env: ResolveEnv,
  mediaType: "movie" | "tv",
  query: string,
  workYear?: number,
): Promise<Array<{ tmdbId: number; title: string; year?: number }>> {
  const apiKey = env.TMDB_API_KEY?.trim();
  if (!apiKey) return [];
  const endpoint = mediaType === "movie" ? "search/movie" : "search/tv";
  const candidates: Array<{ tmdbId: number; title: string; year?: number }> = [];
  for (const variant of searchTitleVariants(query)) {
    const url = new URL(`${TMDB_BASE}/${endpoint}`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("query", variant);
    url.searchParams.set("language", "en-US");
    url.searchParams.set("page", "1");
    url.searchParams.set("include_adult", "false");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) continue;

    const data = (await response.json()) as { results?: TmdbResult[] };
    const results = Array.isArray(data.results) ? data.results : [];
    for (const result of results) {
      const titles = [result.title, result.name, result.original_title, result.original_name]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map(value => value.trim());
      const title = titles.find(candidate => titleMatches(candidate, query));
      if (!title) continue;
      const year = yearOf(result.release_date ?? result.first_air_date);
      if (!yearMatches(year, workYear)) continue;
      candidates.push({ tmdbId: result.id, title, year });
    }
  }
  return candidates;
}

async function tmdbExternalIds(env: ResolveEnv, mediaType: "movie" | "tv", tmdbId: number): Promise<{ imdbId: string | null }> {
  const apiKey = env.TMDB_API_KEY?.trim();
  if (!apiKey) return { imdbId: null };
  try {
    const response = await fetch(`${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids?api_key=${encodeURIComponent(apiKey)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { imdbId: null };
    const data = (await response.json()) as { imdb_id?: string | null };
    return { imdbId: typeof data.imdb_id === "string" && data.imdb_id ? data.imdb_id : null };
  } catch {
    return { imdbId: null };
  }
}

interface AniListTitle {
  english?: string | null;
  romaji?: string | null;
  native?: string | null;
}

async function searchAnilist(
  env: ResolveEnv,
  query: string,
  workYear?: number,
): Promise<Array<{ anilistId: number; title: string; year?: number }>> {
  const body = {
    query: `
      query ($search: String) {
        Page(page: 1, perPage: 20) {
          media(search: $search, type: ANIME) {
            id
            title { english romaji native }
            startDate { year }
          }
        }
      }`,
    variables: { search: query },
  };
  const response = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(env.ANILIST_CLIENT_ID ? { Authorization: `Bearer ${env.ANILIST_CLIENT_ID}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    data?: { Page?: { media?: Array<{ id: number; title?: AniListTitle | null; startDate?: { year?: number | null } | null }> } };
  };
  const media = data.data?.Page?.media ?? [];
  const candidates: Array<{ anilistId: number; title: string; year?: number }> = [];
  for (const item of media) {
    const titles = [item.title?.english, item.title?.romaji, item.title?.native].filter(Boolean) as string[];
    const year = item.startDate?.year ?? undefined;
    for (const title of titles) {
      if (!titleMatches(title, query)) continue;
      if (!yearMatches(year, workYear)) continue;
      candidates.push({ anilistId: item.id, title, year });
      break;
    }
  }
  return candidates;
}

export async function resolveOne(env: ResolveEnv, target: ResolveTarget): Promise<ResolutionResult> {
  const { workKey: key, workTitle, workYear, mediaType } = target;
  if (mediaType === "anime") {
    const anilistCandidates = await searchAnilist(env, workTitle, workYear);
    if (anilistCandidates.length === 0) return { workKey: key, status: "unresolved" };
    const distinct = new Map<number, (typeof anilistCandidates)[number]>();
    for (const candidate of anilistCandidates) {
      if (!distinct.has(candidate.anilistId)) distinct.set(candidate.anilistId, candidate);
    }
    if (distinct.size !== 1) return { workKey: key, status: "ambiguous" };
    const [match] = distinct.values();
    return {
      workKey: key,
      status: "resolved",
      anilistId: match.anilistId,
      matchedTitle: match.title,
      matchedYear: match.year,
    };
  }

  const tmdbKind = mediaType === "tv" ? "tv" : "movie";
  const tmdbCandidates = await searchTmdb(env, tmdbKind, workTitle, workYear);
  if (tmdbCandidates.length === 0) return { workKey: key, status: "unresolved" };

  const distinct = new Map<number, (typeof tmdbCandidates)[number]>();
  for (const candidate of tmdbCandidates) {
    if (!distinct.has(candidate.tmdbId)) distinct.set(candidate.tmdbId, candidate);
  }
  if (distinct.size !== 1) return { workKey: key, status: "ambiguous" };

  const [match] = distinct.values();
  const { imdbId } = await tmdbExternalIds(env, tmdbKind, match.tmdbId);
  return {
    workKey: key,
    status: "resolved",
    tmdbId: match.tmdbId,
    imdbId,
    matchedTitle: match.title,
    matchedYear: match.year,
  };
}

interface LinkRow {
  work_key: string;
  work_title: string;
  work_year: number | null;
  media_type: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  anilist_id: number | null;
  resolve_status: string;
}

interface ResolutionCounts {
  processed: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
  total: number;
  remaining?: number;
}

async function resolveRows(env: ResolveEnv, rows: LinkRow[]): Promise<ResolutionCounts> {
  if (rows.length === 0) return { processed: 0, resolved: 0, ambiguous: 0, unresolved: 0, total: 0 };

  let resolved = 0;
  let ambiguous = 0;
  let unresolved = 0;
  const now = new Date().toISOString();

  // Las consultas externas son independientes; resolverlas con concurrencia
  // limitada evita que un lote de 200 ediciones exceda el tiempo de CPU del
  // Worker. Las escrituras D1 se agrupan después en transacciones batch.
  const outcomes: Array<{ row: LinkRow; result: ResolutionResult; mediaType: MediaType }> = [];
  for (let start = 0; start < rows.length; start += 8) {
    const group = await Promise.all(rows.slice(start, start + 8).map(async row => {
      const mediaType: MediaType = (row.media_type as MediaType | null) ?? "movie";
      const result = await resolveOne(env, {
        workKey: row.work_key,
        workTitle: row.work_title,
        workYear: row.work_year ?? undefined,
        mediaType,
      });
      return { row, result, mediaType };
    }));
    outcomes.push(...group);
  }

  const statements: D1PreparedStatement[] = [];
  for (const { row, result, mediaType } of outcomes) {
    if (result.status === "resolved") {
      resolved += 1;
      statements.push(env.AWARDS_DB.prepare(
        `UPDATE award_media_links
         SET tmdb_id = ?, imdb_id = ?, anilist_id = ?, matched_title = ?, matched_year = ?,
             resolve_status = 'resolved', resolved_at = ?, last_attempted_at = ?, updated_at = ?
         WHERE work_key = ?`,
      )
        .bind(
          result.tmdbId ?? null,
          result.imdbId ?? null,
          result.anilistId ?? null,
          result.matchedTitle ?? null,
          result.matchedYear ?? null,
          now,
          now,
          now,
          row.work_key,
        )
      );
      continue;
    }
    if (result.status === "ambiguous") {
      ambiguous += 1;
      statements.push(env.AWARDS_DB.prepare(
        `UPDATE award_media_links
         SET resolve_status = 'ambiguous', last_attempted_at = ?, updated_at = ?
         WHERE work_key = ?`,
      )
        .bind(now, now, row.work_key)
      );
      statements.push(env.AWARDS_DB.prepare(
        `INSERT INTO award_resolution_review (id, work_key, work_title, work_year, media_type, candidates_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          row.work_key,
          row.work_title,
          row.work_year,
          mediaType,
          JSON.stringify({ candidates: "multiple", note: "Revisar manualmente los candidatos" }),
          now,
        )
      );
      continue;
    }
    unresolved += 1;
    statements.push(env.AWARDS_DB.prepare(
      `UPDATE award_media_links
       SET resolve_status = 'unresolved', last_attempted_at = ?, updated_at = ?
       WHERE work_key = ?`,
      )
      .bind(now, now, row.work_key)
    );
  }
  for (let start = 0; start < statements.length; start += 50) {
    await env.AWARDS_DB.batch(statements.slice(start, start + 50));
  }

  return { processed: rows.length, resolved, ambiguous, unresolved, total: rows.length };
}

/** Resuelve identidades pendientes en lote y persiste enlaces/ambiguos. */
export async function resolvePendingIdentities(
  env: ResolveEnv,
  limit = 40,
): Promise<ResolutionCounts> {
  const pending = await env.AWARDS_DB.prepare(
    `SELECT work_key, work_title, work_year, media_type, tmdb_id, imdb_id, anilist_id, resolve_status
     FROM award_media_links
     WHERE resolve_status = 'pending'
     LIMIT ?`,
  ).bind(limit).all<LinkRow>();
  return resolveRows(env, pending.results ?? []);
}

/**
 * Reintenta ambigüos y no resueltos (lo menos recientemente intentado primero).
 * Se ejecuta después de cada backfill: las obras nuevas del mismo catálogo
 * pueden desambiguar títulos idénticos que antes quedaron sin resolver.
 */
export async function reprocessIdentities(
  env: ResolveEnv,
  limit = 40,
  includeResolved = false,
): Promise<ResolutionCounts> {
  const statuses = includeResolved ? "'ambiguous', 'unresolved', 'resolved'" : "'ambiguous', 'unresolved'";
  const rows = await env.AWARDS_DB.prepare(
    `SELECT work_key, work_title, work_year, media_type, tmdb_id, imdb_id, anilist_id, resolve_status
     FROM award_media_links
     WHERE resolve_status IN (${statuses})
     ORDER BY (last_attempted_at IS NOT NULL), last_attempted_at ASC
     LIMIT ?`,
  ).bind(limit).all<LinkRow>();
  return resolveRows(env, rows.results ?? []);
}

async function countRemaining(env: ResolveEnv): Promise<number> {
  // `remaining` representa trabajo que aún no se ha intentado. Los casos
  // ambiguos/no resueltos ya procesados quedan para revisión manual y no
  // deben mantener el backfill abierto indefinidamente.
  const row = await env.AWARDS_DB.prepare(
    `SELECT COUNT(*) AS count FROM award_media_links WHERE resolve_status = 'pending'`,
  ).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

/** Resuelve un lote autenticado; `force` incluye enlaces resolved antiguos. */
export async function resolveIdentitiesBatch(env: ResolveEnv, limit = 40, force = false): Promise<ResolutionCounts> {
  const pending = await resolvePendingIdentities(env, limit);
  const remainingLimit = Math.max(0, limit - pending.total);
  const retried = remainingLimit > 0
    ? await reprocessIdentities(env, remainingLimit, force)
    : { processed: 0, resolved: 0, ambiguous: 0, unresolved: 0, total: 0 };
  return {
    processed: pending.total + retried.total,
    resolved: pending.resolved + retried.resolved,
    ambiguous: pending.ambiguous + retried.ambiguous,
    unresolved: pending.unresolved + retried.unresolved,
    total: pending.total + retried.total,
    remaining: await countRemaining(env),
  };
}

/** Registra las obras nuevas de una edición importada para resolverlas después. */
export async function ensureMediaLinks(
  env: ResolveEnv,
  records: Array<{ workTitle: string; workYear?: number }>,
  mediaKinds: MediaType[],
): Promise<void> {
  const now = new Date().toISOString();
  const fixedMediaType = mediaKinds.length === 1 ? mediaKinds[0] : null;
  const seen = new Set<string>();
  for (const record of records) {
    const key = workKey(record.workTitle, record.workYear);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await env.AWARDS_DB.prepare(
      `INSERT INTO award_media_links (id, work_key, work_title, work_year, media_type, resolve_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(work_key) DO UPDATE SET
         work_title = excluded.work_title,
         work_year = COALESCE(award_media_links.work_year, excluded.work_year),
         media_type = CASE
           WHEN ? IS NOT NULL THEN ?
           ELSE COALESCE(award_media_links.media_type, excluded.media_type)
         END,
         resolve_status = CASE
           WHEN ? IS NOT NULL AND award_media_links.media_type != ? THEN 'pending'
           ELSE award_media_links.resolve_status
         END,
         tmdb_id = CASE WHEN ? IS NOT NULL AND award_media_links.media_type != ? THEN NULL ELSE award_media_links.tmdb_id END,
         imdb_id = CASE WHEN ? IS NOT NULL AND award_media_links.media_type != ? THEN NULL ELSE award_media_links.imdb_id END,
         anilist_id = CASE WHEN ? IS NOT NULL AND award_media_links.media_type != ? THEN NULL ELSE award_media_links.anilist_id END,
         updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        key,
        record.workTitle,
        record.workYear ?? null,
        mediaKinds[0] ?? "movie",
        now,
        now,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
        fixedMediaType,
      )
      .run();
  }
}
