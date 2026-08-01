import type { AniListLibraryEntry } from "../../integrations/aniList";
import type { InstalledAddon } from "../../store/addonStore";
import type { MediaItem } from "../../types/ui";
import type { ContinueWatchingEntry } from "../../utils/continueWatching";
import type { SavedLibraryItem } from "../../utils/library";
import { getScopedStorageKey } from "../../utils/localProfiles";
import { tmdbFetch } from "../../config/apiKeys";
import { fetchAnilistDiscover } from "../../services/anilist";

export type LibrarySort = "added_desc" | "added_asc" | "title_asc" | "title_desc";

export interface LibraryItem {
  key: string;
  media: MediaItem;
  addedAt: number;
  listKey: string;
  listLabel: string;
}

export interface FacetOption {
  key: string;
  label: string;
  count: number;
}

export interface LibraryFilters {
  list: string;
  type: string;
  genre: string;
  year: string;
  sort: LibrarySort;
}

export interface FilteredLibrary {
  items: LibraryItem[];
  lists: FacetOption[];
  types: FacetOption[];
  genres: FacetOption[];
  years: FacetOption[];
}

export interface DiscoverCatalog {
  key: string;
  addonId: string;
  addonName: string;
  addonUrl: string;
  catalogId: string;
  catalogName: string;
  type: string;
  genres: string[];
  supportsSkip: boolean;
  skipStep: number;
  source?: "addon" | "tmdb" | "anilist";
  path?: string;
  params?: Record<string, string>;
  genreValues?: Record<string, string>;
  aniListSort?: "POPULARITY_DESC" | "SCORE_DESC" | "TRENDING_DESC" | "FAVOURITES_DESC";
}

const FILTERS_KEY = "aetherio-library-filters-v1";
const DISCOVER_KEY = "aetherio-library-discover-v1";
const ALL = "__all__";
const LEADING_ARTICLE = /^(the|an|a|el|la|los|las|un|una)\s+/i;

export function readLibraryFilters(): LibraryFilters {
  const fallback: LibraryFilters = {
    list: ALL,
    type: ALL,
    genre: ALL,
    year: ALL,
    sort: "added_desc",
  };
  try {
    const raw = localStorage.getItem(getScopedStorageKey(FILTERS_KEY));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<LibraryFilters>;
    return {
      list: parsed.list || ALL,
      type: parsed.type || ALL,
      genre: parsed.genre || ALL,
      year: parsed.year || ALL,
      sort: isLibrarySort(parsed.sort) ? parsed.sort : fallback.sort,
    };
  } catch {
    return fallback;
  }
}

export function writeLibraryFilters(filters: LibraryFilters) {
  localStorage.setItem(getScopedStorageKey(FILTERS_KEY), JSON.stringify(filters));
}

export function readDiscoverSelection() {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(DISCOVER_KEY));
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return {
      type: typeof parsed.type === "string" ? parsed.type : "",
      catalogKey: typeof parsed.catalogKey === "string" ? parsed.catalogKey : "",
      genre: typeof parsed.genre === "string" ? parsed.genre : "",
    };
  } catch {
    return { type: "", catalogKey: "", genre: "" };
  }
}

export function writeDiscoverSelection(selection: { type: string; catalogKey: string; genre: string }) {
  localStorage.setItem(getScopedStorageKey(DISCOVER_KEY), JSON.stringify(selection));
}

