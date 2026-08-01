import { tmdbFetch } from "../config/apiKeys.ts";
import type { InstalledAddon } from "../store/addonStore.ts";
import { normalizeAddonMediaMeta, type MediaMetadataSeed } from "./mediaMetadata";
import { parseSemanticSearchIntent, searchTmdbSemantically } from "./semanticSearch";

const IMG = "https://image.tmdb.org/t/p";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const SUGGESTION_TIMEOUT_MS = 1_500;
const FULL_TIMEOUT_MS = 4_000;
const SUGGESTION_CACHE_TTL_MS = 2 * 60_000;
const FULL_CACHE_TTL_MS = 5 * 60_000;

export type SearchMode = "suggestions" | "full";

export interface UnifiedSearchResult extends MediaMetadataSeed {
  key: string;
  mediaLabel: string;
  originalName?: string;
  aliases?: string[];
  canonicalKey?: string;
  externalIds?: { tmdb?: string; imdb?: string };
  popularity?: number;
  voteCount?: number;
  voteAverage?: number;
  searchScore?: number;
  relevanceTier?: number;
  relevanceScore?: number;
  popularityScore?: number;
  sourceIds?: string[];
}

export interface SearchRequest {
  query: string;
  mode: SearchMode;
  addons: InstalledAddon[];
  limit?: number;
  locale?: string;
  signal?: AbortSignal;
  allowCorrection?: boolean;
  onSnapshot?: (response: SearchResponse) => void;
}

export interface SearchCorrection {
  originalQuery: string;
  correctedQuery: string;
  confidence: number;
  reason: "fuzzy-title-match";
}

export type SearchProviderId = "tmdb" | "cinemeta" | "semantic" | "addons";

export type SearchCandidate = UnifiedSearchResult;

export interface SearchProvider {
  id: SearchProviderId;
  search(request: SearchRequest): Promise<SearchCandidate[]>;
}

export interface SearchProviderStatus {
  state: "idle" | "loading" | "success" | "error";
  resultCount: number;
  durationMs?: number;
  error?: string;
}

export interface SearchResponse {
  query: string;
  effectiveQuery: string;
  correction?: SearchCorrection;
  results: UnifiedSearchResult[];
  partial: boolean;
  completedProviders: SearchProviderId[];
  providerStatus: Record<SearchProviderId, SearchProviderStatus>;
}

interface TitleMatch {
  tier: number;
  similarity: number;
  tokenCoverage: number;
  extraTokens: number;
}

interface CachedResponse {
  expiresAt: number;
  response: SearchResponse;
}

const responseCache = new Map<string, CachedResponse>();
const inFlight = new Map<string, Promise<SearchResponse>>();

function tmdbImage(path?: string | null, size: "original" | "w780" | "w500" | "w342" | "w92" = "w342") {
  return path ? `${IMG}/${size}${path}` : undefined;
}

export function normalizeMediaType(type: string) {
  if (type === "tv") return "series";
  return type;
}

function addonBaseUrl(url: string) {
  return url.split("?")[0].replace(/\/manifest\.json$/, "").replace(/\/$/, "");
}

function catalogSupportsSearch(catalog: any) {
  const extra = Array.isArray(catalog?.extra) ? catalog.extra : [];
  return extra.some((item: any) => String(item?.name ?? "").toLowerCase() === "search")
    && !extra.some((item: any) => item?.isRequired && String(item?.name ?? "").toLowerCase() !== "search");
}

function addonCatalogSearchUrl(addon: InstalledAddon, catalog: any, query: string) {
  const base = addonBaseUrl(addon.url);
  return `${base}/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}/search=${encodeURIComponent(query)}.json`;
}

export function toMediaLabel(type: string) {
  if (type === "movie") return "Pelicula";
  if (type === "anime") return "Anime";
  return "Serie";
}

