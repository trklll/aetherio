import type { MediaItem } from "../types/ui.ts";
import { tmdbFetch } from "../config/apiKeys.ts";

const JIKAN_URL = "https://api.jikan.moe/v4";
const JIKAN_RATE_GAP_MS = 150;
const JIKAN_MAX_RETRIES_429 = 1;
const JIKAN_MAX_RETRIES_504 = 0;
const JIKAN_RETRY_BASE_MS = 500;
const JIKAN_TIMEOUT_MS = 3000;
const JIKAN_HEALTH_FAILURES_THRESHOLD = 2;
const TMDB_FIND_CONCURRENCY = 2;

let jikanHealthFailures = 0;
let jikanDisabled = false;

interface JikanImage {
  jpg?: { image_url?: string; large_image_url?: string };
  webp?: { image_url?: string; large_image_url?: string };
}

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english?: string;
  title_japanese?: string;
  images?: JikanImage;
  synopsis?: string;
  score?: number;
  genres?: { mal_id: number; name: string }[];
  year?: number;
  season?: string;
  aired?: { from?: string };
}

interface JikanListResponse<T> {
  data: T[];
  pagination?: { items?: { count?: number; total?: number; per_page?: number } };
}

interface JikanRecommendationEntry {
  mal_id: number;
  entry: { mal_id: number; title: string; images: JikanImage };
}

function extractImage(images: JikanImage | undefined): string | undefined {
  const large = images?.webp?.large_image_url || images?.jpg?.large_image_url;
  const normal = images?.webp?.image_url || images?.jpg?.image_url;
  return large || normal || undefined;
}

function jikanToItem(data: JikanAnime): MediaItem & { _malId: number } {
  const name = data.title_english || data.title;
  const image = extractImage(data.images);
  return {
    id: `mal:${data.mal_id}`,
    type: "anime",
    name,
    poster: image,
    background: image,
    description: data.synopsis,
    rating: typeof data.score === "number" ? data.score.toFixed(1) : undefined,
    year: data.year || (data.aired?.from ? Number(data.aired.from.slice(0, 4)) : undefined),
    genres: data.genres?.length ? data.genres.map(g => g.name) : undefined,
    _malId: data.mal_id,
  } as MediaItem & { _malId: number };
}

function recommendationToItem(data: JikanRecommendationEntry): MediaItem & { _malId: number } {
  const image = extractImage(data.entry.images);
  return {
    id: `mal:${data.entry.mal_id}`,
    type: "anime",
    name: data.entry.title,
    poster: image,
    background: image,
    _malId: data.entry.mal_id,
  } as MediaItem & { _malId: number };
}

