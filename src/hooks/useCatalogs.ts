import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getTmdbApiKey, tmdbFetch } from "../config/apiKeys";
import { getMdbListSettings } from "../config/mdblist";
import { fetchMdbListRatingsForMedia } from "../services/MDBListService";
import type { InstalledAddon } from "../store/addonStore";
import { isFreshHomeCache, useCacheStore } from "../store/cacheStore";
import type { CatalogRowData, MediaItem } from "../types/ui";
import { sanitizeLogoUrl } from "../utils/artwork";
import { resolveDetailBackground } from "../utils/mediaMetadata";
import { readHomeCardArtwork } from "../utils/homeCardArtwork";
import { ensureOriginalTmdbImage, pickPreferredTmdbBackdrop, tmdbImage as tmdbImageUrl } from "../utils/tmdbArtwork";

const HERO_GROUP_FETCH_LIMIT = 7;
const HERO_TOTAL_LIMIT = 7;
const HOME_ROWS_STALE_TIME = 1000 * 60 * 30;
const HOME_HERO_STALE_TIME = 1000 * 60 * 20;
const HOME_GC_TIME = 1000 * 60 * 60 * 6;
const HOME_ROWS_DATA_VERSION = "native-home-rails-v5";
const HOME_HERO_IMAGE_VERSION = "hero-metadata-api-original-v4";
const HOME_EXTRA_VARIANTS_PER_CATALOG = 4;
const HOME_RAIL_ITEM_LIMIT = 18;

interface HomeCatalogRequest {
  catalog: any;
  extraParams: Record<string, string>;
  title: string;
}

interface TmdbHomeRailRequest {
  id: string;
  title: string;
  type: "movie" | "series" | "anime";
  path: string;
  params?: Record<string, string>;
  fallbacks?: Array<{
    path?: string;
    params: Record<string, string>;
  }>;
}

function upgradeTmdbImage(url: string | undefined, size: "w1280" | "w780" | "w500" | "w342" = "w500") {
  if (!url) return url;
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `https://image.tmdb.org/t/p/${size}/`);
}

function normalizeMediaItem(item: MediaItem): MediaItem {
  const detailBackground = resolveDetailBackground(item.type, item.id, item.background);
  return {
    ...item,
    poster: upgradeTmdbImage(readHomeCardArtwork("poster", item.type, item.id, item.poster), "w500"),
    background: ensureOriginalTmdbImage(readHomeCardArtwork("background", item.type, item.id, detailBackground)),
    logo: sanitizeLogoUrl(upgradeTmdbImage(item.logo, "w500")),
  };
}

function isAetherioDefaultArtwork(url: string | undefined) {
  return Boolean(url && /(?:^|[\/_-])aetherio(?:[\/_\-.]|$)/i.test(url));
}