/** A display normalizer. Stopwords are intentionally preserved for title identity. */
export function normalizeSearchText(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWithoutStopwords(value?: string | null) {
  return normalizeSearchText(value)
    .replace(/\b(the|a|an|el|la|los|las|un|una|unos|unas|of|de|del|y|e)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  return normalizeWithoutStopwords(value).split(" ").filter(Boolean);
}

export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: a.length + 2 }, () => new Array<number>(b.length + 2).fill(0));
  const maxDistance = a.length + b.length;
  matrix[0][0] = maxDistance;
  for (let i = 0; i <= a.length; i++) {
    matrix[i + 1][0] = maxDistance;
    matrix[i + 1][1] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j + 1] = maxDistance;
    matrix[1][j + 1] = j;
  }
  const lastSeen = new Map<string, number>();
  for (let i = 1; i <= a.length; i++) {
    let lastMatchingColumn = 0;
    for (let j = 1; j <= b.length; j++) {
      const i1 = lastSeen.get(b[j - 1]) ?? 0;
      const j1 = lastMatchingColumn;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      if (cost === 0) lastMatchingColumn = j;
      matrix[i + 1][j + 1] = Math.min(
        matrix[i][j] + cost,
        matrix[i + 1][j] + 1,
        matrix[i][j + 1] + 1,
        matrix[i1][j1] + (i - i1 - 1) + 1 + (j - j1 - 1),
      );
    }
    lastSeen.set(a[i - 1], i);
  }
  return matrix[a.length + 1][b.length + 1];
}

export function trigramDice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) {
    return 1 - damerauLevenshtein(a, b) / Math.max(a.length, b.length, 1);
  }
  const grams = (value: string) => {
    const set = new Set<string>();
    for (let i = 0; i < value.length - 2; i += 1) set.add(value.slice(i, i + 3));
    return set;
  };
  const left = grams(a);
  const right = grams(b);
  let overlap = 0;
  for (const gram of left) if (right.has(gram)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const distanceScore = 1 - damerauLevenshtein(a, b) / Math.max(a.length, b.length, 1);
  return Math.max(0, Math.min(1, distanceScore * 0.72 + trigramDice(a, b) * 0.28));
}

function titleFields(item: UnifiedSearchResult) {
  return [item.name, item.originalName, ...(item.aliases ?? [])]
    .filter((value): value is string => Boolean(value?.trim()));
}

function scoreTitleMatch(item: UnifiedSearchResult, query: string): TitleMatch {
  const normalizedQuery = normalizeSearchText(query);
  const queryNoStopwords = normalizeWithoutStopwords(query);
  const queryWords = tokenize(query);
  if (!normalizedQuery || !queryWords.length) return { tier: 0, similarity: 0, tokenCoverage: 0, extraTokens: 0 };

  let best: TitleMatch = { tier: 0, similarity: 0, tokenCoverage: 0, extraTokens: Number.POSITIVE_INFINITY };
  for (const field of titleFields(item)) {
    const normalizedTitle = normalizeSearchText(field);
    const titleNoStopwords = normalizeWithoutStopwords(field);
    const titleWords = tokenize(field);
    const exact = normalizedTitle === normalizedQuery || titleNoStopwords === queryNoStopwords;
    const prefix = normalizedTitle.startsWith(`${normalizedQuery} `) || titleNoStopwords.startsWith(`${queryNoStopwords} `);
    const contains = normalizedTitle.includes(normalizedQuery) || titleNoStopwords.includes(queryNoStopwords);
    const scores = queryWords.map(queryWord => Math.max(...titleWords.map(titleWord => wordSimilarity(queryWord, titleWord)), 0));
    const tokenCoverage = scores.reduce((sum, score) => sum + score, 0) / queryWords.length;
    const allNear = scores.every(score => score >= 0.72);
    const wholeSimilarity = Math.max(
      0,
      1 - damerauLevenshtein(normalizedTitle, normalizedQuery) / Math.max(normalizedTitle.length, normalizedQuery.length, 1),
    );
    const similarity = wholeSimilarity * 0.55 + tokenCoverage * 0.3 + trigramDice(normalizedTitle, normalizedQuery) * 0.15;
    const tier = exact ? 6 : prefix && allNear ? 5 : contains && allNear ? 4 : allNear ? 3 : tokenCoverage >= 0.45 ? 2 : 0;
    const candidate = {
      tier,
      similarity,
      tokenCoverage,
      extraTokens: Math.max(0, titleWords.length - queryWords.length),
    };
    if (
      candidate.tier > best.tier
      || (candidate.tier === best.tier && candidate.similarity > best.similarity)
      || (candidate.tier === best.tier && candidate.similarity === best.similarity && candidate.extraTokens < best.extraTokens)
    ) best = candidate;
  }
  return best;
}