export function buildLibraryItems(
  savedEntries: SavedLibraryItem[],
  playbackEntries: ContinueWatchingEntry[],
  aniListEntries: AniListLibraryEntry[],
): LibraryItem[] {
  const byKey = new Map<string, LibraryItem>();

  for (const entry of playbackEntries.filter(item => item.completed)) {
    const key = `${normalizeType(entry.type)}:${entry.mediaKey}`;
    const item: LibraryItem = {
      key,
      media: {
        id: entry.id,
        type: normalizeType(entry.type),
        name: entry.name,
        poster: entry.poster,
        background: entry.background ?? entry.episodeStill,
        logo: entry.logo,
      },
      addedAt: entry.updatedAt,
      listKey: "activity",
      listLabel: "Actividad",
    };
    const current = byKey.get(key);
    if (!current || current.addedAt < item.addedAt) byKey.set(key, item);
  }

  for (const entry of aniListEntries) {
    const key = `series:${entry.mediaId}`;
    const addedAt = entry.updatedAt ? Date.parse(entry.updatedAt) || 0 : 0;
    byKey.set(key, {
      key,
      media: {
        id: entry.mediaId,
        type: "series",
        name: entry.title,
        poster: entry.poster,
        year: entry.year,
        genres: ["Anime"],
      },
      addedAt,
      listKey: `anilist:${entry.status}`,
      listLabel: aniListStatusLabel(entry.status),
    });
  }

  for (const entry of savedEntries) {
    const key = `${normalizeType(entry.type)}:${entry.id}`;
    byKey.set(key, {
      key,
      media: entry,
      addedAt: entry.addedAt,
      listKey: "saved",
      listLabel: "Mi lista",
    });
  }

  return Array.from(byKey.values());
}

export function filterLibrary(items: LibraryItem[], filters: LibraryFilters): FilteredLibrary {
  const selectedList = validateSelection(filters.list, listKeys(items));
  const listItems = selectedList === ALL ? items : items.filter(item => item.listKey === selectedList);
  const selectedType = validateSelection(filters.type, typeKeys(listItems));
  const selectedGenre = validateSelection(filters.genre, genreKeys(listItems));
  const selectedYear = validateSelection(filters.year, yearKeys(listItems));

  const matchesType = (item: LibraryItem) => selectedType === ALL || normalizeType(item.media.type) === selectedType;
  const matchesGenre = (item: LibraryItem) => selectedGenre === ALL
    || (item.media.genres ?? []).some(genre => normalizeKey(genre) === selectedGenre);
  const matchesYear = (item: LibraryItem) => selectedYear === ALL || String(item.media.year ?? "") === selectedYear;

  const visible = listItems.filter(item => matchesType(item) && matchesGenre(item) && matchesYear(item));
  const genreBase = listItems.filter(item => matchesType(item) && matchesYear(item));
  const yearBase = listItems.filter(item => matchesType(item) && matchesGenre(item));
  const typeBase = listItems.filter(item => matchesGenre(item) && matchesYear(item));

  return {
    items: sortLibraryItems(visible, filters.sort),
    lists: buildListOptions(items),
    types: buildTypeOptions(listItems, typeBase),
    genres: buildGenreOptions(listItems, genreBase),
    years: buildYearOptions(listItems, yearBase),
  };
}

export function buildDiscoverCatalogs(addons: InstalledAddon[]): DiscoverCatalog[] {
  const addonCatalogs = addons
    .filter(addon => addon.enabled)
    .flatMap(addon => {
      const catalogs = Array.isArray(addon.manifest?.catalogs) ? addon.manifest.catalogs : [];
      return catalogs.flatMap((catalog: any) => {
        const required = Array.isArray(catalog?.extraRequired) ? catalog.extraRequired : [];
        const extras = Array.isArray(catalog?.extra) ? catalog.extra : [];
        const requiredSearch = required.some((name: unknown) => ["search", "query"].includes(String(name).toLowerCase()))
          || extras.some((extra: any) => (
            ["search", "query"].includes(String(extra?.name ?? "").toLowerCase()) && extra?.isRequired === true
          ));
        if (requiredSearch || !catalog?.id || !catalog?.type) return [];
        const genreExtra = extras.find((extra: any) => String(extra?.name ?? "").toLowerCase() === "genre");
        const genres = Array.isArray(genreExtra?.options)
          ? genreExtra.options.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
          : [];
        const supportsSkip = required.some((name: unknown) => String(name).toLowerCase() === "skip")
          || extras.some((extra: any) => String(extra?.name ?? "").toLowerCase() === "skip");
        return [{
          key: `${addon.id}:${catalog.type}:${catalog.id}`,
          addonId: addon.id,
          addonName: addon.name,
          addonUrl: addon.url,
          catalogId: String(catalog.id),
          catalogName: String(catalog.name ?? catalog.id),
          type: String(catalog.type),
          genres,
          supportsSkip,
          skipStep: readSkipStep(extras),
          source: "addon" as const,
        }];
      });
    });
  return [...BUILT_IN_DISCOVER_CATALOGS, ...addonCatalogs];
}

