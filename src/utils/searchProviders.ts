import { tmdbFetch } from "../config/apiKeys";
import type { InstalledAddon } from "../store/addonStore";
import { normalizeAddonMediaMeta, type MediaMetadataSeed } from "./mediaMetadata";

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
    .replace(/\b(the|a|an|el|la|los|las|un|una|unos|unas)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchScore(item: UnifiedSearchResult, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(item.name);
  if (!normalizedQuery || !normalizedTitle) return item.searchScore ?? 0;

  const queryWords = normalizedQuery.split(" ").filter(Boolean);
  const titleWords = normalizedTitle.split(" ").filter(Boolean);
  const allWordsMatch = queryWords.every(word => titleWords.some(titleWord => titleWord.startsWith(word) || titleWord.includes(word)));
  const exact = normalizedTitle === normalizedQuery;
  const starts = normalizedTitle.startsWith(normalizedQuery);
  const contains = normalizedTitle.includes(normalizedQuery);
  const popularity = Math.log10(Math.max(1, item.popularity ?? 0) + 1);
  const voteCount = Math.log10(Math.max(1, item.voteCount ?? 0) + 1);

  return (
    (item.searchScore ?? 0) +
    (exact ? 90 : 0) +
    (starts ? 56 : 0) +
    (contains ? 34 : 0) +
    (allWordsMatch ? 24 : 0) +
    (item.source === "tmdb" ? 4 : 0) +
    popularity +
    voteCount
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
      sourceName: existing.sourceName === item.sourceName ? existing.sourceName : `${existing.sourceName ?? existing.source}, ${item.sourceName ?? item.source}`,
    });
  }
  return Array.from(byKey.values())
    .map(item => ({ ...item, searchScore: searchScore(item, query) }))
    .sort((a, b) => (b.searchScore ?? 0) - (a.searchScore ?? 0))
    .slice(0, limit);
}

export async function searchTmdb(query: string): Promise<UnifiedSearchResult[]> {
  const json = await tmdbFetch("/search/multi", { params: { query, language: "es-ES", page: "1", include_adult: "false" } });
  if (!json) return [];
  return (json.results ?? [])
    .filter((item: any) => item.media_type === "movie" || item.media_type === "tv")
    .slice(0, 28)
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
  const [tmdbResults, addonResults] = await Promise.all([
    searchTmdb(query),
    searchAddons(query, addons),
  ]);
  return mergeSearchResults([...tmdbResults, ...addonResults], limit, query);
}