function resultPopularity(item: UnifiedSearchResult) {
  const popularity = Math.log1p(Math.max(0, item.popularity ?? 0));
  const votes = Math.log1p(Math.max(0, item.voteCount ?? 0)) * 0.18;
  return popularity + votes;
}

function rankedItem(item: UnifiedSearchResult, query: string, correction?: SearchCorrection) {
  const originalMatch = scoreTitleMatch(item, query);
  const correctedMatch = correction ? scoreTitleMatch(item, correction.correctedQuery) : originalMatch;
  const useCorrected = Boolean(correction && originalMatch.tier < 5 && correctedMatch.tier > originalMatch.tier);
  const lexical = useCorrected ? correctedMatch : originalMatch;
  const tier = useCorrected ? Math.min(5, correctedMatch.tier) : lexical.tier;
  const semanticTier = item.source === "semantic" && tier === 0 ? 1 : tier;
  const popularityScore = resultPopularity(item);
  const searchScore = semanticTier * 100 + lexical.similarity * 40 + popularityScore * 4 - lexical.extraTokens * 1.5;
  return {
    ...item,
    relevanceTier: semanticTier,
    relevanceScore: lexical.similarity,
    popularityScore,
    searchScore,
  };
}

function sourceList(item: UnifiedSearchResult) {
  const names = item.sourceName
    ? item.sourceName.split(/,\s*/)
    : item.sourceIds?.length
      ? item.sourceIds
      : [item.source ?? "unknown"];
  return Array.from(new Set(names.filter(Boolean)));
}

function canonicalResultKey(item: UnifiedSearchResult) {
  const type = normalizeMediaType(item.type);
  if (item.canonicalKey && /:(?:tmdb|imdb):/.test(item.canonicalKey)) return item.canonicalKey;
  const tmdb = item.externalIds?.tmdb ?? (item.id.startsWith("tmdb:") ? item.id.slice(5) : undefined);
  if (tmdb) return `${type}:tmdb:${tmdb}`;
  const imdb = item.externalIds?.imdb ?? (item.id.startsWith("tt") ? item.id : undefined);
  if (imdb) return `${type}:imdb:${imdb}`;
  if (item.canonicalKey) return item.canonicalKey;
  const year = item.year ?? "unknown";
  return `${type}:title:${normalizeSearchText(item.name)}:${year}`;
}

function mergeTwoResults(existing: UnifiedSearchResult, incoming: UnifiedSearchResult) {
  const sources = Array.from(new Set([...sourceList(existing), ...sourceList(incoming)]));
  const preferred = existing.source === "tmdb" ? existing : incoming.source === "tmdb" ? incoming : existing;
  const externalIds = { ...existing.externalIds, ...incoming.externalIds, ...preferred.externalIds };
  const merged: UnifiedSearchResult = {
    ...existing,
    ...incoming,
    ...preferred,
    id: preferred.id,
    type: normalizeMediaType(preferred.type),
    key: preferred.key,
    canonicalKey: canonicalResultKey({ ...preferred, externalIds }),
    name: preferred.name ?? existing.name ?? incoming.name,
    originalName: incoming.originalName ?? existing.originalName,
    aliases: Array.from(new Set([...(existing.aliases ?? []), ...(incoming.aliases ?? [])].filter(Boolean))),
    externalIds,
    poster: preferred.poster ?? existing.poster ?? incoming.poster,
    background: preferred.background ?? existing.background ?? incoming.background,
    logo: preferred.logo ?? existing.logo ?? incoming.logo,
    description: preferred.description ?? existing.description ?? incoming.description,
    year: preferred.year ?? existing.year ?? incoming.year,
    popularity: Math.max(existing.popularity ?? 0, incoming.popularity ?? 0) || undefined,
    voteCount: Math.max(existing.voteCount ?? 0, incoming.voteCount ?? 0) || undefined,
    voteAverage: Math.max(existing.voteAverage ?? 0, incoming.voteAverage ?? 0) || undefined,
    sourceName: sources.join(", "),
    sourceIds: sources,
  };
  return merged;
}

