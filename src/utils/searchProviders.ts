import { tmdbFetch } from "../config/apiKeys.ts";
import type { InstalledAddon } from "../store/addonStore.ts";
import { normalizeAddonMediaMeta, type MediaMetadataSeed } from "./mediaMetadata";
import { searchTmdbSemantically } from "./semanticSearch";

const IMG = "https://image.tmdb.org/t/p";

export interface UnifiedSearchResult extends MediaMetadataSeed {
  key: string;
  mediaLabel: string;
  popularity?: number;
  voteCount?: number;
  searchScore?: number;
}

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
  return extra.some((item: any) => item?.name === "search")
    && !extra.some((item: any) => item?.isRequired && item?.name !== "search");
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

function normalizeSearchText(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an|el|la|los|las|un|una|unos|unas|of|de|del|y|e)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length >= 2) return shorter.length / longer.length;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - distance / maxLen);
}

function searchScore(item: UnifiedSearchResult, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(item.name);
  if (!normalizedQuery || !normalizedTitle) return item.searchScore ?? 0;

  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const titleWords = normalizedTitle.split(" ").filter(Boolean);
  const exact = normalizedTitle === normalizedQuery;
  const starts = normalizedTitle.startsWith(normalizedQuery);
  const contains = normalizedTitle.includes(normalizedQuery);

  const wordMatchScores = queryWords.map(qw => {
    let best = 0;
    for (const tw of titleWords) {
      const sim = wordSimilarity(qw, tw);
      const prefix = tw.startsWith(qw) ? 0.15 : 0;
      const contained = tw.includes(qw) && qw.length >= 2 ? 0.05 : 0;
      best = Math.max(best, sim + prefix + contained);
    }
    return best;
  });
  const wordMatchRatio = queryWords.length
    ? wordMatchScores.reduce((sum, s) => sum + s, 0) / queryWords.length
    : 0;
  const allWordsNearMatch = wordMatchScores.every(s => s >= 0.7);

  const rawPopularity = Math.max(0, item.popularity ?? 0);
  const popularityTier = rawPopularity >= 50 ? 60 : rawPopularity >= 20 ? 40 : rawPopularity >= 5 ? 18 : rawPopularity >= 1 ? 7 : 1;
  const voteTier = (item.voteCount ?? 0) >= 1000 ? 14 : (item.voteCount ?? 0) >= 200 ? 7 : (item.voteCount ?? 0) >= 50 ? 2 : 0;

  return (
    (item.searchScore ?? 0) +
    (exact ? 110 : 0) +
    (starts ? 70 : 0) +
    (contains ? 42 : 0) +
    (allWordsNearMatch ? 30 : 0) +
    wordMatchRatio * 50 +
    (item.source === "tmdb" ? 4 : 0) +
    popularityTier +
    voteTier
  );
}

export function mergeSearchResults(results: UnifiedSearchResult[], limit = 42, query = "") {
  const byKey = new Map<string, UnifiedSearchResult>();
  for (const item of results) {
    const key = `${item.type}:${item.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...item,
      poster: item.poster ?? existing.poster,
      background: item.background ?? existing.background,
      logo: item.logo ?? existing.logo,
      description: item.description ?? existing.description,
      year: item.year ?? existing.year,
      searchScore: Math.max(existing.searchScore ?? 0, item.searchScore ?? 0),
      sourceName: existing.sourceName === item.sourceName ? existing.sourceName : `${existing.sourceName ?? existing.source}, ${item.sourceName ?? item.source}`,
    });
  }
  return Array.from(byKey.values())
    .map(item => ({ ...item, searchScore: searchScore(item, query) }))
    .sort((a, b) =>
      (b.searchScore ?? 0) - (a.searchScore ?? 0)
      || (b.popularity ?? 0) - (a.popularity ?? 0)
      || (b.voteCount ?? 0) - (a.voteCount ?? 0)
    )
    .slice(0, limit);
}

export async function searchTmdb(query: string): Promise<UnifiedSearchResult[]> {
  const normalizedQuery = collapseSpaces(normalizeSearchText(query));
  const raw = collapseSpaces(query).replace(/[^\w\s-]/g, "").trim();
  const queries = Array.from(new Set([collapseSpaces(query), raw, normalizedQuery].filter(Boolean)));
  let results: any[] = [];
  for (const q of queries) {
    const json = await tmdbFetch("/search/multi", { params: { query: q, language: "es-ES", page: "1", include_adult: "false" } });
    if (json?.results?.length) {
      results = results.concat(json.results);
      if (results.length >= 28) break;
    }
  }
  if (!results.length) return [];
  const seen = new Set<number>();
  return results
    .filter((item: any) => {
      if (item.media_type !== "movie" && item.media_type !== "tv") return false;
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 32)
    .map((item: any): UnifiedSearchResult => {
      const type = item.media_type === "movie" ? "movie" : "series";
      const id = `tmdb:${item.id}`;
      const year = Number((item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || undefined;
      return {
        key: `tmdb:${type}:${id}`,
        id,
        type,
        name: item.title ?? item.name ?? "Sin titulo",
        poster: tmdbImage(item.poster_path, "w342"),
        background: tmdbImage(item.backdrop_path, "original"),
        description: item.overview,
        year,
        source: "tmdb",
        sourceName: "TMDB",
        mediaLabel: toMediaLabel(type),
        popularity: Number(item.popularity) || 0,
        voteCount: Number(item.vote_count) || 0,
      };
    });
}

export async function searchAddons(query: string, addons: InstalledAddon[]): Promise<UnifiedSearchResult[]> {
  const tasks = addons
    .filter(addon => addon.enabled)
    .flatMap(addon =>
      (addon.manifest?.catalogs ?? [])
        .filter((catalog: any) => catalogSupportsSearch(catalog))
        .map(async (catalog: any): Promise<UnifiedSearchResult[]> => {
          try {
            const response = await fetch(addonCatalogSearchUrl(addon, catalog, query));
            if (!response.ok) return [];
            const json = await response.json();
            return (json.metas ?? [])
              .map((raw: any) => normalizeAddonMediaMeta(raw, normalizeMediaType(catalog.type), addon.name))
              .filter((item: MediaMetadataSeed | null): item is MediaMetadataSeed => item !== null)
              .map((item: MediaMetadataSeed): UnifiedSearchResult => ({
                ...item,
                type: normalizeMediaType(item.type),
                key: `addon:${addon.id}:${catalog.type}:${catalog.id}:${item.id}`,
                source: "addon",
                sourceName: addon.name,
                mediaLabel: toMediaLabel(normalizeMediaType(item.type)),
              }));
          } catch {
            return [];
          }
        })
    );

  const groups = await Promise.all(tasks);
  return groups.flat();
}

export async function searchMedia(query: string, addons: InstalledAddon[], limit = 42) {
  const [tmdbResults, semanticResults, addonResults] = await Promise.all([
    searchTmdb(query),
    searchTmdbSemantically(query),
    searchAddons(query, addons),
  ]);
  return mergeSearchResults([...tmdbResults, ...semanticResults, ...addonResults], limit, query);
}