export async function fetchDiscoverPage(
  catalog: DiscoverCatalog,
  page: number,
  genre: string,
  signal?: AbortSignal,
) {
  if (catalog.source === "tmdb" && catalog.path) {
    const payload = await tmdbFetch<any>(catalog.path, {
      signal,
      params: {
        language: "es-ES",
        page: String(page),
        include_adult: "false",
        ...catalog.params,
        ...(genre && catalog.genreValues?.[genre] ? { with_genres: catalog.genreValues[genre] } : {}),
      },
    });
    if (!payload) throw new Error("TMDB no devolvió resultados.");
    const results = Array.isArray(payload.results) ? payload.results : [];
    return {
      items: results.flatMap((raw: any) => {
        const id = Number(raw?.id);
        const name = String(raw?.title ?? raw?.name ?? "").trim();
        if (!Number.isFinite(id) || !name) return [];
        return [{
          id: `tmdb:${id}`,
          type: catalog.type,
          name,
          poster: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : undefined,
          background: raw.backdrop_path ? `https://image.tmdb.org/t/p/original${raw.backdrop_path}` : undefined,
          description: raw.overview,
          year: parseYear(raw.release_date ?? raw.first_air_date),
          rating: typeof raw.vote_average === "number" ? raw.vote_average.toFixed(1) : undefined,
        } satisfies MediaItem];
      }),
      hasMore: page < Number(payload.total_pages ?? page),
    };
  }

  if (catalog.source === "anilist") {
    const items = await fetchAnilistDiscover({
      page,
      genre: genre || undefined,
      sort: catalog.aniListSort,
    });
    return { items, hasMore: items.length >= 25 };
  }

  const base = catalog.addonUrl.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
  const extras: Record<string, string> = {};
  if (genre) extras.genre = genre;
  if (page > 1 && catalog.supportsSkip) extras.skip = String((page - 1) * catalog.skipStep);
  const suffix = Object.entries(extras)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const endpoint = `${base}/catalog/${encodeURIComponent(catalog.type)}/${encodeURIComponent(catalog.catalogId)}${suffix ? `/${suffix}` : ""}.json`;
  const response = await fetch(endpoint, { signal });
  if (!response.ok) throw new Error(`El catálogo respondió con ${response.status}.`);
  const payload = await response.json();
  const metas = Array.isArray(payload?.metas) ? payload.metas : [];
  return {
    items: metas.flatMap((raw: any) => {
      const id = String(raw?.id ?? "").trim();
      const name = String(raw?.name ?? raw?.title ?? "").trim();
      if (!id || !name) return [];
      const year = parseYear(raw?.year ?? raw?.releaseInfo ?? raw?.released);
      const item: MediaItem = {
        ...raw,
        id,
        type: normalizeType(String(raw?.type ?? catalog.type)),
        name,
        poster: raw?.poster ?? raw?.posterUrl,
        background: raw?.background ?? raw?.backdrop ?? raw?.backdropUrl,
        logo: raw?.logo ?? raw?.logoUrl,
        description: raw?.description ?? raw?.overview,
        year,
        genres: Array.isArray(raw?.genres) ? raw.genres : undefined,
      };
      return item.poster || item.background ? [item] : [];
    }),
    hasMore: catalog.supportsSkip && metas.length >= catalog.skipStep,
  };
}