export function mergeSearchResults(
  results: UnifiedSearchResult[],
  limit = 42,
  query = "",
  correction?: SearchCorrection,
) {
  const byKey = new Map<string, UnifiedSearchResult>();
  for (const item of results) {
    const key = canonicalResultKey(item);
    const type = normalizeMediaType(item.type);
    const identityKeys = new Set<string>([key]);
    const tmdb = item.externalIds?.tmdb ?? (item.id.startsWith("tmdb:") ? item.id.slice(5) : undefined);
    const imdb = item.externalIds?.imdb ?? (item.id.startsWith("tt") ? item.id : undefined);
    if (tmdb) identityKeys.add(`${type}:tmdb:${tmdb}`);
    if (imdb) identityKeys.add(`${type}:imdb:${imdb}`);
    const fallbackKey = `${normalizeMediaType(item.type)}:${normalizeSearchText(item.name)}:${item.year ?? "unknown"}`;
    const stableIdentity = Boolean(
      item.externalIds?.tmdb
      || item.externalIds?.imdb
      || item.id.startsWith("tmdb:")
      || item.id.startsWith("tt")
      || item.canonicalKey?.includes(":tmdb:")
      || item.canonicalKey?.includes(":imdb:"),
    );
    const fallbackExisting = !stableIdentity
      ? Array.from(new Set(byKey.values())).find(candidate => {
        if (normalizeMediaType(candidate.type) !== normalizeMediaType(item.type)) return false;
        if (normalizeSearchText(candidate.name) !== normalizeSearchText(item.name)) return false;
        if (candidate.year === undefined || item.year === undefined) return true;
        return Math.abs(candidate.year - item.year) <= 1;
      })
      : undefined;
    const existing = Array.from(identityKeys).map(identityKey => byKey.get(identityKey)).find(Boolean)
      ?? fallbackExisting
      ?? (!stableIdentity ? byKey.get(fallbackKey) : undefined);
    const merged = existing ? mergeTwoResults(existing, item) : { ...item, canonicalKey: key, sourceIds: sourceList(item) };
    for (const identityKey of identityKeys) byKey.set(identityKey, merged);
    if (existing) {
      for (const [alias, value] of byKey.entries()) if (value === existing) byKey.set(alias, merged);
    } else if (!stableIdentity || !byKey.has(fallbackKey)) {
      byKey.set(fallbackKey, merged);
    }
  }
  const unique = Array.from(new Set(byKey.values()));
  return unique
    .map(item => rankedItem(item, query, correction))
    .sort((left, right) =>
      (right.relevanceTier ?? 0) - (left.relevanceTier ?? 0)
      || (right.relevanceScore ?? 0) - (left.relevanceScore ?? 0)
      || (right.popularityScore ?? 0) - (left.popularityScore ?? 0)
      || (right.voteCount ?? 0) - (left.voteCount ?? 0)
      || (left.name ?? "").localeCompare(right.name ?? "")
      || (left.year ?? 0) - (right.year ?? 0),
    )
    .slice(0, limit);
}

function mapTmdbItem(item: any, source = "tmdb", sourceName = "TMDB"): UnifiedSearchResult | null {
  if (item?.media_type && item.media_type !== "movie" && item.media_type !== "tv") return null;
  const type = item?.media_type === "movie" || item?.title ? "movie" : "series";
  const numericId = Number(item?.id);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  const id = `tmdb:${numericId}`;
  const name = item?.title ?? item?.name ?? "Sin titulo";
  const originalName = item?.original_title ?? item?.original_name;
  const year = Number((item?.release_date ?? item?.first_air_date ?? "").slice(0, 4)) || undefined;
  return {
    key: `tmdb:${type}:${id}`,
    canonicalKey: `${type}:tmdb:${numericId}`,
    id,
    type,
    name,
    originalName,
    poster: tmdbImage(item?.poster_path, "w342"),
    background: tmdbImage(item?.backdrop_path, "original"),
    description: item?.overview,
    year,
    source,
    sourceName,
    mediaLabel: toMediaLabel(type),
    popularity: Number(item?.popularity) || 0,
    voteCount: Number(item?.vote_count) || 0,
    voteAverage: Number(item?.vote_average) || 0,
    externalIds: { tmdb: String(numericId) },
    sourceIds: [sourceName],
  };
}

