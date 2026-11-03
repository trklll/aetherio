import { tmdbFetch } from "../config/apiKeys";
import type { MediaItem } from "../types/ui";
import { getScopedStorageKey } from "../utils/localProfiles";
import { tmdbGenreName } from "./tmdbGenres";

const CACHE_KEY = "aetherio-library-genre-enrichment-v1";
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
const CONCURRENCY = 4;

interface CachedGenres {
  genres: string[];
  genreIds: number[];
  resolvedAt: number;
}

export async function enrichLibraryGenres(items: MediaItem[]): Promise<MediaItem[]> {
  const cache = readCache();
  const pending = items.filter(needsGenreEnrichment);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    while (nextIndex < pending.length) {
      const item = pending[nextIndex++];
      const key = itemCacheKey(item);
      const cached = cache[key];
      if (
        cached
        && Array.isArray(cached.genreIds)
        && Date.now() - cached.resolvedAt < (cached.genreIds.length ? SUCCESS_TTL_MS : FAILURE_TTL_MS)
      ) continue;
      const resolved = await fetchGenres(item).catch(() => ({ genres: [], genreIds: [] }));
      cache[key] = { ...resolved, resolvedAt: Date.now() };
    }
  }));

  writeCache(cache);
  return items.map(item => {
    if (!needsGenreEnrichment(item)) return item;
    const cached = cache[itemCacheKey(item)];
    if (!cached?.genreIds.length) return item;
    const isLegacyAnimePlaceholder = item.genres?.length === 1 && item.genres[0].trim().toLowerCase() === "anime";
    return {
      ...item,
      genres: [
        ...(isLegacyAnimePlaceholder ? [] : item.genres ?? []),
        ...cached.genres,
      ].filter((genre, index, values) => values.findIndex(value => normalize(value) === normalize(genre)) === index),
      genreIds: cached.genreIds,
    };
  });
}

function needsGenreEnrichment(item: MediaItem) {
  if (item.genreIds?.length) return false;
  const genres = item.genres?.map(genre => genre.trim()).filter(Boolean) ?? [];
  return genres.length === 0 || (genres.length === 1 && genres[0].toLowerCase() === "anime");
}

async function fetchGenres(item: MediaItem): Promise<Omit<CachedGenres, "resolvedAt">> {
  const type = item.type.toLowerCase() === "movie" ? "movie" : "tv";
  let id = item.id.match(/^tmdb:(\d+)/i)?.[1];
  let searchGenres: number[] = [];

  if (!id && /^tt\d+$/i.test(item.id)) {
    const found = await tmdbFetch<any>(`/find/${encodeURIComponent(item.id)}`, {
      params: { external_source: "imdb_id", language: "es-ES" },
    });
    const candidates = type === "movie" ? found?.movie_results : found?.tv_results;
    if (Array.isArray(candidates?.[0]?.genre_ids)) {
      searchGenres = candidates[0].genre_ids.map(Number).filter(Number.isFinite);
    }
    id = candidates?.[0]?.id ? String(candidates[0].id) : undefined;
  }

  if (!id && item.name.trim()) {
    const params: Record<string, string> = { query: item.name, language: "es-ES" };
    if (item.year) params[type === "movie" ? "year" : "first_air_date_year"] = String(item.year);
    const search = await tmdbFetch<any>(`/search/${type}`, {
      params,
    });
    const candidates = Array.isArray(search?.results) ? search.results : [];
    const normalizedTitle = normalize(item.name);
    const match = candidates.find((candidate: any) => normalize(String(candidate.title ?? candidate.name ?? "")) === normalizedTitle)
      ?? candidates[0];
    if (Array.isArray(match?.genre_ids)) searchGenres = match.genre_ids.map(Number).filter(Number.isFinite);
    id = match?.id ? String(match.id) : undefined;
  }

  if (searchGenres.length) {
    return {
      genreIds: searchGenres,
      genres: searchGenres
        .map(genreId => tmdbGenreName(type, genreId))
        .filter((genre): genre is string => Boolean(genre)),
    };
  }

  const detail = id
    ? await tmdbFetch<any>(`/${type}/${encodeURIComponent(id)}`, { params: { language: "es-ES" } })
    : null;
  const detailGenres = Array.isArray(detail?.genres) ? detail.genres : [];
  const genreIds = detailGenres.map((genre: any) => Number(genre?.id)).filter(Number.isFinite);
  const ids = genreIds.length ? genreIds : searchGenres;
  const genres = ids
    .map((genreId: number, index: number) => tmdbGenreName(type, genreId) ?? detailGenres[index]?.name)
    .filter((genre: string | undefined): genre is string => typeof genre === "string" && genre.length > 0);
  return { genres, genreIds: ids };
}

function itemCacheKey(item: MediaItem) {
  return `${item.type.toLowerCase()}:${item.id}`;
}

function readCache(): Record<string, CachedGenres> {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(CACHE_KEY));
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, CachedGenres] => {
      const cached = entry[1] as Partial<CachedGenres> | null;
      return Boolean(
        cached
        && Array.isArray(cached.genres)
        && Array.isArray(cached.genreIds)
        && typeof cached.resolvedAt === "number",
      );
    }));
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedGenres>) {
  try {
    localStorage.setItem(getScopedStorageKey(CACHE_KEY), JSON.stringify(cache));
  } catch {
    // Genre enrichment is best-effort; the base library remains usable.
  }
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
