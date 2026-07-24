import { tmdbFetch } from "../config/apiKeys.ts";
import { invokeCommand } from "../runtime/platform.ts";
import {
  getEnabledMdbListProviders,
  type MdbListProvider,
  type MdbListRatings,
  type MdbListSettings,
} from "../config/mdblist.ts";

const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  ratings: MdbListRatings | null;
}

type MdbListLookup = {
  provider: "imdb" | "tmdb";
  id: string;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<MdbListRatings | null>>();
const imdbIdCache = new Map<string, string | null>();

export async function fetchMdbListRatings({
  settings,
  mediaType,
  imdbId,
}: {
  settings: MdbListSettings;
  mediaType: string;
  imdbId?: string | null;
}): Promise<MdbListRatings | null> {
  const resolvedImdbId = normalizeImdbId(imdbId);
  return fetchMdbListRatingsByLookup({
    settings,
    mediaType,
    lookup: resolvedImdbId ? { provider: "imdb", id: resolvedImdbId } : null,
  });
}

async function fetchMdbListRatingsByLookup({
  settings,
  mediaType,
  lookup,
}: {
  settings: MdbListSettings;
  mediaType: string;
  lookup: MdbListLookup | null;
}): Promise<MdbListRatings | null> {
  const apiKey = settings.apiKey.trim();
  if (!settings.enabled || !apiKey || !lookup?.id) return null;

  const providers = getEnabledMdbListProviders(settings);
  if (!providers.length) return null;

  const normalizedMediaType = normalizeMdbListMediaType(mediaType);
  const cacheKey = [
    normalizedMediaType,
    lookup.provider,
    lookup.id,
    providers.slice().sort().join(","),
    hashValue(apiKey),
  ].join(":");
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.ratings;
  const staleCachedRatings = cached?.ratings ?? null;
  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    try {
      const ratings = await fetchViaTauri({
        apiKey,
        mediaProvider: lookup.provider,
        mediaId: lookup.id,
        mediaType: normalizedMediaType,
        providers,
      }).catch(() => null);
      const remoteError = getMdbListErrorMessage(ratings);
      if (remoteError) {
        console.warn("[AETHERIO:MDBLIST] lookup error", {
          mediaType: normalizedMediaType,
          provider: lookup.provider,
          id: lookup.id,
          error: remoteError,
        });
      }
      const tauriNormalized = normalizeRatings(ratings);
      const filtered = tauriNormalized ? filterRatingsByProviders(tauriNormalized, providers) : null;
      const normalized = filtered && Object.keys(filtered).length ? filtered : null;
      if (normalized) {
        cache.set(cacheKey, { ratings: normalized, expiresAt: Date.now() + CACHE_TTL_MS });
        return normalized;
      }
      if (staleCachedRatings) {
        cache.set(cacheKey, { ratings: staleCachedRatings, expiresAt: Date.now() + (5 * 60 * 1000) });
        return staleCachedRatings;
      } else {
        cache.delete(cacheKey);
      }
      return null;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, request);
  return request;
}

export async function fetchMdbListRatingsForMedia({
  settings,
  mediaType,
  mediaId,
  imdbId,
}: {
  settings: MdbListSettings;
  mediaType: string;
  mediaId: string;
  imdbId?: string | null;
}) {
  const lookup = await resolveMdbListLookup({
    mediaId,
    mediaType,
    imdbId,
  });
  const primary = await fetchMdbListRatingsByLookup({
    settings,
    mediaType,
    lookup,
  });
  if (primary) return primary;
  const imdbLookup = normalizeImdbId(imdbId) ? { provider: "imdb" as const, id: normalizeImdbId(imdbId)! } : null;
  const tmdbLookup = normalizeTmdbId(mediaId) ? { provider: "tmdb" as const, id: normalizeTmdbId(mediaId)! } : null;
  if (lookup?.provider !== "imdb" && imdbLookup) {
    const byImdb = await fetchMdbListRatingsByLookup({ settings, mediaType, lookup: imdbLookup });
    if (byImdb) return byImdb;
  }
  if (lookup?.provider !== "tmdb" && tmdbLookup) {
    const byTmdb = await fetchMdbListRatingsByLookup({ settings, mediaType, lookup: tmdbLookup });
    if (byTmdb) return byTmdb;
  }
  return null;
}

async function resolveMdbListLookup(input: {
  mediaId: string;
  mediaType: string;
  imdbId?: string | null;
}): Promise<MdbListLookup | null> {
  const directImdb = normalizeImdbId(input.imdbId) ?? normalizeImdbId(input.mediaId);
  if (directImdb) return { provider: "imdb", id: directImdb };

  const tmdbId = normalizeTmdbId(input.mediaId);
  if (tmdbId) return { provider: "tmdb", id: tmdbId };

  const resolvedImdbId = await resolveMdbListImdbId(input);
  return resolvedImdbId ? { provider: "imdb", id: resolvedImdbId } : null;
}

export async function resolveMdbListImdbId({
  mediaId,
  mediaType,
  imdbId,
}: {
  mediaId: string;
  mediaType: string;
  imdbId?: string | null;
}) {
  const direct = normalizeImdbId(imdbId) ?? normalizeImdbId(mediaId);
  if (direct) return direct;

  if (!mediaId.toLowerCase().startsWith("tmdb:")) return null;
  const cacheKey = `${normalizeMdbListMediaType(mediaType)}:${mediaId}`;
  if (imdbIdCache.has(cacheKey)) return imdbIdCache.get(cacheKey) ?? null;

  const tmdbId = Number(mediaId.split(":")[1]);
  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  const tmdbType = normalizeMdbListMediaType(mediaType) === "movie" ? "movie" : "tv";
  const json = await tmdbFetch(`/${tmdbType}/${tmdbId}/external_ids`) as { imdb_id?: string | null } | null;
  if (!json) {
    imdbIdCache.set(cacheKey, null);
    return null;
  }
  const resolved = normalizeImdbId(json.imdb_id);
  imdbIdCache.set(cacheKey, resolved);
  return resolved;
}

async function fetchViaTauri(input: {
  apiKey: string;
  mediaProvider: MdbListLookup["provider"];
  mediaId: string;
  mediaType: string;
  providers: MdbListProvider[];
}) {
  return invokeCommand<MdbListRatings>("fetch_mdblist_ratings", {
    apiKey: input.apiKey,
    api_key: input.apiKey,
    mediaProvider: input.mediaProvider,
    media_provider: input.mediaProvider,
    mediaId: input.mediaId,
    media_id: input.mediaId,
    mediaType: input.mediaType,
    media_type: input.mediaType,
    providers: input.providers,
  });
}

function filterRatingsByProviders(ratings: MdbListRatings, providers: MdbListProvider[]) {
  const filtered: MdbListRatings = {};
  for (const provider of providers) {
    const rating = ratings[provider];
    if (typeof rating === "number") filtered[provider] = rating;
  }
  return filtered;
}

function normalizeRatings(value: unknown): MdbListRatings | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    const ratings = normalizeRatingsArray(value);
    return Object.keys(ratings).length ? ratings : null;
  }
  const source = value as Record<string, unknown>;
  if (Array.isArray(source.ratings)) {
    const ratings = normalizeRatingsArray(source.ratings);
    return Object.keys(ratings).length ? ratings : null;
  }
  const ratings: MdbListRatings = {};
  for (const provider of ["trakt", "imdb", "tmdb", "letterboxd", "tomatoes", "metacritic"] as MdbListProvider[]) {
    const rating = normalizeRatingValue(
      source[provider]
      ?? source[providerRatingKey(provider)]
      ?? source[`${provider}_rating`]
      ?? source[`${provider}Rating`]
      ?? source[`${provider}_score`]
      ?? source[`${provider}Score`]
      ?? source[providerPercentKey(provider)],
    );
    if (rating !== undefined) ratings[provider] = rating;
  }
  if (!Object.keys(ratings).length) {
    for (const provider of ["trakt", "imdb", "tmdb", "letterboxd", "tomatoes", "metacritic"] as MdbListProvider[]) {
      const nested = source[provider];
      if (!nested || typeof nested !== "object") continue;
      const nestedRecord = nested as Record<string, unknown>;
      const rating = normalizeRatingValue(
        nestedRecord.rating ?? nestedRecord.value ?? nestedRecord.score ?? nestedRecord.average ?? nestedRecord.percent,
      );
      if (rating !== undefined) ratings[provider] = rating;
    }
  }
  return Object.keys(ratings).length ? ratings : null;
}