export async function searchTmdb(query: string, signal?: AbortSignal, locale = "es-ES"): Promise<UnifiedSearchResult[]> {
  const normalizedQuery = collapseSpaces(normalizeSearchText(query));
  const raw = collapseSpaces(query).replace(/[^\w\s-]/g, "").trim();
  const queries = Array.from(new Set([collapseSpaces(query), raw, normalizedQuery].filter(Boolean)));
  const results: UnifiedSearchResult[] = [];
  for (const q of queries) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const json = await tmdbFetch("/search/multi", {
      signal,
      params: { query: q, language: locale, page: "1", include_adult: "false" },
    });
    for (const item of json?.results ?? []) {
      const mapped = mapTmdbItem(item);
      if (mapped) results.push(mapped);
    }
    if (results.length >= 40) break;
  }
  const seen = new Set<string>();
  return results.filter(item => {
    const key = canonicalResultKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  let timedOut = false;
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new DOMException("Provider timeout", "TimeoutError");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function hydrateCinemetaItem(item: UnifiedSearchResult, signal?: AbortSignal) {
  const imdb = item.externalIds?.imdb ?? (item.id.startsWith("tt") ? item.id : undefined);
  const title = item.name?.trim();
  if (!title) return item;
  try {
    const type = normalizeMediaType(item.type);
    let hydrated: any;
    if (imdb) {
      const json = await tmdbFetch(`/find/${encodeURIComponent(imdb)}`, {
        signal,
        params: { external_source: "imdb_id", language: "es-ES" },
      });
      const candidates = type === "movie" ? json?.movie_results : json?.tv_results;
      hydrated = Array.isArray(candidates) ? candidates[0] : undefined;
    }
    if (!hydrated) {
      const endpoint = type === "movie" ? "/search/movie" : "/search/tv";
      const json = await tmdbFetch(endpoint, {
        signal,
        params: {
          query: title,
          language: "es-ES",
          page: "1",
          ...(item.year
            ? { [type === "movie" ? "year" : "first_air_date_year"]: String(item.year) }
            : {}),
        },
      });
      const candidates = Array.isArray(json?.results) ? json.results : [];
      hydrated = candidates
        .map((candidate: any) => ({
          candidate,
          year: Number((candidate.release_date ?? candidate.first_air_date ?? "").slice(0, 4)) || undefined,
          title: normalizeSearchText(candidate.title ?? candidate.name),
        }))
        .sort((left: any, right: any) => {
          const leftExact = left.title === normalizeSearchText(title) ? 1 : 0;
          const rightExact = right.title === normalizeSearchText(title) ? 1 : 0;
          return rightExact - leftExact
            || Math.abs((left.year ?? item.year ?? 0) - (item.year ?? left.year ?? 0))
              - Math.abs((right.year ?? item.year ?? 0) - (item.year ?? right.year ?? 0));
        })[0]?.candidate;
    }
    const mapped = hydrated ? mapTmdbItem({ ...hydrated, media_type: type === "movie" ? "movie" : "tv" }) : null;
    if (!mapped) return item;
    return mergeTwoResults(mapped, {
      ...item,
      originalName: item.originalName ?? mapped.originalName,
      aliases: [item.name, ...(item.aliases ?? [])].filter((value): value is string => Boolean(value)),
      externalIds: { ...item.externalIds, imdb },
      sourceName: "Cinemeta",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return item;
  }
}

async function enrichTmdbItem(item: UnifiedSearchResult, signal?: AbortSignal) {
  const numericId = item.externalIds?.tmdb ?? (item.id.startsWith("tmdb:") ? item.id.slice(5) : undefined);
  if (!numericId || !/^\d+$/.test(numericId)) return item;
  const endpoint = normalizeMediaType(item.type) === "movie" ? "/movie/" : "/tv/";
  try {
    const details = await tmdbFetch<any>(`${endpoint}${numericId}`, {
      signal,
      params: {
        language: "es-ES",
        append_to_response: "alternative_titles,translations",
      },
    });
    if (!details) return item;
    const alternativeTitles = [
      ...(details.alternative_titles?.titles ?? []),
      ...(details.alternative_titles?.results ?? []),
    ].map((entry: any) => entry?.title ?? entry?.name).filter(Boolean);
    const translations = (details.translations?.translations ?? [])
      .map((entry: any) => entry?.data?.title ?? entry?.data?.name)
      .filter(Boolean);
    const aliases = Array.from(new Set([
      ...(item.aliases ?? []),
      details.title,
      details.name,
      details.original_title,
      details.original_name,
      ...alternativeTitles,
      ...translations,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)));
    return {
      ...item,
      originalName: item.originalName ?? details.original_title ?? details.original_name,
      aliases,
      description: item.description ?? details.overview,
      poster: item.poster ?? tmdbImage(details.poster_path, "w342"),
      background: item.background ?? tmdbImage(details.backdrop_path, "original"),
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return item;
  }
}

async function enrichTopResults(results: UnifiedSearchResult[], signal?: AbortSignal) {
  const candidates = results
    .filter(item => item.id.startsWith("tmdb:") || item.externalIds?.tmdb)
    .slice(0, 20);
  const enriched: UnifiedSearchResult[] = [];
  for (let index = 0; index < candidates.length; index += 4) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    enriched.push(...await Promise.all(candidates.slice(index, index + 4).map(item => enrichTmdbItem(item, signal))));
  }
  return enriched;
}

export async function searchCinemeta(query: string, signal?: AbortSignal, timeoutMs = FULL_TIMEOUT_MS) {
  const types = ["series", "movie"] as const;
  const groups = await Promise.allSettled(types.map(async type => {
    const url = `${CINEMETA_BASE}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
    const json = await fetchJsonWithTimeout(url, timeoutMs, signal);
    return (json?.metas ?? []).map((raw: any): UnifiedSearchResult | null => {
      const normalizedType = normalizeMediaType(String(raw?.type ?? type));
      const id = String(raw?.id ?? "").trim();
      const name = String(raw?.name ?? raw?.title ?? "").trim();
      if (!id || !name) return null;
      const year = Number(String(raw?.releaseInfo ?? raw?.released ?? "").slice(0, 4)) || undefined;
      return {
        key: `cinemeta:${normalizedType}:${id}`,
        canonicalKey: `${normalizedType}:${id.startsWith("tt") ? `imdb:${id}` : `cinemeta:${id}`}`,
        id,
        type: normalizedType,
        name,
        originalName: raw?.originalName,
        poster: raw?.poster,
        background: raw?.background,
        description: raw?.description,
        year,
        source: "cinemeta",
        sourceName: "Cinemeta",
        mediaLabel: toMediaLabel(normalizedType),
        externalIds: id.startsWith("tt") ? { imdb: id } : undefined,
        sourceIds: ["Cinemeta"],
      };
    }).filter((item: UnifiedSearchResult | null): item is UnifiedSearchResult => item !== null);
  }));
  const candidates = groups
    .filter((entry): entry is PromiseFulfilledResult<UnifiedSearchResult[]> => entry.status === "fulfilled")
    .flatMap(entry => entry.value)
    .slice(0, 24);
  if (!candidates.length && groups.every(entry => entry.status === "rejected")) {
    throw groups.find((entry): entry is PromiseRejectedResult => entry.status === "rejected")?.reason;
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const hydrated: UnifiedSearchResult[] = [];
  for (let index = 0; index < candidates.length; index += 4) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = candidates.slice(index, index + 4);
    hydrated.push(...await Promise.all(batch.map(item => hydrateCinemetaItem(item, signal))));
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return hydrated;
}

export async function searchAddons(query: string, addons: InstalledAddon[], signal?: AbortSignal): Promise<UnifiedSearchResult[]> {
  const tasks = addons
    .filter(addon => addon.enabled)
    .flatMap(addon =>
      (addon.manifest?.catalogs ?? [])
        .filter((catalog: any) => catalogSupportsSearch(catalog))
        .map(async (catalog: any): Promise<UnifiedSearchResult[]> => {
          try {
            const response = await fetch(addonCatalogSearchUrl(addon, catalog, query), {
              signal,
              headers: { Accept: "application/json" },
            });
            if (!response.ok) return [];
            const json = await response.json();
            return (json.metas ?? [])
              .map((raw: any) => normalizeAddonMediaMeta(raw, normalizeMediaType(catalog.type), addon.name))
              .filter((item: MediaMetadataSeed | null): item is MediaMetadataSeed => item !== null)
              .map((item: MediaMetadataSeed): UnifiedSearchResult => ({
                ...item,
                type: normalizeMediaType(item.type),
                key: `addon:${addon.id}:${catalog.type}:${catalog.id}:${item.id}`,
                canonicalKey: `${normalizeMediaType(item.type)}:${item.id.startsWith("tt") ? `imdb:${item.id}` : `addon:${addon.id}:${item.id}`}`,
                source: "addon",
                sourceName: addon.name,
                mediaLabel: toMediaLabel(normalizeMediaType(item.type)),
                sourceIds: [addon.name],
              }));
          } catch (error) {
            if (signal?.aborted) throw error;
            return [];
          }
        }),
    );

  const groups = await Promise.all(tasks);
  return groups.flat();
}

function correctionFor(query: string, candidates: UnifiedSearchResult[]): SearchCorrection | undefined {
  const normalized = normalizeSearchText(query);
  if (normalized.length < 4 || parseSemanticSearchIntent(query).active) return undefined;
  const hasStrongOriginalMatch = candidates.some(item => scoreTitleMatch(item, query).tier >= 5);
  if (hasStrongOriginalMatch) return undefined;
  const ranked = candidates
    .filter(item => item.source === "cinemeta" || /\bcinemeta\b/i.test(item.sourceName ?? ""))
    .map(item => ({ item, match: scoreTitleMatch(item, query) }))
    .filter(candidate => candidate.match.similarity >= 0.88 && candidate.match.tier >= 3)
    .sort((left, right) => right.match.similarity - left.match.similarity);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner || normalizeSearchText(winner.item.name) === normalized) return undefined;
  const margin = winner.match.similarity - (runnerUp?.match.similarity ?? 0);
  if (margin < 0.06) return undefined;
  return {
    originalQuery: query,
    correctedQuery: winner.item.name ?? query,
    confidence: Math.min(1, winner.match.similarity * 0.9 + Math.min(0.1, margin)),
    reason: "fuzzy-title-match",
  };
}

function providerStatusMap(): Record<SearchProviderId, SearchProviderStatus> {
  return {
    tmdb: { state: "idle", resultCount: 0 },
    cinemeta: { state: "idle", resultCount: 0 },
    semantic: { state: "idle", resultCount: 0 },
    addons: { state: "idle", resultCount: 0 },
  };
}

function addonSignature(addons: InstalledAddon[]) {
  return addons
    .filter(addon => addon.enabled)
    .map(addon => `${addon.id}:${addon.url}`)
    .sort()
    .join(",");
}

function cacheKey(request: SearchRequest) {
  return `${request.mode}|${request.limit ?? "default"}|${request.locale ?? "es-ES"}|${request.allowCorrection !== false ? "corrected" : "literal"}|${normalizeSearchText(request.query)}|${addonSignature(request.addons)}`;
}

async function runProvider(
  id: SearchProviderId,
  task: (signal: AbortSignal) => Promise<UnifiedSearchResult[]>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const results = await task(controller.signal);
    return { id, results, durationMs: performance.now() - startedAt };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

function emptyResponse(query: string): SearchResponse {
  return {
    query,
    effectiveQuery: query,
    results: [],
    partial: false,
    completedProviders: [],
    providerStatus: providerStatusMap(),
  };
}

export async function searchMediaResponse(request: SearchRequest): Promise<SearchResponse> {
  const query = request.query.trim();
  if (!query) return emptyResponse(query);
  if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const key = cacheKey(request);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    request.onSnapshot?.(cached.response);
    return cached.response;
  }

  const existing = inFlight.get(key);
  if (existing) {
    const response = await existing;
    request.onSnapshot?.(response);
    return response;
  }

  const promise = (async () => {
    const limit = request.limit ?? (request.mode === "suggestions" ? 6 : 80);
    const timeoutMs = request.mode === "suggestions" ? SUGGESTION_TIMEOUT_MS : FULL_TIMEOUT_MS;
    const statuses = providerStatusMap();
    const allResults: UnifiedSearchResult[] = [];
    const completedProviders: SearchProviderId[] = [];
    let correction: SearchCorrection | undefined;

    const intent = parseSemanticSearchIntent(query);
    const providerTasks: Array<[SearchProviderId, (signal: AbortSignal) => Promise<UnifiedSearchResult[]>]> = [
      ["tmdb", signal => searchTmdb(query, signal, request.locale ?? "es-ES")],
      ["cinemeta", signal => searchCinemeta(query, signal, timeoutMs)],
    ];
    if (request.mode === "full" && intent.active) {
      providerTasks.push(["semantic", signal => searchTmdbSemantically(query, signal)]);
    }
    if (request.mode === "full") {
      providerTasks.push(["addons", signal => searchAddons(query, request.addons, signal)]);
    }

    const publish = () => {
      const ranked = mergeSearchResults(allResults, limit, query, correction);
      const snapshot: SearchResponse = {
        query,
        effectiveQuery: correction?.correctedQuery ?? query,
        correction,
        results: ranked,
        partial: completedProviders.length < providerTasks.length,
        completedProviders: [...completedProviders],
        providerStatus: { ...statuses },
      };
      request.onSnapshot?.(snapshot);
      return snapshot;
    };

    providerTasks.forEach(([id]) => {
      statuses[id] = { state: "loading", resultCount: 0 };
    });
    let latest = publish();
    await Promise.all(providerTasks.map(async ([id, task]) => {
      try {
        const value = await runProvider(id, task, request.signal, timeoutMs);
        allResults.push(...value.results);
        completedProviders.push(id);
        statuses[id] = { state: "success", resultCount: value.results.length, durationMs: value.durationMs };
      } catch (error: any) {
        if (error?.name === "AbortError" && request.signal?.aborted) throw error;
        statuses[id] = { state: "error", resultCount: 0, error: error instanceof Error ? error.message : "provider-error" };
      }
      latest = publish();
    }));

    correction = request.allowCorrection === false ? undefined : correctionFor(query, allResults);
    if (correction && request.mode === "full") {
      const correctedTasks: Array<Promise<{ id: SearchProviderId; results: UnifiedSearchResult[]; durationMs: number }>> = [
        runProvider("tmdb", signal => searchTmdb(correction.correctedQuery, signal, request.locale ?? "es-ES"), request.signal, timeoutMs),
        runProvider("addons", signal => searchAddons(correction.correctedQuery, request.addons, signal), request.signal, timeoutMs),
      ];
      const corrected = await Promise.allSettled(correctedTasks);
      for (const entry of corrected) {
        if (entry.status === "fulfilled") allResults.push(...entry.value.results);
        else if (entry.reason?.name === "AbortError" && request.signal?.aborted) throw entry.reason;
      }
      latest = publish();
    } else {
      latest = publish();
    }

    if (request.mode === "full") {
      const currentTop = mergeSearchResults(allResults, 20, query, correction);
      allResults.push(...await enrichTopResults(currentTop, request.signal));
      latest = publish();
    }

    const finalResponse: SearchResponse = {
      ...latest,
      query,
      effectiveQuery: correction?.correctedQuery ?? query,
      correction,
      results: mergeSearchResults(allResults, limit, query, correction),
      partial: completedProviders.length < providerTasks.length,
      completedProviders: [...completedProviders],
      providerStatus: { ...statuses },
    };
    const ttl = request.mode === "suggestions" ? SUGGESTION_CACHE_TTL_MS : FULL_CACHE_TTL_MS;
    responseCache.set(key, { response: finalResponse, expiresAt: Date.now() + ttl });
    request.onSnapshot?.(finalResponse);
    return finalResponse;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/** Backward-compatible array API for existing non-UI callers. */
export async function searchMedia(query: string, addons: InstalledAddon[], limit = 42, signal?: AbortSignal) {
  const response = await searchMediaResponse({ query, addons, limit, mode: "full", signal });
  return response.results;
}

export function clearSearchCache() {
  responseCache.clear();
}
