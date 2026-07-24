import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTmdbApiKey, getTmdbApiKeyAsync, tmdbFetch } from "../config/apiKeys.ts";
import { getMdbListSettings } from "../config/mdblist.ts";
import {
  fetchAnilistAiringAnime,
  fetchAnilistMostFavorites,
  fetchAnilistTopAnime,
  fetchAnilistTopAiring,
  fetchAnilistActionAnime,
  fetchAnilistAdventureAnime,
  fetchAnilistComedyAnime,
  fetchAnilistDramaAnime,
  fetchAnilistRomanceAnime,
  fetchAnilistFantasyAnime,
  fetchAnilistSciFiAnime,
  fetchAnilistLastYearBestAnime,
  resolveAnilistToTmdb,
} from "../services/anilist.ts";
import {
  fetchJikanUpcoming,
  fetchJikanTopMovies,
  fetchJikanTopOva,
  fetchJikanTopOna,
  fetchJikanTopSpecials,
  fetchJikanRecommendations,
  fetchJikanTopAiring,
  fetchJikanTopUpcoming,
  fetchJikanTopFavorites,
  fetchJikanMostPopular,
  fetchJikanAction,
  fetchJikanAdventure,
  fetchJikanRomance,
  fetchJikanComedy,
  fetchJikanFantasy,
  fetchJikanSciFi,
  fetchJikanSliceOfLife,
  fetchJikanPsychological,
  resolveMalToTmdb,
  runJikanSerial,
} from "../services/jikan.ts";
import { fetchMdbListRatingsForMedia } from "../services/MDBListService.ts";
import { fetchYouTubeClip } from "../services/youtubeClips.ts";
import type { InstalledAddon } from "../store/addonStore.ts";
import { isFreshHomeCache, useCacheStore } from "../store/cacheStore.ts";
import type { CatalogRowData, MediaItem } from "../types/ui.ts";
import { type ContentOrientation } from "../config/homePreferences.ts";
import { sanitizeLogoUrl } from "../utils/artwork.ts";
import { resolveDetailBackground } from "../utils/mediaMetadata.ts";
import { readHomeCardArtwork } from "../utils/homeCardArtwork.ts";
import { pickPreferredTmdbBackdrop, tmdbImage as tmdbImageUrl } from "../utils/tmdbArtwork.ts";

const HERO_GROUP_FETCH_LIMIT = 7;
const HERO_TOTAL_LIMIT = 15;
const HOME_ROWS_STALE_TIME = 0;
const HOME_HERO_STALE_TIME = 0;
const HOME_GC_TIME = 1000 * 60 * 60 * 24;
const HOME_ROWS_DATA_VERSION = "native-home-rails-v13";
const HOME_HERO_IMAGE_VERSION = "hero-metadata-api-original-v4";
const HOME_EXTRA_VARIANTS_PER_CATALOG = 4;
const HOME_RAIL_ITEM_LIMIT = 10;

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

function stripSeasonPattern(name: string): string | null {
  const cleaned = name.trim();
  const match = cleaned.match(/^(.*?)\s+(?:(?:Season|Part|Cour|Saga)\s+\d+|S\d{1,2}|\d+(?:st|nd|rd|th)\s+Season)\s*$/i);
  if (match && match[1].trim().length > 0) return match[1].trim();
  return null;
}

