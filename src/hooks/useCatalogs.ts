import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTmdbApiKey, getTmdbApiKeyAsync, tmdbFetch } from "../config/apiKeys.ts";
import { getMdbListSettings } from "../config/mdblist.ts";
import {
  fetchAnilistTopAnime,
  fetchAnilistAiringAnime,
  resolveAnilistToTmdb,
} from "../services/anilist.ts";
import {
  fetchJikanTopAiring,
  fetchJikanUpcoming,
  fetchJikanTopFavorites,
  fetchJikanMostPopular,
  fetchJikanRecommendations,
  resolveMalToTmdb,
  runJikanSerial,
} from "../services/jikan.ts";
import { fetchMdbListRatingsForMedia } from "../services/MDBListService.ts";
import { fetchYouTubeClip } from "../services/youtubeClips.ts";
import type { InstalledAddon } from "../store/addonStore.ts";
import { HOME_CACHE_MAX_AGE, isFreshHomeCache, useCacheStore } from "../store/cacheStore.ts";
import type { CatalogRowData, MediaItem } from "../types/ui.ts";
import { matchesContentOrientation, type ContentOrientation } from "../config/homePreferences.ts";
import { sanitizeLogoUrl } from "../utils/artwork.ts";
import { resolveDetailBackground } from "../utils/mediaMetadata.ts";
import { readHomeCardArtwork } from "../utils/homeCardArtwork.ts";
import { pickPreferredTmdbBackdrop, tmdbImage as tmdbImageUrl } from "../utils/tmdbArtwork.ts";

const HERO_GROUP_FETCH_LIMIT = 7;
const HERO_TOTAL_LIMIT = 15;
const HOME_ROWS_STALE_TIME = HOME_CACHE_MAX_AGE;
const HOME_HERO_STALE_TIME = HOME_CACHE_MAX_AGE;
const HOME_GC_TIME = 1000 * 60 * 60 * 24;
const HOME_ROWS_DATA_VERSION = "native-home-rails-v22";
const HOME_BACKGROUND_IMAGE_SIZE = "w1280" as const;
const HOME_HERO_IMAGE_VERSION = "hero-metadata-api-original-v4";
const HOME_EXTRA_VARIANTS_PER_CATALOG = 4;
const HOME_RAIL_ITEM_LIMIT = 20;
const CINEMETA_HOST = "v3-cinemeta.strem.io";
const CINEMETA_RESOLVE_CONCURRENCY = 8;

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

function upgradeTmdbImage(url: string | undefined, size: "original" | "w1280" | "w780" | "w500" | "w342" = "w500") {
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
    poster: upgradeTmdbImage(readHomeCardArtwork("poster", item.type, item.id, item.poster), "original"),
    background: upgradeTmdbImage(readHomeCardArtwork("background", item.type, item.id, detailBackground), HOME_BACKGROUND_IMAGE_SIZE),
    logo: sanitizeLogoUrl(upgradeTmdbImage(item.logo, "original")),
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

function isCinemetaAddon(addon: InstalledAddon) {
  return addon.id === "com.linvo.cinemeta" || addon.url.toLowerCase().includes(CINEMETA_HOST);
}

function homeCatalogTitle(addon: InstalledAddon, catalog: any, requestTitle: string) {
  // Cinemeta calls this catalog "Featured"; in Aetherio it is the Tendencias rail.
  if (isCinemetaAddon(addon) && String(catalog?.id ?? "") === "imdbRating") return "Tendencias";
  return requestTitle;
}

function createPromiseLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const drain = () => {
    while (active < limit && queue.length) {
      queue.shift()?.();
    }
  };

  return function limitTask<T>(task: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active += 1;
        void task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            drain();
          });
      };
      queue.push(run);
      drain();
    });
  };
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

function normalizeCinemetaType(type: string) {
  return type.toLowerCase() === "movie" ? "movie" : "series";
}