function yearFrom(date?: string) {
  const year = Number((date ?? "").slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hashValue(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

function enabledAddonSignature(addons: InstalledAddon[]) {
  const catalogAddons = addons.filter(addon => (
    addon.enabled && Array.isArray(addon.manifest?.catalogs) && addon.manifest.catalogs.length > 0
  ));
  if (!catalogAddons.length) {
    return `${HOME_ROWS_DATA_VERSION}|aetherio-starter|${todayKey()}|${getTmdbApiKey() ? "tmdb" : "no-tmdb"}`;
  }

  return `${HOME_ROWS_DATA_VERSION}|${catalogAddons
    .map(addon => {
      const catalogs = (addon.manifest?.catalogs ?? [])
        .map((cat: any) => {
          const required = Array.isArray(cat.extraRequired) ? cat.extraRequired.join("/") : "";
          const extras = Array.isArray(cat.extra)
            ? cat.extra.map((extra: any) => `${extra?.name ?? ""}=${Array.isArray(extra?.options) ? extra.options.join("/") : ""}`).join(";")
            : "";
          return `${cat.type}:${cat.id}:${required}:${extras}`;
        })
        .join(",");
      return `${addon.id}|${addon.url}|${addon.version}|${catalogs}`;
    })
    .join("||")}`;
}

function homeRailTitle(title: string | undefined, type: string) {
  const catalogTitle = (title ?? "").trim() || "Catalogo";
  const typeLabel = (() => {
    switch (type.toLowerCase()) {
      case "movie":
        return "Películas";
      case "series":
      case "tv":
        return "Series";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  })();
  return `${catalogTitle} - ${typeLabel}`;
}

function catalogExtraList(catalog: any) {
  return Array.isArray(catalog?.extra) ? catalog.extra : [];
}

function catalogRequiredExtras(catalog: any): string[] {
  return Array.isArray(catalog?.extraRequired)
    ? catalog.extraRequired.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function homeExtraValues(catalog: any, name: string) {
  const options = catalogExtraList(catalog)
    .find((extra: any) => String(extra?.name ?? "").toLowerCase() === name.toLowerCase())
    ?.options;
  const values = Array.isArray(options)
    ? options.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (!values.length) return name.toLowerCase() === "skip" ? ["0"] : [];

  const preferredNeedles = ["anime", "animation", "animacion", "japan", "japanese"];
  const preferred = values.filter(value => preferredNeedles.some(needle => value.toLowerCase().includes(needle)));
  return [...preferred, ...values].filter((value, index, list) => list.indexOf(value) === index);
}

function homeRequests(catalog: any): HomeCatalogRequest[] {
  const required = catalogRequiredExtras(catalog).filter((item: string, index: number, list: string[]) => list.indexOf(item) === index);
  const title = String(catalog?.name ?? catalog?.title ?? catalog?.id ?? "Catalogo");
  if (!required.length) return [{ catalog, extraParams: {}, title }];
  if (required.some((item: string) => ["search", "query"].includes(item.toLowerCase()))) return [];

  if (required.length === 1) {
    const name = required[0];
    const values = homeExtraValues(catalog, name);
    return values.slice(0, HOME_EXTRA_VARIANTS_PER_CATALOG).map(value => ({
      catalog,
      extraParams: { [name]: value },
      title: `${title} - ${value}`,
    }));
  }

  const extraParams: Record<string, string> = {};
  for (const name of required) {
    const value = homeExtraValues(catalog, name)[0];
    if (!value) return [];
    extraParams[name] = value;
  }
  return [{ catalog, extraParams, title: `${title} - ${Object.values(extraParams).join(" / ")}` }];
}

function catalogEndpoint(base: string, type: string, catalogId: string, extraParams?: Record<string, string>) {
  const extras = Object.entries(extraParams ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}${extras ? `/${extras}` : ""}.json`;
}

function normalizeCatalogItem(raw: any, fallbackType: string): MediaItem | null {
  const id = String(raw?.id ?? "").trim();
  const name = String(raw?.name ?? raw?.title ?? "").trim();
  if (!id || !name) return null;
  const item = normalizeMediaItem({
    ...raw,
    id,
    type: raw?.type ?? fallbackType,
    name,
    poster: raw?.poster ?? raw?.posterUrl,
    background: raw?.background ?? raw?.backdrop ?? raw?.backdropUrl,
    logo: raw?.logo ?? raw?.logoUrl,
    description: raw?.description ?? raw?.overview,
    year: typeof raw?.year === "number" ? raw.year : yearFrom(raw?.year ?? raw?.releaseInfo ?? raw?.released),
  });
  if (!item.poster && !item.background) return null;
  return item;
}

function heroSignature() {
  const mdbList = getMdbListSettings();
  const mdbListSignature = mdbList.enabled && mdbList.apiKey.trim()
    ? `mdb:${[
      mdbList.showTrakt,
      mdbList.showImdb,
      mdbList.showTmdb,
      mdbList.showLetterboxd,
      mdbList.showTomatoes,
      mdbList.showMetacritic,
    ].map(Boolean).join("")}:${hashValue(mdbList.apiKey)}`
    : "no-mdb";
  return `${todayKey()}|${getTmdbApiKey() ? "tmdb" : "no-tmdb"}|${mdbListSignature}|${HOME_HERO_IMAGE_VERSION}`;
}

export const homeCatalogKeys = {
  rows: (signature: string) => ["home", "rows", signature] as const,
  hero: (signature: string) => ["home", "hero", signature] as const,
};

async function tmdbArtwork(type: "movie" | "tv", id: number, fallbackBackdropPath?: string | null) {
  try {
    const data = await tmdbFetch(`/${type}/${id}/images`, { params: { include_image_language: "es,en,null" } });
    if (!data) return {};
    const logo = data.logos?.find((item: any) => item.iso_639_1 === "es")
      ?? data.logos?.find((item: any) => item.iso_639_1 === "en")
      ?? data.logos?.[0];
    return {
      logo: tmdbImageUrl(logo?.file_path, "w500"),
      background: pickPreferredTmdbBackdrop(data.backdrops, fallbackBackdropPath),
    };
  } catch {
    return {};
  }
}

async function normalizeTmdbHeroItem(item: any, type: "movie" | "series" | "anime", group: string): Promise<MediaItem> {
  const tmdbType = type === "movie" ? "movie" : "tv";
  const artwork = await tmdbArtwork(tmdbType, item.id, item.backdrop_path);
  return {
    id: `tmdb:${item.id}`,
    type,
    name: item.title ?? item.name ?? "Sin titulo",
    poster: tmdbImageUrl(item.poster_path, "w500"),
    background: artwork.background ?? tmdbImageUrl(item.backdrop_path, "original"),
    logo: sanitizeLogoUrl(artwork.logo),
    description: item.overview,
    rating: typeof item.vote_average === "number" && item.vote_average > 0 ? item.vote_average.toFixed(1) : undefined,
    year: yearFrom(item.release_date ?? item.first_air_date),
    heroGroup: group,
  } as MediaItem;
}

function normalizeTmdbCatalogItem(item: any, type: "movie" | "series" | "anime", group: string): MediaItem | null {
  const id = Number(item?.id);
  const name = String(item?.title ?? item?.name ?? "").trim();
  if (!Number.isFinite(id) || !name) return null;

  const normalized = normalizeMediaItem({
    id: `tmdb:${id}`,
    type,
    name,
    poster: tmdbImageUrl(item.poster_path, "w500"),
    background: tmdbImageUrl(item.backdrop_path, "original"),
    description: item.overview,
    rating: typeof item.vote_average === "number" && item.vote_average > 0 ? item.vote_average.toFixed(1) : undefined,
    year: yearFrom(item.release_date ?? item.first_air_date),
    heroGroup: group,
  });
  return normalized.poster || normalized.background ? normalized : null;
}

function interleaveGroups(groups: MediaItem[][]) {
  const mixed: MediaItem[] = [];
  for (let i = 0; i < HERO_GROUP_FETCH_LIMIT && mixed.length < HERO_TOTAL_LIMIT; i += 1) {
    for (const group of groups) {
      if (group[i] && mixed.length < HERO_TOTAL_LIMIT) mixed.push(group[i]);
    }
  }
  return mixed;
}

function mergeHeroItems(tmdbItems: MediaItem[] = [], rows: CatalogRowData[] = []) {
  const merged: MediaItem[] = [];
  const seen = new Set<string>();

  const add = (item: MediaItem, group?: string) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return;
    const background = ensureOriginalTmdbImage(resolveDetailBackground(item.type, item.id, item.background));
    if (!background || isAetherioDefaultArtwork(background)) return;
    seen.add(key);
    merged.push({
      ...item,
      background,
      logo: sanitizeLogoUrl(item.logo),
      heroGroup: item.heroGroup ?? group,
    });
  };

  const sourceRows = rows.slice(0, 4);
  if (sourceRows.length) {
    for (const row of sourceRows) {
      for (const item of row.items.slice(0, 8)) {
        add(item, row.name);
      }
    }
  }

  for (const item of tmdbItems) add(item, item.heroGroup);
  return merged
    .sort((a, b) => heroRandomValue(a) - heroRandomValue(b))
    .slice(0, HERO_TOTAL_LIMIT);
}

function heroRandomValue(item: MediaItem) {
  return Number(hashValue(`${todayKey()}|${item.type}|${item.id}|${item.heroGroup ?? ""}`));
}

export async function fetchHomeRows(addons: InstalledAddon[]) {
  const enabledAddons = addons.filter(addon => addon.enabled);
  const rowTasks = enabledAddons.flatMap(addon =>
    (addon.manifest?.catalogs ?? [])
      .filter((cat: any) => cat?.type && cat?.id)
      .flatMap((cat: any) => homeRequests(cat).map(async (request): Promise<CatalogRowData | null> => {
      try {
        const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
        const response = await fetch(catalogEndpoint(base, request.catalog.type, request.catalog.id, request.extraParams));
        if (!response.ok) return null;
        const data = await response.json();
        const seen = new Set<string>();
        const items = (data.metas ?? [])
          .map((item: any) => normalizeCatalogItem(item, request.catalog.type))
          .filter((item: MediaItem | null): item is MediaItem => {
            if (!item || seen.has(`${item.type}:${item.id}`)) return false;
            seen.add(`${item.type}:${item.id}`);
            return true;
          })
          .slice(0, HOME_RAIL_ITEM_LIMIT);
        if (!items.length) return null;
        return {
          addonId: addon.id,
          addonName: addon.name,
          catalogId: request.catalog.id,
          type: request.catalog.type,
          name: homeRailTitle(request.title, request.catalog.type),
          subtitle: addon.name,
          extraParams: request.extraParams,
          items,
        };
      } catch {
        // Broken addons should not break Home.
        return null;
      }
    }))
  );

  const rows = await Promise.all(rowTasks);
  const addonRows = rows.filter((row): row is CatalogRowData => row !== null);
  return addonRows.length ? addonRows : fetchAetherioStarterRows();
}

async function fetchAetherioStarterRows(): Promise<CatalogRowData[]> {
  const animeBase = { with_genres: "16", with_original_language: "ja" };
  const currentSeason = currentAnimeSeasonWindow();
  const requests: TmdbHomeRailRequest[] = [
    // El orden replica la base usada por el perfil de desarrollo trkldev.
    { id: "tmdb.top_series", title: "Popular - Series", type: "series", path: "/tv/popular" },
    { id: "tmdb.trending_movie", title: "Tendencias - Películas", type: "movie", path: "/trending/movie/day" },
    { id: "tmdb.top_movie", title: "Popular - Películas", type: "movie", path: "/movie/popular" },
    { id: "tmdb.trending_series", title: "Tendencias - Series", type: "series", path: "/trending/tv/day" },
    {
      id: "mal.airing_anime",
      title: "Emitiéndose ahora - Anime",
      type: "anime",
      path: "/discover/tv",
      params: { ...animeBase, sort_by: "first_air_date.desc", "air_date.gte": isoDate(-45), "air_date.lte": isoDate(7) },
    },
    {
      id: "mal.schedule_anime",
      title: "Estrenos de hoy - Anime",
      type: "anime",
      path: "/discover/tv",
      params: { ...animeBase, sort_by: "popularity.desc", "air_date.gte": isoDate(), "air_date.lte": isoDate() },
    },
    {
      id: "mal.seasons_anime",
      title: `${currentSeason.label} - Anime`,
      type: "anime",
      path: "/discover/tv",
      params: {
        ...animeBase,
        sort_by: "popularity.desc",
        "first_air_date.gte": currentSeason.start,
        "first_air_date.lte": currentSeason.end,
      },
    },
    ...animeDecadeRequests(),
    {
      id: "mal.genres_anime",
      title: "Anime de acción",
      type: "anime",
      path: "/discover/tv",
      params: { ...animeBase, sort_by: "popularity.desc", with_genres: "16,10759" },
    },
    {
      id: "mal.top_series_anime",
      title: "Top Series - Anime",
      type: "anime",
      path: "/discover/tv",
      params: { ...animeBase, sort_by: "vote_average.desc", "vote_count.gte": "200" },
    },
    {
      id: "mal.most_favorites_anime",
      title: "Las favoritas - Anime",
      type: "anime",
      path: "/discover/tv",
      params: { ...animeBase, sort_by: "vote_count.desc" },
    },
    {
      id: "mal.most_popular_anime",
      title: "Más popular - Anime",
      type: "anime",
      path: "/discover/tv",
      params: { ...animeBase, sort_by: "popularity.desc" },
    },
    ...streamingProviderRequests(),
  ];

  const rows = await Promise.all(requests.map(async (request): Promise<CatalogRowData | null> => {
    const results = await fetchStarterTmdbResults(request);
    const seen = new Set<string>();
    const items = results
      .map((item: any) => normalizeTmdbCatalogItem(item, request.type, request.title))
      .filter((item: MediaItem | null): item is MediaItem => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, HOME_RAIL_ITEM_LIMIT);
    if (!items.length) return null;
    return {
      addonId: "aetherio-starter",
      addonName: "Aetherio",
      catalogId: request.id,
      type: request.type,
      name: request.title,
      subtitle: "Actualizado con TMDB",
      items,
    } satisfies CatalogRowData;
  }));

  return rows.filter((row): row is CatalogRowData => row !== null);
}

async function fetchStarterTmdbResults(request: TmdbHomeRailRequest) {
  const variants = [
    { path: request.path, params: request.params ?? {} },
    ...(request.fallbacks ?? []).map(fallback => ({ path: fallback.path ?? request.path, params: fallback.params })),
  ];

  for (const variant of variants) {
    try {
      const data = await tmdbFetch<any>(variant.path, {
        params: { language: "es-ES", page: "1", region: "PE", ...variant.params },
      });
      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length) return results;
    } catch {
      // Keep the starter Home resilient if one provider/region is unavailable.
    }
  }

  return [];
}

function currentAnimeSeasonWindow() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startMonth = Math.floor(month / 3) * 3;
  const seasonNames = ["Invierno", "Primavera", "Verano", "Otoño"];
  const start = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, startMonth + 3, 0)).toISOString().slice(0, 10);
  return { start, end, label: `${seasonNames[startMonth / 3]} ${year}` };
}

function animeDecadeRequests(): TmdbHomeRailRequest[] {
  return [
    { id: "mal.80sDecade_anime", title: "Lo mejor de los 80 - Anime", start: 1980, end: 1989 },
    { id: "mal.90sDecade_anime", title: "Lo mejor de los 90 - Anime", start: 1990, end: 1999 },
    { id: "mal.00sDecade_anime", title: "Lo mejor de los 2000 - Anime", start: 2000, end: 2009 },
    { id: "mal.10sDecade_anime", title: "Lo mejor de los 2010 - Anime", start: 2010, end: 2019 },
    { id: "mal.20sDecade_anime", title: "Lo mejor de los 2020 - Anime", start: 2020, end: 2029 },
  ].map(decade => ({
    id: decade.id,
    title: decade.title,
    type: "anime" as const,
    path: "/discover/tv",
    params: {
      sort_by: "vote_average.desc",
      with_genres: "16",
      with_original_language: "ja",
      "vote_count.gte": "100",
      "first_air_date.gte": `${decade.start}-01-01`,
      "first_air_date.lte": `${decade.end}-12-31`,
    },
  }));
}

function streamingProviderRequests(): TmdbHomeRailRequest[] {
  const providers = [
    { id: "netflix", name: "Netflix", providerIds: ["8"], networkIds: ["213"], companyIds: ["213"] },
    { id: "hbo_max", name: "HBO Max", providerIds: ["1899", "384"], networkIds: ["49", "3186"], companyIds: ["174", "3268"] },
    { id: "disney", name: "Disney+", providerIds: ["337"], networkIds: ["2739"], companyIds: ["2", "6125"] },
    { id: "prime_video", name: "Prime Video", providerIds: ["9"], networkIds: ["1024"], companyIds: ["1024"] },
    { id: "apple_tv", name: "Apple TV+", providerIds: ["350"], networkIds: ["2552"], companyIds: ["2552"] },
  ];

  return providers.flatMap(provider => ([
    {
      id: `tmdb.discover.movie.streaming_${provider.id}`,
      title: `${provider.name} - Películas`,
      type: "movie" as const,
      path: "/discover/movie",
      params: providerParams(provider.providerIds, "PE"),
      fallbacks: [
        { params: providerParams(provider.providerIds, "US") },
        { params: companyParams(provider.companyIds) },
      ],
    },
    {
      id: `tmdb.discover.series.streaming_${provider.id}`,
      title: `${provider.name} - Series`,
      type: "series" as const,
      path: "/discover/tv",
      params: providerParams(provider.providerIds, "PE"),
      fallbacks: [
        { params: providerParams(provider.providerIds, "US") },
        { params: networkParams(provider.networkIds) },
      ],
    },
  ]));
}

function providerParams(providerIds: string[], region: "PE" | "US") {
  return {
    sort_by: "popularity.desc",
    region,
    watch_region: region,
    with_watch_monetization_types: "flatrate",
    with_watch_providers: providerIds.join("|"),
  };
}

function networkParams(networkIds: string[]) {
  return {
    sort_by: "popularity.desc",
    with_networks: networkIds.join("|"),
  };
}

function companyParams(companyIds: string[]) {
  return {
    sort_by: "popularity.desc",
    with_companies: companyIds.join("|"),
  };
}

export async function fetchHomeHero() {
  try {
    const [movies, series, anime] = await Promise.all([
      tmdbFetch("/movie/popular", { params: { language: "es-ES", page: "1", region: "US" } }),
      tmdbFetch("/tv/popular", { params: { language: "es-ES", page: "1" } }),
      tmdbFetch("/discover/tv", { params: { language: "es-ES", page: "1", sort_by: "popularity.desc", with_genres: "16", with_original_language: "ja", air_date_gte: isoDate(-45), air_date_lte: isoDate(7) } }),
    ]);

    const [movieItems, seriesItems, animeItems] = await Promise.all([
      Promise.all(((movies as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => normalizeTmdbHeroItem(item, "movie", "Popular Movies"))),
      Promise.all(((series as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => normalizeTmdbHeroItem(item, "series", "Popular Series"))),
      Promise.all(((anime as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => normalizeTmdbHeroItem(item, "anime", "Animes en emisión"))),
    ]);

    return enrichHeroRatings(interleaveGroups([movieItems, seriesItems, animeItems]));
  } catch {
    return [];
  }
}

async function enrichHeroRatings(items: MediaItem[]) {
  const settings = getMdbListSettings();
  if (!settings.enabled || !settings.apiKey.trim()) return items;

  const enriched = await Promise.all(items.map(async item => {
    const ratings = await fetchMdbListRatingsForMedia({
      settings,
      mediaType: item.type,
      mediaId: item.id,
      imdbId: item.id,
    });
    return ratings ? { ...item, mdbListRatings: ratings } : item;
  }));

  return enriched;
}

function cachedRows(signature: string) {
  const home = useCacheStore.getState().home;
  if (!home || home.rowsSignature !== signature || !isFreshHomeCache(home.rowsUpdatedAt)) return undefined;
  return home.rows;
}

function cachedHero(signature: string) {
  const home = useCacheStore.getState().home;
  if (!home || home.heroSignature !== signature || !isFreshHomeCache(home.heroUpdatedAt)) return undefined;
  return home.heroItems.map(item => ({
    ...item,
    background: ensureOriginalTmdbImage(item.background),
  }));
}

export function prefetchHomeData(queryClient: QueryClient, addons: InstalledAddon[]) {
  const rowsSignature = enabledAddonSignature(addons);
  const currentHeroSignature = heroSignature();
  const home = useCacheStore.getState().home;
  const rows = cachedRows(rowsSignature);
  const hero = cachedHero(currentHeroSignature);

  if (rows) {
    queryClient.setQueryData(homeCatalogKeys.rows(rowsSignature), rows, { updatedAt: home?.rowsUpdatedAt });
  }
  if (hero) {
    queryClient.setQueryData(homeCatalogKeys.hero(currentHeroSignature), hero, { updatedAt: home?.heroUpdatedAt });
  }

  void queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    queryFn: () => fetchHomeRows(addons),
    staleTime: HOME_ROWS_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
  void queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.hero(currentHeroSignature),
    queryFn: fetchHomeHero,
    staleTime: HOME_HERO_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
}

export function useHomeCatalogs(addons: InstalledAddon[]) {
  const queryClient = useQueryClient();
  const rowsSignature = enabledAddonSignature(addons);
  const currentHeroSignature = heroSignature();
  const initialRows = cachedRows(rowsSignature);
  const initialHero = cachedHero(currentHeroSignature);
  const [starterImagesReady, setStarterImagesReady] = useState(false);

  const rowsQuery = useQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    queryFn: () => fetchHomeRows(addons),
    initialData: initialRows,
    initialDataUpdatedAt: initialRows ? useCacheStore.getState().home?.rowsUpdatedAt : undefined,
    staleTime: HOME_ROWS_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });

  const heroQuery = useQuery({
    queryKey: homeCatalogKeys.hero(currentHeroSignature),
    queryFn: fetchHomeHero,
    initialData: initialHero,
    initialDataUpdatedAt: initialHero ? useCacheStore.getState().home?.heroUpdatedAt : undefined,
    staleTime: HOME_HERO_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });

  useEffect(() => {
    if (rowsQuery.data) {
      useCacheStore.getState().setHomeRows(rowsQuery.data, rowsSignature);
    }
  }, [rowsQuery.data, rowsSignature]);

  useEffect(() => {
    if (heroQuery.data) {
      useCacheStore.getState().setHomeHero(heroQuery.data, currentHeroSignature);
    }
  }, [heroQuery.data, currentHeroSignature]);

  useEffect(() => {
    prefetchHomeData(queryClient, addons);
  }, [addons, queryClient]);

  const rows = rowsQuery.data ?? [];
  const heroItems = useMemo(() => mergeHeroItems(heroQuery.data ?? [], rows), [heroQuery.data, rows]);
  const usingStarterRows = rows.length > 0 && rows.every(row => row.addonId === "aetherio-starter");

  useEffect(() => {
    if (!usingStarterRows) {
      setStarterImagesReady(true);
      preloadHomeImages(rows, heroItems);
      return;
    }
    if (heroQuery.isLoading && !heroQuery.data) {
      setStarterImagesReady(false);
      return;
    }

    let cancelled = false;
    setStarterImagesReady(false);
    void preloadStarterHomeImages(rows, heroItems).then(() => {
      if (!cancelled) setStarterImagesReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [heroItems, heroQuery.data, heroQuery.isLoading, rows, usingStarterRows]);

  return {
    rows,
    heroItems,
    loading: (rowsQuery.isLoading && !rowsQuery.data)
      || (usingStarterRows && heroQuery.isLoading && !heroQuery.data)
      || (usingStarterRows && !starterImagesReady),
  };
}

function preloadHomeImages(rows: CatalogRowData[], heroItems: MediaItem[]) {
  if (typeof Image === "undefined") return;
  const urls = new Set<string>();

  for (const item of heroItems.slice(0, 4)) {
    if (item.background) urls.add(item.background);
    if (item.logo) urls.add(item.logo);
  }

  for (const row of rows.slice(0, 4)) {
    for (const item of row.items.slice(0, 8)) {
      const image = item.background ?? item.poster;
      if (image) urls.add(image);
      if (item.logo) urls.add(item.logo);
    }
  }

  for (const url of urls) {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  }
}

async function preloadStarterHomeImages(rows: CatalogRowData[], heroItems: MediaItem[]) {
  if (typeof Image === "undefined") return;
  const urls = collectStarterHomeImageUrls(rows, heroItems);
  await preloadImageUrls(urls);
}

function collectStarterHomeImageUrls(rows: CatalogRowData[], heroItems: MediaItem[]) {
  const urls = new Set<string>();

  for (const item of heroItems) {
    if (item.background) urls.add(item.background);
    if (item.logo) urls.add(item.logo);
  }

  for (const row of rows) {
    for (const item of row.items) {
      const background = readHomeCardArtwork(
        "background",
        item.type,
        item.id,
        resolveDetailBackground(item.type, item.id, item.background) ?? item.background,
      );
      const poster = readHomeCardArtwork("poster", item.type, item.id, item.poster);
      if (background) urls.add(background);
      if (poster) urls.add(poster);
      if (item.logo) urls.add(item.logo);
    }
  }

  return [...urls];
}

async function preloadImageUrls(urls: string[]) {
  const workers = Math.min(12, urls.length);
  let index = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (index < urls.length) {
      const url = urls[index];
      index += 1;
      await preloadImage(url);
    }
  }));
}

function preloadImage(url: string) {
  return new Promise<void>(resolve => {
    const image = new Image();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    image.decoding = "async";
    image.onload = () => {
      const decode = image.decode?.();
      if (decode) void decode.then(done).catch(done);
      else done();
    };
    image.onerror = done;
    image.src = url;
    if (image.complete) done();
  });
}
