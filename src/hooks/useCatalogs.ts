import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getTmdbApiKey } from "../config/apiKeys";
import type { InstalledAddon } from "../store/addonStore";
import { isFreshHomeCache, useCacheStore } from "../store/cacheStore";
import type { CatalogRowData, MediaItem } from "../types/ui";
import { sanitizeLogoUrl } from "../utils/artwork";

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";
const HERO_GROUP_FETCH_LIMIT = 7;
const HERO_TOTAL_LIMIT = 7;
const HOME_ROWS_STALE_TIME = 1000 * 60 * 30;
const HOME_HERO_STALE_TIME = 1000 * 60 * 20;
const HOME_GC_TIME = 1000 * 60 * 60 * 6;
const HOME_HERO_IMAGE_VERSION = "hero-original-v2";

function upgradeTmdbImage(url: string | undefined, size: "w1280" | "w780" | "w500" | "w342" = "w500") {
  if (!url) return url;
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `https://image.tmdb.org/t/p/${size}/`);
}

function normalizeMediaItem(item: MediaItem): MediaItem {
  return {
    ...item,
    poster: upgradeTmdbImage(item.poster, "w500"),
    background: upgradeTmdbImage(item.background, "w780"),
    logo: sanitizeLogoUrl(upgradeTmdbImage(item.logo, "w500")),
  };
}

function tmdbImage(path?: string | null, size: "original" | "w1280" | "w780" | "w500" | "w342" | "w185" = "w500") {
  return path ? `${IMG}/${size}${path}` : undefined;
}

function originalTmdbImage(url?: string) {
  if (!url) return url;
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${IMG}/original/`);
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

function enabledAddonSignature(addons: InstalledAddon[]) {
  return addons
    .filter(addon => addon.enabled)
    .map(addon => {
      const catalogs = (addon.manifest?.catalogs ?? [])
        .map((cat: any) => `${cat.type}:${cat.id}`)
        .join(",");
      return `${addon.id}|${addon.url}|${addon.version}|${catalogs}`;
    })
    .join("||");
}

function heroSignature() {
  return `${todayKey()}|${getTmdbApiKey() ? "tmdb" : "no-tmdb"}|${HOME_HERO_IMAGE_VERSION}`;
}

export const homeCatalogKeys = {
  rows: (signature: string) => ["home", "rows", signature] as const,
  hero: (signature: string) => ["home", "hero", signature] as const,
};

async function tmdbLogo(type: "movie" | "tv", id: number) {
  try {
    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) return undefined;
    const response = await fetch(`${TMDB}/${type}/${id}/images?api_key=${tmdbKey}&include_image_language=es,en,null`);
    if (!response.ok) return undefined;
    const data = await response.json();
    const logo = data.logos?.find((item: any) => item.iso_639_1 === "es")
      ?? data.logos?.find((item: any) => item.iso_639_1 === "en")
      ?? data.logos?.[0];
    return tmdbImage(logo?.file_path, "w500");
  } catch {
    return undefined;
  }
}

async function normalizeTmdbHeroItem(item: any, type: "movie" | "series" | "anime", group: string): Promise<MediaItem> {
  const tmdbType = type === "movie" ? "movie" : "tv";
  return {
    id: `tmdb:${item.id}`,
    type,
    name: item.title ?? item.name ?? "Sin titulo",
    poster: tmdbImage(item.poster_path, "w500"),
    background: tmdbImage(item.backdrop_path, "original"),
    logo: sanitizeLogoUrl(await tmdbLogo(tmdbType, item.id)),
    description: item.overview,
    rating: typeof item.vote_average === "number" && item.vote_average > 0 ? item.vote_average.toFixed(1) : undefined,
    year: yearFrom(item.release_date ?? item.first_air_date),
    heroGroup: group,
  } as MediaItem;
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

export async function fetchHomeRows(addons: InstalledAddon[]) {
  const enabledAddons = addons.filter(addon => addon.enabled);
  const rowTasks = enabledAddons.flatMap(addon =>
    (addon.manifest?.catalogs ?? []).map(async (cat: any): Promise<CatalogRowData | null> => {
      try {
        const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
        const response = await fetch(`${base}/catalog/${cat.type}/${cat.id}.json`);
        if (!response.ok) return null;
        const data = await response.json();
        const seen = new Set<string>();
        const items = (data.metas ?? [])
          .filter((item: any) => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          })
          .slice(0, 20)
          .map((item: MediaItem) => normalizeMediaItem(item));
        if (!items.length) return null;
        return { addonId: addon.id, addonName: addon.name, catalogId: cat.id, type: cat.type, name: cat.name ?? cat.id, items };
      } catch {
        // Broken addons should not break Home.
        return null;
      }
    })
  );

  const rows = await Promise.all(rowTasks);
  return rows.filter((row): row is CatalogRowData => row !== null);
}

export async function fetchHomeHero() {
  try {
    const tmdbKey = getTmdbApiKey();
    if (!tmdbKey) return [];
    const [moviesRes, seriesRes, animeRes] = await Promise.all([
      fetch(`${TMDB}/movie/popular?api_key=${tmdbKey}&language=es-ES&page=1&region=US`),
      fetch(`${TMDB}/tv/popular?api_key=${tmdbKey}&language=es-ES&page=1`),
      fetch(`${TMDB}/discover/tv?api_key=${tmdbKey}&language=es-ES&page=1&sort_by=popularity.desc&with_genres=16&with_original_language=ja&air_date.gte=${isoDate(-45)}&air_date.lte=${isoDate(7)}`),
    ]);

    const [movies, series, anime] = await Promise.all([
      moviesRes.ok ? moviesRes.json() : Promise.resolve({ results: [] }),
      seriesRes.ok ? seriesRes.json() : Promise.resolve({ results: [] }),
      animeRes.ok ? animeRes.json() : Promise.resolve({ results: [] }),
    ]);

    const [movieItems, seriesItems, animeItems] = await Promise.all([
      Promise.all((movies.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => normalizeTmdbHeroItem(item, "movie", "Popular Movies"))),
      Promise.all((series.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => normalizeTmdbHeroItem(item, "series", "Popular Series"))),
      Promise.all((anime.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => normalizeTmdbHeroItem(item, "anime", "Animes en emision"))),
    ]);

    return interleaveGroups([movieItems, seriesItems, animeItems]);
  } catch {
    return [];
  }
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
    background: originalTmdbImage(item.background),
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

  useEffect(() => {
    preloadHomeImages(rowsQuery.data ?? [], heroQuery.data ?? []);
  }, [rowsQuery.data, heroQuery.data]);

  return {
    rows: rowsQuery.data ?? [],
    heroItems: heroQuery.data ?? [],
    loading: rowsQuery.isLoading && !rowsQuery.data,
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