function resolveCinemetaItem(
  raw: any,
  fallbackType: string,
  cache: Map<string, Promise<MediaItem | null>>,
  limitTask: <T>(task: () => Promise<T>) => Promise<T>,
) {
  const imdbId = String(raw?.id ?? "").trim();
  if (!/^tt\d+$/i.test(imdbId)) return Promise.resolve(null);

  const key = `${normalizeCinemetaType(fallbackType)}:${imdbId.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = limitTask(async () => {
    const type = normalizeCinemetaType(fallbackType);
    const data = await tmdbFetch<any>(`/find/${encodeURIComponent(imdbId)}`, {
      params: { external_source: "imdb_id", language: "es-ES" },
    });
    const candidates = type === "movie" ? data?.movie_results : data?.tv_results;
    const match = Array.isArray(candidates) ? candidates[0] : null;
    if (!match) return null;

    const item = normalizeTmdbCatalogItem(match, type, "");
    if (!item) return null;
    return item;
  }).catch(() => null);

  cache.set(key, pending);
  return pending;
}

async function normalizeCinemetaItems(
  rawItems: any[],
  fallbackType: string,
  cache: Map<string, Promise<MediaItem | null>>,
  limitTask: <T>(task: () => Promise<T>) => Promise<T>,
) {
  const resolved = await Promise.all(
    rawItems.map(item => resolveCinemetaItem(item, fallbackType, cache, limitTask)),
  );
  return resolved.filter((item): item is MediaItem => item !== null);
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
      logo: tmdbImageUrl(logo?.file_path, "original"),
      background: upgradeTmdbImage(
        pickPreferredTmdbBackdrop(images?.backdrops, fallbackBackdropPath),
        HOME_BACKGROUND_IMAGE_SIZE,
      ),
      description: hasDescription ? data.overview : undefined,
    };
  } catch {
    return {};
  }
}

async function enrichAllItemsWithLogos(items: MediaItem[]): Promise<MediaItem[]> {
  const CONCURRENCY = 4;
  const capped = items;
  const results: MediaItem[] = new Array(capped.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < capped.length) {
      const i = nextIndex++;
      const item = capped[i];
      const tmdbId = Number(item.id.replace("tmdb:", ""));
      if (!Number.isFinite(tmdbId)) {
        results[i] = item;
        continue;
      }
      const hasTmdbLogo = Boolean(item.logo && /https:\/\/image\.tmdb\.org\/t\/p\//i.test(item.logo));
      if (hasTmdbLogo && item.description) {
        results[i] = item;
        continue;
      }
      const tmdbType = item.type === "movie" ? "movie" : "tv";
      try {
        let artwork = await tmdbArtwork(tmdbType, tmdbId, item.background);
        if (!artwork.description && tmdbType === "tv") {
          const movieArtwork = await tmdbArtwork("movie", tmdbId, item.background);
          artwork = {
            logo: artwork.logo ?? movieArtwork.logo,
            background: artwork.background ?? movieArtwork.background,
            description: artwork.description ?? movieArtwork.description,
          };
        }
        results[i] = {
          ...item,
          logo: artwork.logo,
          background: artwork.background ?? item.background,
          description: artwork.description ?? item.description,
        };
      } catch {
        results[i] = item;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, capped.length) }, worker));
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
      background = upgradeTmdbImage(
        pickPreferredTmdbBackdrop(images.backdrops, item.backdrop_path),
        HOME_BACKGROUND_IMAGE_SIZE,
      );
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
    background: upgradeTmdbImage(
      background ?? tmdbImageUrl(item.backdrop_path, "original"),
      HOME_BACKGROUND_IMAGE_SIZE,
    ),
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

function mergeHeroItems(
  tmdbItems: MediaItem[] = [],
  rows: CatalogRowData[] = [],
  contentOrientation: ContentOrientation = "both",
) {
  const candidates: MediaItem[] = [];
  const seen = new Set<string>();

  const add = (item: MediaItem, group?: string) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return;
    const background = upgradeTmdbImage(
      resolveDetailBackground(item.type, item.id, item.background),
      HOME_BACKGROUND_IMAGE_SIZE,
    );
    if (!background || isAetherioDefaultArtwork(background)) return;
    seen.add(key);
    candidates.push({
      ...item,
      background,
      logo: sanitizeLogoUrl(item.logo),
      heroGroup: item.heroGroup ?? group,
    });
  };

  const sourceRows = rows.slice(0, 6);
  for (const row of sourceRows) {
    for (const item of row.items.slice(0, 8)) {
      add(item, row.name);
    }
  }

  for (const item of tmdbItems) {
    add(item, item.heroGroup);
  }

  const sorted = candidates.sort((a, b) => heroRandomValue(a) - heroRandomValue(b));
  if (contentOrientation === "both") {
    return [
      ...sorted.filter(item => item.type.toLowerCase() !== "anime").slice(0, 5),
      ...sorted.filter(item => item.type.toLowerCase() === "anime").slice(0, 5),
    ];
  }

  const animeOnly = contentOrientation === "anime";
  return sorted
    .filter(item => (item.type.toLowerCase() === "anime") === animeOnly)
    .slice(0, HERO_TOTAL_LIMIT);
}

function heroRandomValue(item: MediaItem) {
  return Number(hashValue(`${todayKey()}|${item.type}|${item.id}|${item.heroGroup ?? ""}`));
}

export async function fetchHomeRows(addons: InstalledAddon[], contentOrientation: ContentOrientation = "both") {
  const enabledAddons = addons.filter(addon => addon.enabled);
  const cinemetaResolutionCache = new Map<string, Promise<MediaItem | null>>();
  const limitCinemetaResolution = createPromiseLimiter(CINEMETA_RESOLVE_CONCURRENCY);
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
        const normalizedItems = isCinemetaAddon(addon)
          ? await normalizeCinemetaItems(data.metas ?? [], request.catalog.type, cinemetaResolutionCache, limitCinemetaResolution)
          : (data.metas ?? []).map((item: any) => normalizeCatalogItem(item, request.catalog.type));
        const items = normalizedItems
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
          name: homeRailTitle(homeCatalogTitle(addon, request.catalog, request.title), request.catalog.type),
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
  const orientedAddonRows = addonRows.filter(row => matchesContentOrientation(row.type, contentOrientation));
  const baseRows = orientedAddonRows.length || contentOrientation === "anime"
    ? orientedAddonRows
    : await fetchTmdbStarterRows();

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

  if (contentOrientation === "movies-series") {
    const allEnriched = await enrichAllItemsWithLogos(baseRows.flatMap(row => row.items));
    let offset = 0;
    return baseRows.map(row => {
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

  const combined = validAnimeRows.length ? [...validAnimeRows, ...baseRows] : baseRows;

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
      .filter((item: any) => {
        const lang = String(item?.original_language ?? "").toLowerCase();
        return !lang.startsWith("zh");
      })
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
    { id: "mal.airing_anime", title: "En emisión", fetch: fetchAnilistAiringAnime, kind: "current", tmdb: { sort_by: "popularity.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90) }, order: 1 },
    { id: "mal.top_anime", title: "Los reyes del anime", fetch: fetchAnilistTopAnime, kind: "top", tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" }, order: 5 },
  ];

  const jikanEntries: AnimeEntry[] = [
    { id: "jikan.recommendations", title: "La comunidad lo recomienda", fetch: fetchJikanRecommendations, kind: "other", order: 2, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" } },
    { id: "jikan.top_favorites", title: "Las más queridas del momento", fetch: fetchJikanTopFavorites, kind: "top", order: 3, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "150" } },
    { id: "jikan.upcoming", title: "Lo que viene", fetch: fetchJikanUpcoming, kind: "current", order: 4, tmdb: { sort_by: "popularity.desc", "air_date.gte": isoDate(1), "air_date.lte": isoDate(180) } },
    { id: "jikan.top_airing", title: "Las que están arrasando", fetch: fetchJikanTopAiring, kind: "current", order: 6, tmdb: { sort_by: "vote_count.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90), "vote_count.gte": "5" } },
    { id: "jikan.most_popular", title: "Fenómenos populares", fetch: fetchJikanMostPopular, kind: "other", order: 7, tmdb: { sort_by: "vote_count.desc", "vote_count.gte": "100" } },
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
      order: entry.order,
    } satisfies CatalogRowData);
  }
  return rows;
}

function buildBothModeRows(baseRows: CatalogRowData[], animeRows: CatalogRowData[]): CatalogRowData[] {
  return [...baseRows, ...animeRows];
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
    const [airingAnime, topAnime] = await Promise.all([
      tmdbFetch("/discover/tv", {
        params: {
          language: "es-ES",
          page: "1",
          with_genres: "16",
          with_original_language: "ja",
          sort_by: "popularity.desc",
          "air_date.gte": isoDate(-90),
          "air_date.lte": isoDate(90),
        },
      }),
      tmdbFetch("/discover/tv", {
        params: {
          language: "es-ES",
          page: "1",
          with_genres: "16",
          with_original_language: "ja",
          sort_by: "vote_average.desc",
          "vote_count.gte": "200",
        },
      }),
    ]);

    const rawHeroItems = [
      ...((airingAnime as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => ({ item, type: "anime" as const, group: "En emisión" })),
      ...((topAnime as any)?.results ?? []).slice(0, HERO_GROUP_FETCH_LIMIT).map((item: any) => ({ item, type: "anime" as const, group: "Los reyes del anime" })),
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

    const airingItems = heroItems.filter(item => item.heroGroup === "En emisión");
    const topItems = heroItems.filter(item => item.heroGroup === "Los reyes del anime");

    return enrichHeroRatings(interleaveGroups([airingItems, topItems]));
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
    background: upgradeTmdbImage(item.background, HOME_BACKGROUND_IMAGE_SIZE),
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

  const rowsPromise = queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    queryFn: () => fetchHomeRows(addons, contentOrientation),
    staleTime: HOME_ROWS_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
  const heroPromise = queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.hero(currentHeroSignature),
    queryFn: fetchHomeHero,
    staleTime: HOME_HERO_STALE_TIME,
    gcTime: HOME_GC_TIME,
  });
  return Promise.allSettled([rowsPromise, heroPromise]);
}

export async function warmHomeStartup(
  queryClient: QueryClient,
  addons: InstalledAddon[],
  contentOrientation: ContentOrientation = "both",
  onImages?: () => void,
) {
  await prefetchHomeData(queryClient, addons, contentOrientation);

  const rowsSignature = enabledAddonSignature(addons, contentOrientation);
  const rows = queryClient.getQueryData<CatalogRowData[]>(homeCatalogKeys.rows(rowsSignature)) ?? [];
  const heroSource = queryClient.getQueryData<MediaItem[]>(homeCatalogKeys.hero(heroSignature())) ?? [];
  const heroItems = mergeHeroItems(heroSource, rows, contentOrientation);

  onImages?.();
  const urls = new Set<string>();
  for (const item of heroItems) {
    if (item.background) urls.add(item.background);
    if (item.logo) urls.add(item.logo);
    if (item.poster) urls.add(item.poster);
  }
  for (const row of rows) {
    for (const item of row.items) {
      if (item.poster) urls.add(item.poster);
      if (item.background) urls.add(item.background);
      if (item.logo) urls.add(item.logo);
    }
  }

  await Promise.allSettled(Array.from(urls).map(preloadStartupImage));
  preloadHomeImages(rows, heroItems);
}

function preloadStartupImage(url: string) {
  return new Promise<void>(resolve => {
    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, 8_000);
    image.onload = () => {
      if (typeof image.decode !== "function") {
        finish();
        return;
      }
      void image.decode().catch(() => undefined).finally(finish);
    };
    image.onerror = finish;
    image.decoding = "async";
    image.src = url;
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
    refetchOnMount: false,
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
    refetchOnMount: false,
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
  const heroItems = useMemo(
    () => mergeHeroItems(heroQuery.data ?? [], rows, contentOrientation),
    [contentOrientation, heroQuery.data, rows],
  );
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
    for (const item of heroItems.slice(0, 3)) {
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