const TMDB_MOVIE_GENRES: Record<string, string> = {
  Acción: "28",
  Aventura: "12",
  Animación: "16",
  Comedia: "35",
  Crimen: "80",
  Documental: "99",
  Drama: "18",
  Fantasía: "14",
  Terror: "27",
  Romance: "10749",
  "Ciencia ficción": "878",
  Suspenso: "53",
};

const TMDB_TV_GENRES: Record<string, string> = {
  "Acción y aventura": "10759",
  Animación: "16",
  Comedia: "35",
  Crimen: "80",
  Documental: "99",
  Drama: "18",
  Misterio: "9648",
  "Ciencia ficción y fantasía": "10765",
};

const ANILIST_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
];

const BUILT_IN_DISCOVER_CATALOGS: DiscoverCatalog[] = [
  builtInTmdb("tmdb:movie:popular", "Películas populares", "movie", "/discover/movie", TMDB_MOVIE_GENRES, { sort_by: "popularity.desc" }),
  builtInTmdb("tmdb:movie:top", "Películas mejor valoradas", "movie", "/discover/movie", TMDB_MOVIE_GENRES, { sort_by: "vote_average.desc", "vote_count.gte": "300" }),
  builtInTmdb("tmdb:series:popular", "Series populares", "series", "/discover/tv", TMDB_TV_GENRES, { sort_by: "popularity.desc" }),
  builtInTmdb("tmdb:series:top", "Series mejor valoradas", "series", "/discover/tv", TMDB_TV_GENRES, { sort_by: "vote_average.desc", "vote_count.gte": "150" }),
  builtInAniList("anilist:popular", "Anime popular", "POPULARITY_DESC"),
  builtInAniList("anilist:trending", "Anime en tendencia", "TRENDING_DESC"),
  builtInAniList("anilist:top", "Anime mejor valorado", "SCORE_DESC"),
  builtInAniList("anilist:favorites", "Anime con más favoritos", "FAVOURITES_DESC"),
];

function builtInTmdb(
  key: string,
  name: string,
  type: string,
  path: string,
  genreValues: Record<string, string>,
  params: Record<string, string>,
): DiscoverCatalog {
  return {
    key,
    addonId: "tmdb",
    addonName: "TMDB",
    addonUrl: "",
    catalogId: key,
    catalogName: name,
    type,
    genres: Object.keys(genreValues),
    supportsSkip: true,
    skipStep: 20,
    source: "tmdb",
    path,
    params,
    genreValues,
  };
}

function builtInAniList(
  key: string,
  name: string,
  aniListSort: NonNullable<DiscoverCatalog["aniListSort"]>,
): DiscoverCatalog {
  return {
    key,
    addonId: "anilist",
    addonName: "AniList",
    addonUrl: "",
    catalogId: key,
    catalogName: name,
    type: "anime",
    genres: ANILIST_GENRES,
    supportsSkip: true,
    skipStep: 25,
    source: "anilist",
    aniListSort,
  };
}

export function mergeUniqueMedia(current: MediaItem[], incoming: MediaItem[]) {
  const byKey = new Map(current.map(item => [`${normalizeType(item.type)}:${item.id}`, item]));
  let added = 0;
  for (const item of incoming) {
    const key = `${normalizeType(item.type)}:${item.id}`;
    if (!byKey.has(key)) added += 1;
    byKey.set(key, item);
  }
  return { items: Array.from(byKey.values()), added };
}

function sortLibraryItems(items: LibraryItem[], sort: LibrarySort) {
  const copy = [...items];
  const titleKey = (item: LibraryItem) => item.media.name.trim().replace(LEADING_ARTICLE, "").toLocaleLowerCase("es");
  switch (sort) {
    case "added_asc":
      return copy.sort((a, b) => a.addedAt - b.addedAt || titleKey(a).localeCompare(titleKey(b), "es"));
    case "title_asc":
      return copy.sort((a, b) => titleKey(a).localeCompare(titleKey(b), "es"));
    case "title_desc":
      return copy.sort((a, b) => titleKey(b).localeCompare(titleKey(a), "es"));
    default:
      return copy.sort((a, b) => b.addedAt - a.addedAt || titleKey(a).localeCompare(titleKey(b), "es"));
  }
}