function getMdbListErrorMessage(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const error = record.error ?? record.message;
  return typeof error === "string" ? error.trim() : "";
}

function normalizeRatingsArray(items: unknown[]) {
  const ratings: MdbListRatings = {};
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const provider = normalizeProviderKey(
      record.source ?? record.provider ?? record.name ?? record.id ?? record.type,
    );
    if (!provider) continue;
    const rating = normalizeRatingValue(
      record.rating ?? record.value ?? record.score ?? record.average ?? record.percent,
    );
    if (rating !== undefined) ratings[provider] = rating;
  }
  return ratings;
}

function normalizeProviderKey(value: unknown): MdbListProvider | null {
  const key = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!key) return null;
  if (key === "trakt") return "trakt";
  if (key === "imdb") return "imdb";
  if (key === "tmdb" || key === "themoviedb") return "tmdb";
  if (key === "letterboxd" || key === "letterrating") return "letterboxd";
  if (key === "tomatoes" || key === "rottentomatoes" || key === "rtomatoes" || key === "tomatometer") return "tomatoes";
  if (key === "metacritic" || key === "metascore") return "metacritic";
  return null;
}

function providerRatingKey(provider: MdbListProvider) {
  switch (provider) {
    case "tomatoes":
      return "rtomatoes";
    case "letterboxd":
      return "letterrating";
    default:
      return provider;
  }
}

function providerPercentKey(provider: MdbListProvider) {
  switch (provider) {
    case "tomatoes":
      return "tomatometer";
    case "metacritic":
      return "metascore";
    default:
      return "";
  }
}

function normalizeRatingValue(value: unknown) {
  const rating = typeof value === "string"
    ? Number(value.trim().replace(/%$/, ""))
    : Number(value);
  return Number.isFinite(rating) && rating >= 0 ? rating : undefined;
}

function normalizeImdbId(value: string | null | undefined) {
  return value?.match(/tt\d+/i)?.[0] ?? null;
}

function normalizeTmdbId(value: string | null | undefined) {
  const match = value?.match(/^tmdb:(\d+)/i);
  return match?.[1] ?? null;
}

function normalizeMdbListMediaType(value: string) {
  return value.toLowerCase() === "movie" ? "movie" : "show";
}

function hashValue(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}