async function jikanFetch<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  if (jikanDisabled) return null;
  const url = new URL(`${JIKAN_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  let attempt = 0;
  let lastWas504 = false;
  while (attempt <= JIKAN_MAX_RETRIES_429) {
    try {
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(JIKAN_TIMEOUT_MS) });
      if (response.ok) {
        jikanHealthFailures = 0;
        return (await response.json()) as T;
      }
      if (response.status === 504 || response.status === 503) {
        jikanHealthFailures++;
        if (jikanHealthFailures >= JIKAN_HEALTH_FAILURES_THRESHOLD) {
          jikanDisabled = true;
          console.warn("[JIKAN] MAL down — skipping remaining Jikan fetches, using TMDB fallback");
        }
        if (lastWas504 || attempt >= JIKAN_MAX_RETRIES_504) return null;
        lastWas504 = true;
        await sleep(JIKAN_RETRY_BASE_MS);
        attempt++;
        continue;
      }
      if (response.status === 429) {
        if (attempt < JIKAN_MAX_RETRIES_429) {
          await sleep(JIKAN_RETRY_BASE_MS * Math.pow(2, attempt));
          attempt++;
          continue;
        }
      }
      return null;
    } catch {
      jikanHealthFailures++;
      if (jikanHealthFailures >= JIKAN_HEALTH_FAILURES_THRESHOLD) {
        jikanDisabled = true;
        console.warn("[JIKAN] network timeout — skipping remaining Jikan fetches, using TMDB fallback");
      }
      if (attempt < JIKAN_MAX_RETRIES_429) {
        await sleep(JIKAN_RETRY_BASE_MS * Math.pow(2, attempt));
        attempt++;
        continue;
      }
      return null;
    }
  }
  return null;
}

function dedupeByMalId<T extends MediaItem>(items: T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const item of items) {
    const malId = (item as MediaItem & { _malId?: number })._malId;
    if (!malId || seen.has(malId)) continue;
    seen.add(malId);
    result.push(item);
  }
  return result;
}

const LIMIT = "10";

export async function fetchJikanSeasonNow(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/seasons/now", { sfw: "true", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanUpcoming(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/seasons/upcoming", { sfw: "true", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanTopMovies(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { type: "movie", filter: "bypopularity", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanTopOva(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { type: "ova", filter: "bypopularity", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanTopOna(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { type: "ona", filter: "bypopularity", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanTopSpecials(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { type: "special", filter: "bypopularity", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanRecommendations(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanRecommendationEntry>>("/recommendations/anime", { limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(recommendationToItem));
}

export async function fetchJikanTopAiring(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { filter: "airing", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanTopUpcoming(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { filter: "upcoming", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanTopFavorites(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { filter: "favorite", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export async function fetchJikanMostPopular(): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/top/anime", { filter: "bypopularity", limit: LIMIT });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

async function fetchByGenre(genreId: number): Promise<MediaItem[]> {
  const result = await jikanFetch<JikanListResponse<JikanAnime>>("/anime", {
    genres: String(genreId),
    order_by: "members",
    sort: "desc",
    min_score: "7",
    sfw: "true",
    limit: LIMIT,
  });
  return dedupeByMalId((result?.data ?? []).map(jikanToItem));
}

export const fetchJikanAction = () => fetchByGenre(1);
export const fetchJikanAdventure = () => fetchByGenre(2);
export const fetchJikanRomance = () => fetchByGenre(22);
export const fetchJikanComedy = () => fetchByGenre(4);
export const fetchJikanFantasy = () => fetchByGenre(10);
export const fetchJikanSciFi = () => fetchByGenre(24);
export const fetchJikanSliceOfLife = () => fetchByGenre(36);
export const fetchJikanPsychological = () => fetchByGenre(40);

interface TmdbFindResult {
  movie_results?: { id: number; poster_path?: string; backdrop_path?: string }[];
  tv_results?: { id: number; poster_path?: string; backdrop_path?: string }[];
}

interface TmdbResolve {
  tmdbId: number;
  poster?: string;
  background?: string;
}

function buildTmdbMovie(result: NonNullable<TmdbFindResult["movie_results"]>[number]): { tmdbId: number; poster?: string; background?: string } {
  return {
    tmdbId: result.id,
    poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : undefined,
    background: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : undefined,
  };
}

function buildTmdbTv(result: NonNullable<TmdbFindResult["tv_results"]>[number]): { tmdbId: number; poster?: string; background?: string } {
  return {
    tmdbId: result.id,
    poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : undefined,
    background: result.backdrop_path ? `https://image.tmdb.org/t/p/original${result.backdrop_path}` : undefined,
  };
}

async function findMalOnTmdb(malId: number): Promise<TmdbResolve | null> {
  try {
    const data = await tmdbFetch<TmdbFindResult>(`/find/${malId}`, { params: { external_source: "mal" } });
    if (!data) return null;
    if (data.tv_results?.length) return buildTmdbTv(data.tv_results[0]);
    if (data.movie_results?.length) return buildTmdbMovie(data.movie_results[0]);
    return null;
  } catch {
    return null;
  }
}