function buildListOptions(items: LibraryItem[]): FacetOption[] {
  const counts = countBy(items, item => item.listKey);
  const labels = new Map(items.map(item => [item.listKey, item.listLabel]));
  return [{ key: ALL, label: "Todo", count: items.length }, ...Array.from(counts, ([key, count]) => ({
    key,
    label: labels.get(key) ?? key,
    count,
  }))];
}

function buildTypeOptions(allItems: LibraryItem[], filteredItems: LibraryItem[]): FacetOption[] {
  const available = typeKeys(allItems);
  const counts = countBy(filteredItems, item => normalizeType(item.media.type));
  return [
    { key: ALL, label: "Todo", count: filteredItems.length },
    ...available.map(key => ({ key, label: typeLabel(key), count: counts.get(key) ?? 0 })),
  ];
}

function buildGenreOptions(allItems: LibraryItem[], filteredItems: LibraryItem[]): FacetOption[] {
  const counts = new Map<string, number>();
  for (const item of filteredItems) {
    for (const genre of item.media.genres ?? []) {
      const key = normalizeKey(genre);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const labels = new Map<string, string>();
  for (const item of allItems) {
    for (const genre of item.media.genres ?? []) labels.set(normalizeKey(genre), genre);
  }
  return [
    { key: ALL, label: "Todos los géneros", count: filteredItems.length },
    ...genreKeys(allItems).map(key => ({ key, label: labels.get(key) ?? key, count: counts.get(key) ?? 0 })),
  ];
}

function buildYearOptions(allItems: LibraryItem[], filteredItems: LibraryItem[]): FacetOption[] {
  const counts = countBy(filteredItems.filter(item => item.media.year), item => String(item.media.year));
  return [
    { key: ALL, label: "Todos los años", count: filteredItems.length },
    ...yearKeys(allItems).map(key => ({ key, label: key, count: counts.get(key) ?? 0 })),
  ];
}

function countBy(items: LibraryItem[], keyFor: (item: LibraryItem) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function listKeys(items: LibraryItem[]) {
  return Array.from(new Set(items.map(item => item.listKey)));
}

function typeKeys(items: LibraryItem[]) {
  return Array.from(new Set(items.map(item => normalizeType(item.media.type))));
}

function genreKeys(items: LibraryItem[]) {
  return Array.from(new Set(items.flatMap(item => (item.media.genres ?? []).map(normalizeKey)))).sort();
}

function yearKeys(items: LibraryItem[]) {
  return Array.from(new Set(items.flatMap(item => item.media.year ? [String(item.media.year)] : [])))
    .sort((a, b) => Number(b) - Number(a));
}

function validateSelection(selected: string, available: string[]) {
  return selected === ALL || available.includes(selected) ? selected : ALL;
}

function normalizeType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "tv" || normalized === "show" || normalized === "anime" ? "series" : normalized;
}

function normalizeKey(value: string) {
  return value.trim().toLocaleLowerCase("es");
}

function typeLabel(type: string) {
  if (type === "movie") return "Películas";
  if (type === "series") return "Series";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function aniListStatusLabel(status: AniListLibraryEntry["status"]) {
  const labels: Record<AniListLibraryEntry["status"], string> = {
    watching: "Viendo en AniList",
    plan_to_watch: "Planeados en AniList",
    completed: "Completados en AniList",
    on_hold: "En pausa en AniList",
    dropped: "Abandonados en AniList",
  };
  return labels[status];
}

function isLibrarySort(value: unknown): value is LibrarySort {
  return ["added_desc", "added_asc", "title_asc", "title_desc"].includes(String(value));
}

function readSkipStep(extras: any[]) {
  const skip = extras.find(extra => String(extra?.name ?? "").toLowerCase() === "skip");
  const candidate = Number(skip?.step ?? skip?.skipStep ?? 100);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 100;
}

function parseYear(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
}