function normalizeMediaItem(item: MediaItem): MediaItem {
  const detailBackground = resolveDetailBackground(item.type, item.id, item.background);
  return {
    ...item,
    poster: upgradeTmdbImage(readHomeCardArtwork("poster", item.type, item.id, item.poster), "w342"),
    background: upgradeTmdbImage(readHomeCardArtwork("background", item.type, item.id, detailBackground), "w500"),
    logo: sanitizeLogoUrl(upgradeTmdbImage(item.logo, "w342")),
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

function enabledAddonSignature(addons: InstalledAddon[], contentOrientation: ContentOrientation = "both") {
  const catalogAddons = addons.filter(addon => (
    addon.enabled && Array.isArray(addon.manifest?.catalogs) && addon.manifest.catalogs.length > 0
  ));
  const orientationTag = `|orient:${contentOrientation}`;
  if (!catalogAddons.length) {
    return `${HOME_ROWS_DATA_VERSION}|aetherio-starter|${todayKey()}|${getTmdbApiKey() ? "tmdb" : "no-tmdb"}${orientationTag}`;
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
    .join("||")}${orientationTag}`;
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
    const data = await tmdbFetch<any>(`/${type}/${id}`, {
      params: { append_to_response: "images", include_image_language: "es,en,null", language: "es-ES" },
    });
    if (!data) return {};
    const images = data.images;
    const logo = images?.logos?.find((item: any) => item.iso_639_1 === "es")
      ?? images?.logos?.find((item: any) => item.iso_639_1 === "en")
      ?? images?.logos?.[0];
    const hasDescription = Boolean(data.overview?.trim());
    return {
      logo: tmdbImageUrl(logo?.file_path, "w500"),
      background: pickPreferredTmdbBackdrop(images?.backdrops, fallbackBackdropPath),
      description: hasDescription ? data.overview : undefined,
    };
  } catch {
    return {};
  }
}

async function enrichAllItemsWithLogos(items: MediaItem[]): Promise<MediaItem[]> {
  const CONCURRENCY = 6;
  const results: MediaItem[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      const item = items[i];
      const tmdbId = Number(item.id.replace("tmdb:", ""));
      if (!Number.isFinite(tmdbId)) {
        results[i] = item;
        continue;
      }
      if (item.logo && item.description) {
        results[i] = item;
        continue;
      }
      const tmdbType = item.type === "movie" ? "movie" : "tv";
      try {
        let artwork = await tmdbArtwork(tmdbType, tmdbId);
        if (!artwork.description && tmdbType === "tv") {
          artwork = await tmdbArtwork("movie", tmdbId);
        }
        results[i] = {
          ...item,
          logo: artwork.logo ?? item.logo,
          description: artwork.description ?? item.description,
        };
      } catch {
        results[i] = item;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

async function normalizeTmdbHeroItem(item: any, type: "movie" | "series" | "anime", group: string): Promise<MediaItem> {
  const tmdbType = type === "movie" ? "movie" : "tv";
  const appendTo = type === "movie" ? "images,release_dates" : "images,content_ratings";
  const detail = await tmdbFetch<any>(`/${tmdbType}/${item.id}`, {
    params: { append_to_response: appendTo, include_image_language: "es,en,null" },
  });

  let logo: string | undefined;
  let background: string | undefined;
  let runtime: string | undefined;
  let genres: string[] | undefined;
  let certification: string | undefined;
  let isAnime = false;

  if (detail) {
    const images = detail.images;
    if (images) {
      const logoData = images.logos?.find((l: any) => l.iso_639_1 === "es")
        ?? images.logos?.find((l: any) => l.iso_639_1 === "en")
        ?? images.logos?.[0];
      logo = tmdbImageUrl(logoData?.file_path, "w500");
      background = pickPreferredTmdbBackdrop(images.backdrops, item.backdrop_path);
    }

    const mins = type === "movie" ? detail.runtime : detail.episode_run_time?.[0];
    if (typeof mins === "number" && mins > 0) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      runtime = `${h}h ${m.toString().padStart(2, "0")}min`;
    }

    const genreList = detail.genres;
    if (Array.isArray(genreList) && genreList.length) {
      genres = genreList.map((g: any) => g.name);
    }

    const hasAnimationGenre = Array.isArray(genreList) && genreList.some((g: any) => g.id === 16);
    const isJapanese = detail.original_language === "ja";
    if (hasAnimationGenre && isJapanese) {
      isAnime = true;
    }

    if (type === "movie") {
      const us = detail.release_dates?.results?.find((r: any) => r.iso_3166_1 === "US");
      certification = us?.release_dates?.[0]?.certification || undefined;
    } else {
      const us = detail.content_ratings?.results?.find((r: any) => r.iso_3166_1 === "US");
      certification = us?.rating || undefined;
    }
  }

  return {
    id: `tmdb:${item.id}`,
    type: isAnime ? "anime" : type,
    name: item.title ?? item.name ?? "Sin titulo",
    poster: tmdbImageUrl(item.poster_path, "w500"),
    background: background ?? tmdbImageUrl(item.backdrop_path, "original"),
    logo: sanitizeLogoUrl(logo),
    description: detail?.overview ?? item.overview,
    rating: typeof item.vote_average === "number" && item.vote_average > 0 ? item.vote_average.toFixed(1) : undefined,
    year: yearFrom(item.release_date ?? item.first_air_date),
    genres,
    runtime,
    certification,
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
    const background = upgradeTmdbImage(resolveDetailBackground(item.type, item.id, item.background), "w1280");
    if (!background || isAetherioDefaultArtwork(background)) return;
    seen.add(key);
    merged.push({
      ...item,
      background,
      logo: sanitizeLogoUrl(item.logo),
      heroGroup: item.heroGroup ?? group,
    });
  };

  const sourceRows = rows.slice(0, 6);
  for (const row of sourceRows) {
    if (merged.length >= HERO_TOTAL_LIMIT) break;
    for (const item of row.items.slice(0, 8)) {
      if (merged.length >= HERO_TOTAL_LIMIT) break;
      add(item, row.name);
    }
  }

  for (const item of tmdbItems) {
    if (merged.length >= HERO_TOTAL_LIMIT) break;
    add(item, item.heroGroup);
  }

  return merged
    .sort((a, b) => heroRandomValue(a) - heroRandomValue(b))
    .slice(0, HERO_TOTAL_LIMIT);
}

function heroRandomValue(item: MediaItem) {
  return Number(hashValue(`${todayKey()}|${item.type}|${item.id}|${item.heroGroup ?? ""}`));
}

export async function fetchHomeRows(addons: InstalledAddon[], contentOrientation: ContentOrientation = "both") {
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
  const baseRows = addonRows.length ? addonRows : await fetchTmdbStarterRows();

  if (contentOrientation === "both") {
    const animeRows = await fetchAnimeRows();
    if (!animeRows.length) return baseRows;

    const baseItemIds = new Set(baseRows.flatMap(r => r.items).map(i => `${i.type}:${i.id}`));
    const filteredAnimeRows = animeRows.map(row => ({
      ...row,
      items: row.items.filter(item => !baseItemIds.has(`${item.type}:${item.id}`)),
    })).filter(row => row.items.length > 0);

    if (!filteredAnimeRows.length) return baseRows;

    const malResolvedRows = await Promise.all(
      filteredAnimeRows.map(async row => ({
        ...row,
        items: await resolveMalToTmdb(row.items),
      })),
    );
    const resolvedAnimeRows = await Promise.all(
      malResolvedRows.map(async row => ({
        ...row,
        items: await resolveAnilistToTmdb(row.items),
      })),
    );

    const dedupedAnimeRows = resolvedAnimeRows.map(row => {
      const seen = new Set<string>();
      return {
        ...row,
        items: row.items.filter(item => {
          const base = stripSeasonPattern(item.name);
          const key = (base ?? item.name).toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    });

    const validAnimeRows = dedupedAnimeRows.filter(row => row.items.length > 0);

    const balanced = buildBothModeRows(baseRows, validAnimeRows);
    const allEnriched = await enrichAllItemsWithLogos(balanced.flatMap(row => row.items));
    let offset = 0;
    return balanced.map(row => {
      const items = allEnriched.slice(offset, offset + row.items.length);
      offset += row.items.length;
      return { ...row, items };
    });
  }

  const animeRows = await fetchAnimeRows();
  const baseItemIds = new Set(baseRows.flatMap(r => r.items).map(i => `${i.type}:${i.id}`));
  const filteredAnimeRows = (animeRows.length
    ? animeRows.map(row => ({
      ...row,
      items: row.items.filter(item => !baseItemIds.has(`${item.type}:${item.id}`)),
    })).filter(row => row.items.length > 0)
    : []
  );

  let validAnimeRows: CatalogRowData[] = [];
  if (filteredAnimeRows.length) {
    const malResolvedRows = await Promise.all(
      filteredAnimeRows.map(async row => ({
        ...row,
        items: await resolveMalToTmdb(row.items),
      })),
    );
    const resolvedAnimeRows = await Promise.all(
      malResolvedRows.map(async row => ({
        ...row,
        items: await resolveAnilistToTmdb(row.items),
      })),
    );

    const dedupedAnimeRows = resolvedAnimeRows.map(row => {
      const seen = new Set<string>();
      return {
        ...row,
        items: row.items.filter(item => {
          const base = stripSeasonPattern(item.name);
          const key = (base ?? item.name).toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      };
    });

    validAnimeRows = dedupedAnimeRows.filter(row => row.items.length > 0);
  }

  const shuffledAnime = [...validAnimeRows].sort(() => Math.random() - 0.5);
  const shuffledBase = [...baseRows].sort(() => Math.random() - 0.5).slice(0, 5);
  const combined = shuffledAnime.length ? [...shuffledAnime, ...shuffledBase] : baseRows;

  const allEnriched = await enrichAllItemsWithLogos(combined.flatMap(row => row.items));
  let offset = 0;
  return combined.map(row => {
    const items = allEnriched.slice(offset, offset + row.items.length);
    offset += row.items.length;
    return { ...row, items };
  });
}

async function fetchTmdbStarterRows(): Promise<CatalogRowData[]> {
  const requests: TmdbHomeRailRequest[] = [
    { id: "tmdb.top_series", title: "Popular - Series", type: "series", path: "/tv/popular" },
    { id: "tmdb.trending_movie", title: "Tendencias - Películas", type: "movie", path: "/trending/movie/day" },
    { id: "tmdb.top_movie", title: "Popular - Películas", type: "movie", path: "/movie/popular" },
    { id: "tmdb.trending_series", title: "Tendencias - Series", type: "series", path: "/trending/tv/day" },
    ...streamingProviderRequests(),
  ];

  const tmdbRows = await Promise.all(requests.map(async (request): Promise<CatalogRowData | null> => {
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

  const validRows = tmdbRows.filter((row): row is CatalogRowData => row !== null);
  if (!validRows.length) return [];

  const allItems = validRows.flatMap(row => row.items);
  const enrichedItems = await enrichAllItemsWithLogos(allItems);

  let offset = 0;
  return validRows.map(row => {
    const items = enrichedItems.slice(offset, offset + row.items.length);
    offset += row.items.length;
    return { ...row, items };
  });
}

async function fetchAnimeRows(): Promise<CatalogRowData[]> {
  const animeBase = { with_genres: "16", with_original_language: "ja" };

  interface AnimeEntry {
    id: string;
    title: string;
    fetch: () => Promise<MediaItem[]>;
    tmdb?: Record<string, string | undefined>;
    kind: "current" | "top" | "genre" | "other";
    order: number;
  }

  // Order defines dedupe precedence: lower wins.
  const anilistEntries: AnimeEntry[] = [
    { id: "mal.airing_anime", title: "Sonando fuerte esta temporada", fetch: fetchAnilistAiringAnime, kind: "current", tmdb: { sort_by: "popularity.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90) }, order: 1 },
    { id: "mal.top_anime", title: "Los reyes del anime", fetch: fetchAnilistTopAnime, kind: "top", tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" }, order: 4 },
    { id: "mal.most_favorites_anime", title: "Favoritos de la comunidad", fetch: fetchAnilistMostFavorites, kind: "top", tmdb: { sort_by: "vote_count.desc" }, order: 6 },
    { id: "mal.top_airing_anime", title: "Mejor puntuados ahora", fetch: fetchAnilistTopAiring, kind: "current", tmdb: { sort_by: "vote_average.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90), "vote_count.gte": "10" }, order: 2 },
    { id: "mal.action_anime", title: "Puro Acción", fetch: fetchAnilistActionAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "popularity.desc", with_genres: "16,10759" }, order: 30 },
    { id: "mal.adventure", title: "Aventuras del otro mundo", fetch: fetchAnilistAdventureAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "vote_count.desc", with_genres: "16,10759", "vote_count.gte": "30" }, order: 31 },
    { id: "mal.comedy", title: "Tears y risas", fetch: fetchAnilistComedyAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "popularity.desc", with_genres: "16,35" }, order: 32 },
    { id: "mal.drama", title: "Para llorar a mares", fetch: fetchAnilistDramaAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "vote_average.desc", with_genres: "16,18" }, order: 33 },
    { id: "mal.romance", title: "Amor en el aire", fetch: fetchAnilistRomanceAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "popularity.desc", with_genres: "16,10749" }, order: 34 },
    { id: "mal.fantasy", title: "Magia sin límites", fetch: fetchAnilistFantasyAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "vote_count.desc", with_genres: "16,10765" }, order: 35 },
    { id: "mal.scifi", title: "Locuras del futuro", fetch: fetchAnilistSciFiAnime, kind: "genre", tmdb: { ...animeBase, sort_by: "vote_average.desc", with_genres: "16,10765", "vote_count.gte": "20" }, order: 36 },
    { id: "mal.last_year_best", title: "Lo mejor de ayer", fetch: fetchAnilistLastYearBestAnime, kind: "other", tmdb: { ...animeBase, sort_by: "vote_average.desc", "vote_count.gte": "200", "air_date.gte": isoDate(-365), "air_date.lte": isoDate(0) }, order: 28 },
  ];

  const jikanEntries: AnimeEntry[] = [
    { id: "jikan.top_airing", title: "Las que están arrasando", fetch: fetchJikanTopAiring, kind: "current", order: 3, tmdb: { sort_by: "vote_count.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90), "vote_count.gte": "5" } },
    { id: "jikan.upcoming", title: "Lo que viene", fetch: fetchJikanUpcoming, kind: "current", order: 4, tmdb: { sort_by: "popularity.desc", "air_date.gte": isoDate(1), "air_date.lte": isoDate(180) } },
    { id: "jikan.top_movies", title: "Joyas cinematográficas", fetch: fetchJikanTopMovies, kind: "other", order: 8, tmdb: { sort_by: "popularity.desc", with_genres: "16,12" } },
    { id: "jikan.top_ova", title: "OVA legendarios", fetch: fetchJikanTopOva, kind: "other", order: 9, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "100" } },
    { id: "jikan.top_ona", title: "ONA imperdibles", fetch: fetchJikanTopOna, kind: "other", order: 10, tmdb: { sort_by: "vote_count.desc", "vote_count.gte": "50" } },
    { id: "jikan.top_specials", title: "Especiales que enamoran", fetch: fetchJikanTopSpecials, kind: "other", order: 11, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "10" } },
    { id: "jikan.recommendations", title: "La comunidad lo recomienda", fetch: fetchJikanRecommendations, kind: "other", order: 12, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" } },
    { id: "jikan.top_upcoming", title: "Próximos estrenos", fetch: fetchJikanTopUpcoming, kind: "other", order: 13, tmdb: { sort_by: "vote_average.desc", "air_date.gte": isoDate(1), "air_date.lte": isoDate(365) } },
    { id: "jikan.top_favorites", title: "Las más queridas del momento", fetch: fetchJikanTopFavorites, kind: "top", order: 7, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "150" } },
    { id: "jikan.most_popular", title: "Fenómenos populares", fetch: fetchJikanMostPopular, kind: "top", order: 14, tmdb: { sort_by: "vote_count.desc", "vote_count.gte": "100" } },
    { id: "jikan.action", title: "Adrenalina pura", fetch: fetchJikanAction, kind: "genre", order: 40, tmdb: { page: "2", sort_by: "popularity.desc", with_genres: "16,10759" } },
    { id: "jikan.adventure", title: "Aventuras épicas", fetch: fetchJikanAdventure, kind: "genre", order: 41, tmdb: { sort_by: "vote_average.desc", with_genres: "16,10759", "vote_count.gte": "50" } },
    { id: "jikan.romance", title: "Corazones rotos felices", fetch: fetchJikanRomance, kind: "genre", order: 42, tmdb: { page: "2", sort_by: "vote_average.desc", with_genres: "16,10749", "vote_count.gte": "20" } },
    { id: "jikan.comedy", title: "Carcajadas garantizadas", fetch: fetchJikanComedy, kind: "genre", order: 43, tmdb: { page: "2", sort_by: "vote_average.desc", with_genres: "16,35", "vote_count.gte": "20" } },
    { id: "jikan.fantasy", title: "Mundos mágicos", fetch: fetchJikanFantasy, kind: "genre", order: 44, tmdb: { sort_by: "vote_average.desc", with_genres: "16,10765", "vote_count.gte": "50" } },
    { id: "jikan.scifi", title: "Futuro y espacio", fetch: fetchJikanSciFi, kind: "genre", order: 45, tmdb: { page: "2", sort_by: "vote_average.desc", with_genres: "16,10765", "vote_count.gte": "30" } },
    { id: "jikan.slice_of_life", title: "Días tranquilos", fetch: fetchJikanSliceOfLife, kind: "genre", order: 46, tmdb: { page: "3", sort_by: "vote_average.desc", with_genres: "16", "vote_count.gte": "100" } },
    { id: "jikan.psychological", title: "Mente enigma", fetch: fetchJikanPsychological, kind: "genre", order: 47, tmdb: { page: "2", sort_by: "vote_average.desc", with_genres: "16,9648", "vote_count.gte": "50" } },
  ];

  // Fetch AniList entries in parallel, Jikan entries serially (rate-limit).
  const anilistRaw = await Promise.all(
    anilistEntries.map(async (entry): Promise<{ entry: AnimeEntry; items: MediaItem[] }> => {
      let items: MediaItem[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
        try { items = await entry.fetch(); } catch {}
        if (items.length) break;
      }
      if (!items.length && entry.tmdb) {
        try {
          const tmdbParams: Record<string, string> = { language: "es-ES", page: "1", ...animeBase };
          for (const [k, v] of Object.entries(entry.tmdb)) {
            if (v != null) tmdbParams[k] = String(v);
          }
          const results = await tmdbFetch<any>("/discover/tv", { params: tmdbParams });
          items = (Array.isArray(results?.results) ? results.results : [])
            .map((item: any) => normalizeTmdbCatalogItem(item, "anime", entry.title))
            .filter((item: MediaItem | null): item is MediaItem => item != null);
        } catch {}
      }
      const unique = items.filter((item, index, list) => list.findIndex(i => i.id === item.id) === index);
      return { entry, items: unique.slice(0, HOME_RAIL_ITEM_LIMIT) };
    }),
  );

  const sortedJikan = [...jikanEntries].sort((a, b) => a.order - b.order);
  const jikanRaw = await runJikanSerial(
    sortedJikan.map((entry) => ({
      fn: async (): Promise<{ entry: AnimeEntry; items: MediaItem[] }> => {
        let items: MediaItem[] = [];
        try { items = await entry.fetch(); } catch {}
        if (!items.length && entry.tmdb) {
          try {
            const tmdbParams: Record<string, string> = { language: "es-ES", page: "1", ...animeBase };
            for (const [k, v] of Object.entries(entry.tmdb)) {
              if (v != null) tmdbParams[k] = String(v);
            }
            const results = await tmdbFetch<any>("/discover/tv", { params: tmdbParams });
            items = (Array.isArray(results?.results) ? results.results : [])
              .map((item: any) => normalizeTmdbCatalogItem(item, "anime", entry.title))
              .filter((item: MediaItem | null): item is MediaItem => item != null);
          } catch {}
        }
        const unique = items.filter((item, index, list) => list.findIndex(i => i.id === item.id) === index);
        return { entry, items: unique.slice(0, HOME_RAIL_ITEM_LIMIT) };
      },
    })),
  );
  const jikanResults = await Promise.all(jikanRaw);

  const allResults = [...anilistRaw, ...jikanResults].sort((a, b) => a.entry.order - b.entry.order);

  // Central dedupe by mal_id; later rows lose items already seen.
  const seenMalIds = new Set<number>();
  const seenKeys = new Set<string>();
  const rows: CatalogRowData[] = [];
  for (const { entry, items } of allResults) {
    const deduped: MediaItem[] = [];
    for (const item of items) {
      const malId = (item as MediaItem & { _malId?: number })._malId;
      const itemKey = `${item.type}:${item.id}`;
      if (seenKeys.has(itemKey)) continue;
      if (malId && seenMalIds.has(malId)) continue;
      seenKeys.add(itemKey);
      if (malId) seenMalIds.add(malId);
      deduped.push(item);
    }
    if (!deduped.length) continue;
    rows.push({
      addonId: "aetherio-starter",
      addonName: "Aetherio",
      catalogId: entry.id,
      type: "anime",
      name: entry.title,
      subtitle: "Actualizado con TMDB",
      items: deduped,
    } satisfies CatalogRowData);
  }
  return rows;
}

function buildBothModeRows(baseRows: CatalogRowData[], animeRows: CatalogRowData[]): CatalogRowData[] {
  const seed = todayKey();
  const rng = (max: number, salt: string) => Math.abs(Number(hashValue(`${seed}|${salt}`))) % max;

  const airingAnime = animeRows.filter(r => r.catalogId === "mal.airing_anime" || r.catalogId === "jikan.top_airing" || r.catalogId === "jikan.upcoming");
  const topAnime = animeRows.filter(r => r.catalogId === "mal.top_anime" || r.catalogId === "mal.most_favorites_anime" || r.catalogId === "jikan.top_favorites" || r.catalogId === "jikan.most_popular");
  const otherAnime = animeRows.filter(r => !airingAnime.includes(r) && !topAnime.includes(r));

  const trendingBase = baseRows.filter(r => r.catalogId === "tmdb.trending_movie" || r.catalogId === "tmdb.trending_series");
  const topBase = baseRows.filter(r => r.catalogId === "tmdb.top_movie" || r.catalogId === "tmdb.top_series");
  const otherBase = baseRows.filter(r => !trendingBase.includes(r) && !topBase.includes(r));

  const selectedAnime: CatalogRowData[] = [];
  const selectedBase: CatalogRowData[] = [];

  if (airingAnime.length) selectedAnime.push(airingAnime[rng(airingAnime.length, "anime-airing")]);
  if (topAnime.length) selectedAnime.push(topAnime[rng(topAnime.length, "anime-top")]);

  if (trendingBase.length) selectedBase.push(trendingBase[rng(trendingBase.length, "base-trending")]);
  if (topBase.length) selectedBase.push(topBase[rng(topBase.length, "base-top")]);

  const fillAnimePool = [...otherAnime];
  while (selectedAnime.length < 10 && fillAnimePool.length) {
    const idx = rng(fillAnimePool.length, `anime-fill-${selectedAnime.length}`);
    selectedAnime.push(fillAnimePool[idx]);
    fillAnimePool.splice(idx, 1);
  }

  const fillBasePool = [...otherBase];
  while (selectedBase.length < 10 && fillBasePool.length) {
    const idx = rng(fillBasePool.length, `base-fill-${selectedBase.length}`);
    selectedBase.push(fillBasePool[idx]);
    fillBasePool.splice(idx, 1);
  }

  return buildInterleavedWithTopSlotRules(selectedAnime, selectedBase);
}

function buildInterleavedWithTopSlotRules(animeRows: CatalogRowData[], baseRows: CatalogRowData[]): CatalogRowData[] {
  const topAnimeIds = new Set(["mal.top_anime", "mal.most_favorites_anime", "jikan.top_favorites", "jikan.most_popular"]);
  const topBaseIds = new Set(["tmdb.top_movie", "tmdb.top_series"]);

  const result: CatalogRowData[] = [];
  let iA = 0;
  let iB = 0;
  let lastWasTop = false;

  function pickFrom(source: CatalogRowData[], idxRef: { i: number }): CatalogRowData | null {
    while (idxRef.i < source.length) {
      const row = source[idxRef.i];
      idxRef.i++;
      const isTop = (source === animeRows ? topAnimeIds : topBaseIds).has(row.catalogId);
      if (isTop && lastWasTop) continue;
      return row;
    }
    return null;
  }

  while (result.length < 20 && (iA < animeRows.length || iB < baseRows.length)) {
    const turn = result.length % 2 === 0 ? "anime" : "base";
    const idxRef = turn === "anime" ? { i: iA } : { i: iB };
    const source = turn === "anime" ? animeRows : baseRows;
    const row = pickFrom(source, idxRef);
    if (turn === "anime") iA = idxRef.i;
    else iB = idxRef.i;
    if (!row) {
      // Try the other side to fill the slot.
      const altIdxRef = turn === "anime" ? { i: iB } : { i: iA };
      const altSource = turn === "anime" ? baseRows : animeRows;
      const altRow = pickFrom(altSource, altIdxRef);
      if (turn === "anime") iB = altIdxRef.i;
      else iA = altIdxRef.i;
      if (!altRow) break;
      result.push(altRow);
      lastWasTop = (altSource === animeRows ? topAnimeIds : topBaseIds).has(altRow.catalogId);
      continue;
    }
    result.push(row);
    lastWasTop = (source === animeRows ? topAnimeIds : topBaseIds).has(row.catalogId);
  }
  return result.slice(0, 20);
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
    const [airingSeries, nowPlaying] = await Promise.all([
      tmdbFetch("/tv/on_the_air", { params: { language: "es-ES", page: "1" } }),
      tmdbFetch("/movie/now_playing", { params: { language: "es-ES", page: "1", region: "US" } }),
    ]);

    const rawHeroItems = [
      ...((nowPlaying as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => ({ item, type: "movie" as const, group: "En emisión - Películas" })),
      ...((airingSeries as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => ({ item, type: "series" as const, group: "En emisión - Series" })),
    ];

    const HERO_BATCH = 4;
    const heroItems: MediaItem[] = [];
    for (let i = 0; i < rawHeroItems.length; i += HERO_BATCH) {
      const batch = rawHeroItems.slice(i, i + HERO_BATCH);
      const results = await Promise.allSettled(
        batch.map(({ item, type, group }) => normalizeTmdbHeroItem(item, type, group))
      );
      for (const r of results) {
        if (r.status === "fulfilled") heroItems.push(r.value);
      }
    }

    const movieItems = heroItems.filter(item => item.heroGroup === "En emisión - Películas");
    const seriesItems = heroItems.filter(item => item.heroGroup === "En emisión - Series");

    return enrichHeroRatings(interleaveGroups([movieItems, seriesItems]));
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
    background: upgradeTmdbImage(item.background, "w1280"),
  }));
}

export function prefetchHomeData(queryClient: QueryClient, addons: InstalledAddon[], contentOrientation: ContentOrientation = "both") {
  const rowsSignature = enabledAddonSignature(addons, contentOrientation);
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
    queryFn: () => fetchHomeRows(addons, contentOrientation),
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

export function useHomeCatalogs(addons: InstalledAddon[], contentOrientation: ContentOrientation = "both") {
  const queryClient = useQueryClient();
  const [tmdbReady, setTmdbReady] = useState(() => Boolean(getTmdbApiKey()));

  useEffect(() => {
    if (!tmdbReady) {
      let cancelled = false;
      getTmdbApiKeyAsync().then(() => { if (!cancelled) setTmdbReady(true); });
      return () => { cancelled = true; };
    }
  }, [tmdbReady]);

  const rowsSignature = enabledAddonSignature(addons, contentOrientation);
  const currentHeroSignature = heroSignature();
  const prevSignatureRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const prev = prevSignatureRef.current;
    if (prev !== undefined && prev !== rowsSignature) {
      queryClient.removeQueries({ queryKey: ["home"] });
      useCacheStore.getState().clearHome();
    }
    prevSignatureRef.current = rowsSignature;
  }, [queryClient, rowsSignature]);

  const initialRows = cachedRows(rowsSignature);
  const initialHero = cachedHero(currentHeroSignature);

  const rowsQuery = useQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    queryFn: () => fetchHomeRows(addons, contentOrientation),
    enabled: tmdbReady,
    initialData: initialRows,
    initialDataUpdatedAt: initialRows ? useCacheStore.getState().home?.rowsUpdatedAt : undefined,
    staleTime: HOME_ROWS_STALE_TIME,
    gcTime: HOME_GC_TIME,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const heroQuery = useQuery({
    queryKey: homeCatalogKeys.hero(currentHeroSignature),
    queryFn: fetchHomeHero,
    enabled: tmdbReady,
    initialData: initialHero,
    initialDataUpdatedAt: initialHero ? useCacheStore.getState().home?.heroUpdatedAt : undefined,
    staleTime: HOME_HERO_STALE_TIME,
    gcTime: HOME_GC_TIME,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
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
    if (tmdbReady) {
      prefetchHomeData(queryClient, addons, contentOrientation);
    }
  }, [addons, queryClient, contentOrientation, tmdbReady]);

  const rows = rowsQuery.data ?? [];
  const heroItems = useMemo(() => mergeHeroItems(heroQuery.data ?? [], rows), [heroQuery.data, rows]);
  const usingStarterRows = rows.length > 0 && rows.every(row => row.addonId === "aetherio-starter");

  useEffect(() => {
    if (!usingStarterRows) {
      preloadHomeImages(rows, heroItems);
      return;
    }
    if (heroQuery.isLoading && !heroQuery.data) return;

    void preloadStarterHomeImages(rows, heroItems);
  }, [heroItems, heroQuery.data, heroQuery.isLoading, rows, usingStarterRows]);

  useEffect(() => {
    for (const item of heroItems) {
      setTimeout(() => void fetchYouTubeClip(item), 0);
    }
  }, [heroItems]);

  return {
    rows,
    heroItems,
    loading: (rowsQuery.isLoading && !rowsQuery.data)
      || (usingStarterRows && heroQuery.isLoading && !heroQuery.data),
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
    image.onerror = () => done();
    image.src = url;
    if (image.complete && image.naturalWidth > 0) done();
  });
}