interface TmdbSearchResultItem {
  id: number;
  poster_path?: string;
  backdrop_path?: string;
  name?: string;
  title?: string;
  original_name?: string;
  popularity?: number;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function titlesMatch(searchTitle: string, result: TmdbSearchResultItem): boolean {
  const norm = normalizeTitle(searchTitle);
  const candidates = [result.name, result.title, result.original_name].filter(Boolean).map(s => normalizeTitle(s!));
  return candidates.some(c => c === norm || c.includes(norm) || norm.includes(c));
}

async function searchTmdbByTitle(title: string, searchType: "tv" | "movie", year?: number): Promise<TmdbResolve | null> {
  const params: Record<string, string> = { query: title, language: "en-US", page: "1" };
  if (year) {
    params[searchType === "tv" ? "first_air_date_year" : "year"] = String(year);
  }
  try {
    const result = await tmdbFetch<{ results: TmdbSearchResultItem[] }>(`/search/${searchType}`, { params });
    if (!result?.results?.length) return null;
    const matches = result.results.filter(r => titlesMatch(title, r));
    const best = matches.length
      ? matches.reduce((acc, r) => (r.popularity ?? 0) > (acc.popularity ?? 0) ? r : acc)
      : result.results.reduce((acc, r) => (r.popularity ?? 0) > (acc.popularity ?? 0) ? r : acc);
    if (!best) return null;
    return {
      tmdbId: best.id,
      poster: best.poster_path ? `https://image.tmdb.org/t/p/w500${best.poster_path}` : undefined,
      background: best.backdrop_path ? `https://image.tmdb.org/t/p/original${best.backdrop_path}` : undefined,
    };
  } catch {
    return null;
  }
}

async function findAnimeOnTmdb(title: string, year?: number): Promise<TmdbResolve | null> {
  for (const searchType of ["tv", "movie"] as const) {
    const r = await searchTmdbByTitle(title, searchType, year);
    if (r && r.tmdbId > 0) return r;
  }
  const shortTitle = title.split(/[:\-–]/)[0].trim();
  if (shortTitle.length >= 3 && shortTitle !== title) {
    for (const searchType of ["tv", "movie"] as const) {
      const r = await searchTmdbByTitle(shortTitle, searchType);
      if (r && r.tmdbId > 0) return r;
    }
  }
  return null;
}

interface EnrichedItem extends MediaItem {
  _malId: number;
}

function stripSeasonPattern(name: string): string | null {
  const cleaned = name.trim();
  const match = cleaned.match(/^(.*?)\s+(?:(?:Season|Part|Cour|Saga)\s+\d+|S\d{1,2}|\d+(?:st|nd|rd|th)\s+Season)\s*$/i);
  if (match && match[1].trim().length > 0) return match[1].trim();
  return null;
}

export async function resolveMalToTmdb(items: MediaItem[]): Promise<MediaItem[]> {
  const malItems = items.filter(
    (item): item is EnrichedItem => item.id.startsWith("mal:") && "_malId" in item,
  ).slice(0, 40);
  if (!malItems.length) return items;

  const resolved = new Map<number, TmdbResolve>();
  const seasonBaseNames = new Map<number, string>();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < malItems.length) {
      const i = nextIndex++;
      const item = malItems[i];
      let tmdb = await findMalOnTmdb(item._malId);
      if ((!tmdb || tmdb.tmdbId === 0) && item.name) {
        const baseName = stripSeasonPattern(item.name);
        if (baseName) {
          seasonBaseNames.set(item._malId, baseName);
          tmdb = await findAnimeOnTmdb(baseName, item.year);
        } else {
          tmdb = await findAnimeOnTmdb(item.name, item.year);
        }
      }
      if (tmdb && tmdb.tmdbId > 0) resolved.set(item._malId, tmdb);
    }
  }

  await Promise.all(Array.from({ length: Math.min(TMDB_FIND_CONCURRENCY, malItems.length) }, worker));

  const seenTmdbIds = new Set<number>();
  const seenBaseKeys = new Set<string>();
  return items.reduce<MediaItem[]>((acc, item) => {
    if (!item.id.startsWith("mal:")) {
      acc.push(item);
      return acc;
    }
    const enriched = item as EnrichedItem;
    const tmdb = resolved.get(enriched._malId);
    if (tmdb && tmdb.tmdbId > 0 && !seenTmdbIds.has(tmdb.tmdbId)) {
      seenTmdbIds.add(tmdb.tmdbId);
      const baseName = seasonBaseNames.get(enriched._malId);
      const finalName = baseName ?? item.name;
      const dedupKey = (stripSeasonPattern(finalName) ?? finalName).toLowerCase().trim();
      if (seenBaseKeys.has(dedupKey)) return acc;
      seenBaseKeys.add(dedupKey);
      acc.push({
        ...item,
        id: `tmdb:${tmdb.tmdbId}`,
        name: finalName,
        poster: tmdb.poster ?? item.poster,
        background: tmdb.background ?? item.background,
      });
    }
    return acc;
  }, []);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface SerialTask<T> {
  fn: () => Promise<T>;
}

export async function runJikanSerial<T>(tasks: SerialTask<T>[]): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  while (i < tasks.length) {
    const wasDisabled = jikanDisabled;
    results.push(await tasks[i].fn());
    i++;
    // After Jikan is disabled, run remaining fallback tasks in parallel.
    if (jikanDisabled && !wasDisabled) {
      const remaining = tasks.slice(i).map(t => t.fn());
      const rest = await Promise.all(remaining);
      results.push(...rest);
      break;
    }
    if (i < tasks.length && !wasDisabled && !jikanDisabled) {
      await sleep(JIKAN_RATE_GAP_MS);
    }
  }
  return results;
}
