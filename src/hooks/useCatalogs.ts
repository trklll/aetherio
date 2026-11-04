import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTmdbApiKey, tmdbFetch } from "../config/apiKeys.ts";
import {
  applySpatialPosterToUrl,
  extractTmdbId,
  getSpatialPosterSettings,
  isSpatialPostersConfigured,
  spatialPosterSignature,
  SPATIAL_POSTER_CHANGED_EVENT,
  TOP_SPATIAL_POSTER_OVERRIDES,
  type SpatialPosterOverrides,
  type SpatialPosterSettings,
} from "../config/spatialPosters.ts";
import { probeSpatialInstance, resetSpatialAvailability } from "../services/spatialInstance.ts";
import { resolvePosterEndpoint } from "../services/posterServer.ts";
import { clearSpatialRankCache, fetchSpatialRankMap, spatialRankOf } from "../services/spatialRank.ts";
import { preloadArtworkImage, preloadPosterArtwork, isPosterArtworkFailed } from "../services/posterArtworkCache.ts";
import { POSTER_PROBE_MAX_CONCURRENT, forgetPosterFailure } from "../services/posterProbe.ts";
import { tmdbGenreName } from "../services/tmdbGenres.ts";
import { isTopFormatRow } from "../utils/topRows.ts";
import { getMdbListSettings } from "../config/mdblist.ts";
import {
  fetchAnilistDiscover,
  fetchAnilistTopAnime,
  fetchAnilistAiringAnime,
  probeAnilist,
  resolveAnilistToTmdb,
} from "../services/anilist.ts";
import {
  fetchJikanBestOf2000s,
  fetchJikanBestOfNineties,
  fetchJikanBestOf2010s,
  fetchJikanTopMovies,
  fetchJikanUpcoming,
  fetchJikanTopFavorites,
  fetchJikanMostPopular,
  fetchJikanRecommendations,
  probeJikan,
  resolveMalToTmdb,
  runJikanSerial,
} from "../services/jikan.ts";
import { fetchMdbListRatingsForMedia } from "../services/MDBListService.ts";
import type { InstalledAddon } from "../store/addonStore.ts";
import { HOME_CACHE_MAX_AGE, useCacheStore } from "../store/cacheStore.ts";
import { isReusableHomeCache, normalizeDailyHeroSignature, normalizeDailyRowsSignature } from "./homeCachePolicy.ts";
import { homeImagePreloadConcurrency } from "../utils/hardware.ts";
import type { CatalogRowData, MediaItem } from "../types/ui.ts";
import { DEFAULT_HOME_PREFERENCES, matchesContentOrientation, type BothContentPreference, type ContentOrientation } from "../config/homePreferences.ts";
import { sanitizeLogoUrl } from "../utils/artwork.ts";
import { dedupeAnimeHomeRows } from "../utils/animeRows.ts";
import { readHiddenMediaKeys, refreshWatchedSeriesCache } from "../services/watchedVisibility.ts";
import { resolveDetailBackground } from "../utils/mediaMetadata.ts";
import { readHomeCardArtwork } from "../utils/homeCardArtwork.ts";
import { getContinueWatchingRows } from "../utils/continueWatching.ts";
import { pickPreferredTmdbBackdrop, tmdbImage as tmdbImageUrl } from "../utils/tmdbArtwork.ts";
import { fetchTmdbArtwork } from "../services/tmdbArtworkService.ts";
import { fetchMovieSeriesDecadeRows } from "../services/movieSeriesDecades.ts";
import { fetchMovieSeriesHomeRows, orderMovieSeriesHomeRows } from "../services/movieSeriesHomeRows.ts";
import { isYearBasedMovieSeriesHomeRow } from "../utils/homeCatalogFilters.ts";

const HERO_GROUP_FETCH_LIMIT = 7;
const HERO_TOTAL_LIMIT = 15;
const HOME_ROWS_STALE_TIME = HOME_CACHE_MAX_AGE;
const HOME_HERO_STALE_TIME = HOME_CACHE_MAX_AGE;
const HOME_GC_TIME = 1000 * 60 * 60 * 24;
const HOME_ROWS_DATA_VERSION = "native-home-rails-v35-decade-and-genre-rows-no-yearly-new";
const HOME_BACKGROUND_IMAGE_SIZE = "w1280" as const;
const HOME_HERO_IMAGE_VERSION = "hero-metadata-api-original-v5";
const HOME_EXTRA_VARIANTS_PER_CATALOG = 4;
const HOME_RAIL_ITEM_LIMIT = 20;
const HOME_CATALOG_REQUEST_TIMEOUT_MS = 15_000;
const CINEMETA_HOST = "v3-cinemeta.strem.io";
const CINEMETA_RESOLVE_CONCURRENCY = 8;

// Rails cuyo orden sigue el ranking Top 20 de JustWatch de SpatialPosters
// (coincide con los badges #N renderizados en los pósters). El resto de rails
// conserva su orden propio.
const RANK_SORTED_RAIL_IDS = new Set([
  "tmdb.top_movie",
  "tmdb.top_series",
  "tmdb.trending_movie",
  "tmdb.trending_series",
]);

// Tiempo máximo que el ranking puede retrasar una fila (el resto sigue en background).
const RANK_BUDGET_MS = 5000;

/**
 * Ordena por ranking ascendente e intercala los no rankeados ("Recién
 * Añadida" y resto) repartidos de forma uniforme entre los rankeados.
 */
function sortByRankWithInterleave(
  items: MediaItem[],
  ranks: Array<number | null>,
): MediaItem[] {
  const ranked: Array<{ item: MediaItem; rank: number }> = [];
  const unranked: MediaItem[] = [];
  items.forEach((item, index) => {
    const rank = ranks[index];
    if (rank == null) unranked.push(item);
    else ranked.push({ item, rank });
  });
  ranked.sort((a, b) => a.rank - b.rank);
  if (!ranked.length || !unranked.length) {
    return [...ranked.map(entry => entry.item), ...unranked];
  }
  const merged: MediaItem[] = [];
  const totalUnranked = unranked.length;
  let pending = 0;
  for (const entry of ranked) {
    merged.push(entry.item);
    pending += totalUnranked / ranked.length;
    while (pending >= 1 && unranked.length) {
      merged.push(unranked.shift()!);
      pending -= 1;
    }
  }
  merged.push(...unranked);
  return merged;
}

async function sortRailBySpatialRank(items: MediaItem[], type: string): Promise<MediaItem[]> {
  if (items.length < 2) return items;
  const kind = type.toLowerCase() === "movie" ? "movie" : "series";
  // Presupuesto acotado: el ranking nunca debe retrasar el pintado de la fila.
  // Lo que no se resuelva a tiempo queda como no-rankeado (intercalado).
  const rankMap = await withTimeout(
    fetchSpatialRankMap(kind as "movie" | "series").catch(() => null),
    RANK_BUDGET_MS,
  ).catch(() => null);
  if (!rankMap || !rankMap.size) return items;
  const ranks = items.map(item => spatialRankOf(extractTmdbId(item.id), rankMap));
  if (ranks.every(rank => rank == null)) return items;
  return sortByRankWithInterleave(items, ranks);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("budget")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

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
  const customPoster = readHomeCardArtwork("poster", item.type, item.id, undefined);
  const basePoster = customPoster ?? item.poster;
  // w500 (no original): las cards muestran ~197px y el fallback debe pintar
  // rápido incluso en redes lentas; los originales de varios MB retrasaban
  // la primera pintura y alargaban los huecos negros.
  const upgraded = upgradeTmdbImage(basePoster, "w500");
  // El override manual del usuario siempre gana: no aplicar SpatialPosters encima.
  const hasCustom = Boolean(customPoster && customPoster !== item.poster);
  const spatial = hasCustom
    ? upgraded
    : applySpatialPosterToUrl(upgraded, extractTmdbId(item.id), item.type);
  return {
    ...item,
    poster: spatial ?? upgraded,
    // Si SpatialPosters falla (offline, 404, rate-limit), el <img> vuelve al original.
    originalPoster: spatial && spatial !== upgraded ? upgraded : item.originalPoster,
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
  // Fecha LOCAL, no UTC: con `toISOString()` el ranking "Hoy" y su firma rotaban
  // varias horas antes de medianoche en husos al oeste de UTC.
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function hashValue(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

export function enabledAddonSignature(
  addons: InstalledAddon[],
  contentOrientation: ContentOrientation = "both",
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
) {
  const catalogAddons = addons.filter(addon => (
    addon.enabled && Array.isArray(addon.manifest?.catalogs) && addon.manifest.catalogs.length > 0
  ));
  const orientationTag = `|orient:${contentOrientation}:${bothPreference}`;
  const posterTag = `|sp:${spatialPosterSignature()}`;
  // El ranking "Hoy" y sus badges cambian a diario: la firma incluye el día
  // para que el orden se regenere cada día en el primer arranque.
  const dayTag = `|d:${todayKey()}`;
  if (!catalogAddons.length) {
    return `${HOME_ROWS_DATA_VERSION}|aetherio-starter|${todayKey()}|${getTmdbApiKey() ? "tmdb" : "no-tmdb"}${orientationTag}${posterTag}`;
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
    .join("||")}${orientationTag}${posterTag}${dayTag}`;
}

function homeRailTitle(title: string | undefined, type: string, includeType = true) {
  const catalogTitle = ((title ?? "").trim() || "Catalogo").replace(/\s*-\s*(?:Pel[ií]culas|Series|Anime)$/i, "").trim() || "Catalogo";
  const normalizedType = type.toLowerCase();
  const typeLabel = (() => {
    switch (normalizedType) {
      case "movie":
        return "Películas";
      case "series":
      case "tv":
        return "Series";
      case "anime":
        return "Anime";
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  })();
  const lower = catalogTitle.toLowerCase();
  const isMediaTop = normalizedType === "movie" || normalizedType === "series" || normalizedType === "tv";
  if (isMediaTop && (lower === "tendencias" || lower === "trending" || lower === "en tendencia" || lower.startsWith("top ") || /^(?:Pel[ií]culas|Series) en tendencia$/i.test(catalogTitle))) {
    return `Top ${typeLabel}`;
  }
  const naturalTypeTitle = /^(?:Pel[ií]culas nuevas|Series nuevas|Anime nuevo) de \d{4}$/i.test(catalogTitle)
    || /^(?:Pel[ií]culas|Series) popular(?:es)?$/i.test(catalogTitle)
    || /^Anime (?:en tendencia|en emisión|recomendado por la comunidad|más queridas del momento|que viene|popular)$/i.test(catalogTitle);
  if (naturalTypeTitle) return catalogTitle;

  const pluralSuffix = typeLabel === "Películas" || typeLabel === "Series" ? "es" : "";
  if (lower === "popular") return `${typeLabel} popular${pluralSuffix}`;
  if (/^(Netflix|Disney\+|HBO Max|Prime Video|Apple TV\+)$/i.test(catalogTitle)) return `${catalogTitle}: ${typeLabel}`;

  const newYear = catalogTitle.match(/^New\s*-\s*(\d{4})$/i);
  if (newYear) {
    const year = newYear[1];
    if (normalizedType === "movie") return `Películas nuevas de ${year}`;
    if (normalizedType === "series" || normalizedType === "tv") return `Series nuevas de ${year}`;
    if (normalizedType === "anime") return `Anime nuevo de ${year}`;
  }
  if (!includeType) {
    if (lower === "en emisión") return "Anime en emisión";
    if (lower === "la comunidad lo recomienda") return "Anime recomendado por la comunidad";
    if (lower === "las más queridas del momento" || lower === "anime más queridas del momento" || lower === "los animes más queridos del momento") return "Los animes más queridos del momento";
    if (lower === "lo que viene" || lower === "anime que viene" || lower === "próximos animes a estrenar") return "Próximos animes a estrenar";
    if (lower === "las que están arrasando") return "Anime en tendencia";
    if (lower === "fenómenos populares") return "Anime popular";
    return catalogTitle;
  }
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
  const artwork = await fetchTmdbArtwork(type, id, fallbackBackdropPath);
  if (!artwork) return {};
  return {
    logo: artwork.logo,
    background: upgradeTmdbImage(artwork.backdrop, HOME_BACKGROUND_IMAGE_SIZE),
    description: artwork.description?.trim() ? artwork.description : undefined,
  };
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
        const artwork = await tmdbArtwork(tmdbType, tmdbId, item.background);
        // El sondeo del namespace contrario solo tiene sentido cuando el id
        // puede estar catalogado como pelicula. Para una entrada de anime ya
        // esta confirmado que es serie, y preguntarlo costaba una peticion por
        // titulo en cada arranque en frio: eso era lo que reventaba el limite
        // del proxy con las filas de anime.
        if (!artwork.description && tmdbType === "tv") {
          const entry = await fetchTmdbArtwork("tv", tmdbId);
          if (entry && !entry.isAnimation) {
            const movieArtwork = await tmdbArtwork("movie", tmdbId, item.background);
            artwork.description ??= movieArtwork.description;
            artwork.logo ??= movieArtwork.logo;
            artwork.background ??= movieArtwork.background;
          }
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
  // `images` viaja en el mismo append_to_response que el dato especifico del
  // tipo: el hero necesita los dos, y pedirlos por separado duplicaba trafico.
  const detail = await tmdbFetch<any>(`/${tmdbType}/${item.id}`, {
    params: {
      language: "es-ES",
      append_to_response: `${type === "movie" ? "release_dates" : "content_ratings"},images`,
      include_image_language: "es,en,null",
    },
  });

  let logo: string | undefined;
  let background: string | undefined;
  let runtime: string | undefined;
  let genres: string[] | undefined;
  let genreIds: number[] | undefined;
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
      genreIds = genreList.map((g: any) => Number(g.id)).filter(Number.isFinite);
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
    searchAliases: [
      item.title,
      item.name,
      item.original_title,
      item.original_name,
      detail?.title,
      detail?.name,
      detail?.original_title,
      detail?.original_name,
    ].filter((value, index, values): value is string => typeof value === "string" && value.trim().length > 0 && values.indexOf(value) === index),
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
    genreIds,
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
    genreIds: Array.isArray(item.genre_ids) ? item.genre_ids.map(Number).filter(Number.isFinite) : undefined,
    genres: Array.isArray(item.genre_ids)
      ? item.genre_ids.map((genreId: number) => tmdbGenreName(type, Number(genreId))).filter((genre: string | undefined): genre is string => Boolean(genre))
      : undefined,
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
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
) {
  const candidates: MediaItem[] = [];
  const seen = new Set<string>();
  // Lo visto no protagoniza el héroe tampoco.
  const hidden = readHiddenMediaKeys();

  const add = (item: MediaItem, group?: string) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return;
    if (hidden.has(key)) return;
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
    const anime = sorted.filter(item => item.type.toLowerCase() === "anime").slice(0, 5);
    const base = sorted.filter(item => item.type.toLowerCase() !== "anime").slice(0, 5);
    return bothPreference === "anime" ? [...anime, ...base] : [...base, ...anime];
  }

  const animeOnly = contentOrientation === "anime";
  return sorted
    .filter(item => (item.type.toLowerCase() === "anime") === animeOnly)
    .slice(0, HERO_TOTAL_LIMIT);
}

function heroRandomValue(item: MediaItem) {
  return Number(hashValue(`${todayKey()}|${item.type}|${item.id}|${item.heroGroup ?? ""}`));
}

export async function fetchHomeRows(
  addons: InstalledAddon[],
  contentOrientation: ContentOrientation = "both",
  onPhase?: (rows: CatalogRowData[]) => void,
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
) {
  const enabledAddons = addons.filter(addon => addon.enabled);
  const cinemetaResolutionCache = new Map<string, Promise<MediaItem | null>>();
  const limitCinemetaResolution = createPromiseLimiter(CINEMETA_RESOLVE_CONCURRENCY);
  const rowTasks = enabledAddons.flatMap(addon =>
    (addon.manifest?.catalogs ?? [])
      .filter((cat: any) => cat?.type && cat?.id)
      .flatMap((cat: any) => homeRequests(cat)
        .filter(request => !isYearBasedMovieSeriesHomeRow(request.title, request.catalog.type))
        .map(async (request): Promise<CatalogRowData | null> => {
      try {
        const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
        const data = await fetchJsonWithTimeout(
          catalogEndpoint(base, request.catalog.type, request.catalog.id, request.extraParams),
          HOME_CATALOG_REQUEST_TIMEOUT_MS,
        );
        if (!data) return null;
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
          name: homeRailTitle(
            homeCatalogTitle(addon, request.catalog, request.title),
            request.catalog.type,
            addon.id !== "aetherio-starter" && addon.id !== "tmdb",
          ),
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
  const movieSeriesHomeRowsPromise = contentOrientation === "anime"
    ? Promise.resolve([] as CatalogRowData[])
    : fetchMovieSeriesHomeRows();
  const movieSeriesDecadeRowsPromise = contentOrientation === "anime"
    ? Promise.resolve([] as CatalogRowData[])
    : fetchMovieSeriesDecadeRows();
  const initialBaseRows = orientedAddonRows.length || contentOrientation === "anime"
    ? orientedAddonRows
    : await fetchTmdbStarterRows();
  if (contentOrientation === "both" && initialBaseRows.length) {
    try { onPhase?.(initialBaseRows); } catch { /* pintar nunca debe romper la carga */ }
  }
  const [fetchedHomeRows, fetchedDecadeRows] = await Promise.all([
    movieSeriesHomeRowsPromise,
    movieSeriesDecadeRowsPromise,
  ]);
  const existingRowKeys = new Set(initialBaseRows.map(row => `${row.type}:${row.catalogId}`));
  const movieSeriesRows = orderMovieSeriesHomeRows(
    [...fetchedHomeRows, ...fetchedDecadeRows]
      .filter(row => !existingRowKeys.has(`${row.type}:${row.catalogId}`)),
  );
  const baseRows = initialBaseRows;

  if (contentOrientation === "both") {
    // FASE 1: pintar ya con las filas base (pósters listos). El anime
    // (AniList/Jikan en serie) y el enrich de logos llegan en background.
    if (baseRows.length) {
      try { onPhase?.(baseRows); } catch { /* pintar nunca debe romper la carga */ }
    }
    if (movieSeriesRows.length) {
      try { onPhase?.([...baseRows, ...movieSeriesRows]); } catch { /* pintar nunca debe romper la carga */ }
    }
    const animeRows = await fetchAnimeRows();
    if (!animeRows.length) return [...baseRows, ...movieSeriesRows];
    const cinematicRows = animeRows.filter(row => row.presentation === "cinematic");
    const standardAnimeRows = animeRows.filter(row => row.presentation !== "cinematic");

    const baseItemIds = new Set(baseRows.flatMap(r => r.items).map(i => `${i.type}:${i.id}`));
    const filteredAnimeRows = standardAnimeRows.map(row => ({
      ...row,
      items: row.items.filter(item => !baseItemIds.has(`${item.type}:${item.id}`)),
    })).filter(row => row.items.length > 0);

    if (!filteredAnimeRows.length) {
      return [...buildBothModeRows(baseRows, cinematicRows, bothPreference), ...movieSeriesRows];
    }

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

    const balanced = buildBothModeRows(baseRows, [...validAnimeRows, ...cinematicRows], bothPreference);
    const allEnriched = await enrichAllItemsWithLogos(balanced.flatMap(row => row.items));
    let offset = 0;
    const enrichedRows = balanced.map(row => {
      const items = allEnriched.slice(offset, offset + row.items.length);
      offset += row.items.length;
      return { ...row, items };
    });
    return [...enrichedRows, ...movieSeriesRows];
  }

  if (contentOrientation === "movies-series") {
    // FASE 1: pintar ya; el enrich de logos/descripciones llega después.
    if (baseRows.length) {
      try { onPhase?.(baseRows); } catch { /* pintar nunca debe romper la carga */ }
    }
    if (movieSeriesRows.length) {
      try { onPhase?.([...baseRows, ...movieSeriesRows]); } catch { /* pintar nunca debe romper la carga */ }
    }
    const allEnriched = await enrichAllItemsWithLogos(baseRows.flatMap(row => row.items));
    let offset = 0;
    const enrichedRows = baseRows.map(row => {
      const items = allEnriched.slice(offset, offset + row.items.length);
      offset += row.items.length;
      return { ...row, items };
    });
    return [...enrichedRows, ...movieSeriesRows];
  }

  const animeRows = await fetchAnimeRows();
  const cinematicRows = animeRows.filter(row => row.presentation === "cinematic");
  const standardAnimeRows = animeRows.filter(row => row.presentation !== "cinematic");
  const baseItemIds = new Set(baseRows.flatMap(r => r.items).map(i => `${i.type}:${i.id}`));
  const filteredAnimeRows = (standardAnimeRows.length
    ? standardAnimeRows.map(row => ({
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

  const combined = validAnimeRows.length
    ? [...validAnimeRows, ...baseRows, ...cinematicRows]
    : [...baseRows, ...cinematicRows];

  const allEnriched = await enrichAllItemsWithLogos(combined.flatMap(row => row.items));
  let offset = 0;
  const enrichedRows = combined.map(row => {
    const items = allEnriched.slice(offset, offset + row.items.length);
    offset += row.items.length;
    return { ...row, items };
  });
  return enrichedRows;
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
    const unsorted = results
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
    if (!unsorted.length) return null;
    // Popular/Tendencias siguen el Top 20 de JustWatch de SpatialPosters
    // (coincide con el badge #N renderizado en el póster), con no-rankeados
    // ("Recién Añadida", resto) intercalados.
    const items = RANK_SORTED_RAIL_IDS.has(request.id)
      ? await sortRailBySpatialRank(unsorted, request.type).catch(() => unsorted)
      : unsorted;
    if (!items.length) return null;
    return {
      addonId: "aetherio-starter",
      addonName: "Aetherio",
      catalogId: request.id,
      type: request.type,
      name: homeRailTitle(request.title, request.type, false),
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
    cinematic?: boolean;
    decade?: { startYear: number; endYear: number };
    kind: "current" | "top" | "genre" | "other";
    order: number;
  }

  // Order defines dedupe precedence: lower wins.
  const anilistEntries: AnimeEntry[] = [
    { id: "mal.airing_anime", title: "En emisión", fetch: fetchAnilistAiringAnime, kind: "current", tmdb: { sort_by: "popularity.desc", "air_date.gte": isoDate(-90), "air_date.lte": isoDate(90) }, order: 1 },
    { id: "mal.trending_anime", title: "Animes en tendencia", fetch: () => fetchAnilistDiscover({ sort: "TRENDING_DESC" }), kind: "other", tmdb: { sort_by: "popularity.desc" }, order: 8 },
    { id: "mal.top_rated_anime", title: "Los animes mejor valorados", fetch: () => fetchAnilistDiscover({ sort: "SCORE_DESC" }), kind: "top", tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" }, order: 9 },
    { id: "mal.top_anime", title: "Los reyes del anime", fetch: fetchAnilistTopAnime, kind: "top", tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" }, order: 5 },
  ];

  const jikanEntries: AnimeEntry[] = [
    { id: "jikan.recommendations", title: "La comunidad lo recomienda", fetch: fetchJikanRecommendations, kind: "other", order: 2, tmdb: { sort_by: "vote_average.desc", "vote_count.gte": "200" } },
    { id: "jikan.top_favorites", title: "Los animes más queridos del momento", fetch: fetchJikanTopFavorites, kind: "top", order: 3, tmdb: { sort_by: "vote_count.desc" } },
    { id: "jikan.upcoming", title: "Próximos animes a estrenar", fetch: fetchJikanUpcoming, kind: "current", order: 4, tmdb: { sort_by: "popularity.desc", "air_date.gte": isoDate(1), "air_date.lte": isoDate(180) } },
    { id: "jikan.most_popular", title: "Fenómenos populares", fetch: fetchJikanMostPopular, kind: "other", order: 7, tmdb: { sort_by: "vote_count.desc", "vote_count.gte": "100" } },
    { id: "jikan.top_movies", title: "Películas anime más populares", fetch: fetchJikanTopMovies, kind: "top", order: 10, tmdb: { sort_by: "popularity.desc" } },
    {
      id: "jikan.best_anime_90s",
      title: "Los mejores animes de los 90's",
      fetch: fetchJikanBestOfNineties,
      kind: "top",
      order: 4.5,
      cinematic: true,
      decade: { startYear: 1990, endYear: 1999 },
      tmdb: {
        sort_by: "vote_average.desc",
        "first_air_date.gte": "1990-01-01",
        "first_air_date.lte": "1999-12-31",
        "vote_count.gte": "50",
      },
    },
    {
      id: "jikan.best_anime_2000s",
      title: "Los mejores animes de los 2000",
      fetch: fetchJikanBestOf2000s,
      kind: "top",
      order: 7.5,
      cinematic: true,
      decade: { startYear: 2000, endYear: 2009 },
      tmdb: {
        sort_by: "vote_average.desc",
        "first_air_date.gte": "2000-01-01",
        "first_air_date.lte": "2009-12-31",
        "vote_count.gte": "50",
      },
    },
    {
      id: "jikan.best_anime_2010s",
      title: "Los mejores animes de los 2010",
      fetch: fetchJikanBestOf2010s,
      kind: "top",
      order: 9.5,
      cinematic: true,
      decade: { startYear: 2010, endYear: 2019 },
      tmdb: {
        sort_by: "vote_average.desc",
        "first_air_date.gte": "2010-01-01",
        "first_air_date.lte": "2019-12-31",
        "vote_count.gte": "50",
      },
    },
  ];

  // Si AniList/Jikan están caídos (habitual: APIs gratuitas), no se queman
  // timeouts en serie: se va directo al fallback TMDB de cada entrada.
  const [anilistOk, jikanOk] = await Promise.all([probeAnilist(), probeJikan()]);

  // Fetch AniList entries in parallel, Jikan entries serially (rate-limit).
  const anilistRaw = await Promise.all(
    anilistEntries.map(async (entry): Promise<{ entry: AnimeEntry; items: MediaItem[] }> => {
      let items: MediaItem[] = [];
      if (anilistOk) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
          try { items = await entry.fetch(); } catch {}
          if (items.length) break;
        }
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
        if (jikanOk) {
          try { items = await entry.fetch(); } catch {}
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
      },
    })),
  );
  const jikanResults = await Promise.all(jikanRaw);

  const allResults = [...anilistRaw, ...jikanResults].sort((a, b) => a.entry.order - b.entry.order);
  const rows = dedupeAnimeHomeRows(allResults.filter(result => !result.entry.cinematic));

  for (const { entry, items } of allResults) {
    if (!entry.cinematic || !entry.decade) continue;
    const { startYear, endYear } = entry.decade;
    const isInDecade = (item: MediaItem) => item.year != null && item.year >= startYear && item.year <= endYear;
    const cinematicItems = items.filter(isInDecade);
    const seen = new Set(cinematicItems.map(item => `${item.type}:${item.id}`));
    const fallbackItems = allResults
      .filter(result => !result.entry.cinematic)
      .flatMap(result => result.items)
      .filter(isInDecade)
      .sort((left, right) => ratingOutOfTen(right) - ratingOutOfTen(left));
    for (const item of fallbackItems) {
      if (cinematicItems.length >= HOME_RAIL_ITEM_LIMIT) break;
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cinematicItems.push(item);
    }
    const malResolvedItems = await resolveMalToTmdb(cinematicItems);
    const tmdbResolvedItems = await resolveAnilistToTmdb(malResolvedItems);
    const seenTmdbItems = new Set<string>();
    const rankedTmdbItems = tmdbResolvedItems
      .flatMap(item => {
        const poster = isTmdbArtworkUrl(item.poster) ? item.poster : undefined;
        const background = isTmdbArtworkUrl(item.background) ? item.background : poster;
        if (!background) return [];
        const key = item.id.startsWith("tmdb:")
          ? item.id
          : `${item.name.trim().toLowerCase()}:${item.year ?? ""}`;
        if (seenTmdbItems.has(key)) return [];
        seenTmdbItems.add(key);
        return [{ ...item, poster: poster ?? background, background }];
      })
      .sort((left, right) => ratingOutOfTen(right) - ratingOutOfTen(left));
    if (!rankedTmdbItems.length) continue;
    rows.push({
      addonId: "aetherio-jikan",
      addonName: "Jikan",
      catalogId: entry.id,
      type: "anime",
      name: entry.title,
      subtitle: `Anime · ${startYear}–${endYear}`,
      presentation: "cinematic",
      items: rankedTmdbItems.slice(0, HOME_RAIL_ITEM_LIMIT),
      order: entry.order,
    });
  }
  return rows;
}

function ratingOutOfTen(item: MediaItem) {
  const rating = Number(item.rating ?? item.imdbRating);
  if (!Number.isFinite(rating)) return 0;
  return rating > 10 ? rating / 10 : rating;
}

function isTmdbArtworkUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "image.tmdb.org" && url.pathname.startsWith("/t/p/");
  } catch {
    return false;
  }
}

function buildBothModeRows(
  baseRows: CatalogRowData[],
  animeRows: CatalogRowData[],
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
): CatalogRowData[] {
  if (bothPreference === "anime") return [...animeRows, ...baseRows];
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
  if (
    !home
    || !isReusableHomeCache(home.rowsUpdatedAt)
    || normalizeDailyRowsSignature(home.rowsSignature) !== normalizeDailyRowsSignature(signature)
  ) {
    return undefined;
  }
  return home.rows;
}

function cachedHero(signature: string) {
  const home = useCacheStore.getState().home;
  if (
    !home
    || !isReusableHomeCache(home.heroUpdatedAt)
    || normalizeDailyHeroSignature(home.heroSignature) !== normalizeDailyHeroSignature(signature)
  ) {
    return undefined;
  }
  return home.heroItems.map(item => ({
    ...item,
    background: upgradeTmdbImage(item.background, HOME_BACKGROUND_IMAGE_SIZE),
  }));
}

export function prefetchHomeData(
  queryClient: QueryClient,
  addons: InstalledAddon[],
  contentOrientation: ContentOrientation = "both",
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
) {
  const rowsSignature = enabledAddonSignature(addons, contentOrientation, bothPreference);
  const currentHeroSignature = heroSignature();
  const home = useCacheStore.getState().home;
  const rows = cachedRows(rowsSignature);
  const hero = cachedHero(currentHeroSignature);
  const rowsStaleTime = home?.rowsSignature === rowsSignature ? HOME_ROWS_STALE_TIME : 0;
  const heroStaleTime = home?.heroSignature === currentHeroSignature ? HOME_HERO_STALE_TIME : 0;

  if (rows) {
    queryClient.setQueryData(homeCatalogKeys.rows(rowsSignature), rows, { updatedAt: home?.rowsUpdatedAt });
  }
  if (hero) {
    queryClient.setQueryData(homeCatalogKeys.hero(currentHeroSignature), hero, { updatedAt: home?.heroUpdatedAt });
  }

  const rowsPromise = queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    // Con fases: las filas base pintan en cuanto están (vía setQueryData)
    // aunque el anime/enrich siga en vuelo.
    queryFn: () => fetchHomeRows(addons, contentOrientation, phased => {
      queryClient.setQueryData(homeCatalogKeys.rows(rowsSignature), phased);
    }, bothPreference),
    staleTime: rowsStaleTime,
    gcTime: HOME_GC_TIME,
  });
  const heroPromise = queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.hero(currentHeroSignature),
    queryFn: fetchHomeHero,
    staleTime: heroStaleTime,
    gcTime: HOME_GC_TIME,
  });
  return Promise.allSettled([rowsPromise, heroPromise]);
}

export async function warmHomeStartup(
  queryClient: QueryClient,
  addons: InstalledAddon[],
  contentOrientation: ContentOrientation = "both",
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
  onImages?: () => void,
  onProgress?: (progress: number) => void,
) {
  // Siembra caché persistida y arranca el fetch con fases (las fases pintan
  // vía setQueryData aunque el anime/enrich siga en vuelo).
  const rowsSignature = enabledAddonSignature(addons, contentOrientation, bothPreference);
  const currentHeroSignature = heroSignature();
  const home = useCacheStore.getState().home;
  const rows = cachedRows(rowsSignature);
  const hero = cachedHero(currentHeroSignature);
  const rowsStaleTime = home?.rowsSignature === rowsSignature ? HOME_ROWS_STALE_TIME : 0;
  const heroStaleTime = home?.heroSignature === currentHeroSignature ? HOME_HERO_STALE_TIME : 0;

  // Un solo sondeo, antes de nada: si SpatialPosters no esta levantado se
  // apaga el pipeline de posters de una vez en vez de fallar una vez por
  // poster. No bloquea el arranque (el prewarm lo espera, no esto).
  // El server en si lo levanta App.tsx al abrir, no aqui.
  const posterSettings = getSpatialPosterSettings();
  if (isSpatialPostersConfigured(posterSettings)) {
    // Se espera al arranque antes de sondear: contra el puerto 3000 recien
    // encendido el probe solo daria `ERR_CONNECTION_REFUSED` y marcaria la
    // instancia como caida, apagando los posters de toda la sesion.
    void resolvePosterEndpoint(posterSettings).then(url => probeSpatialInstance(url));
  }

  if (rows) {
    queryClient.setQueryData(homeCatalogKeys.rows(rowsSignature), rows, { updatedAt: home?.rowsUpdatedAt });
  }
  if (hero) {
    queryClient.setQueryData(homeCatalogKeys.hero(currentHeroSignature), hero, { updatedAt: home?.heroUpdatedAt });
  }
  const rowsPromise = queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    queryFn: () => fetchHomeRows(addons, contentOrientation, phased => {
      queryClient.setQueryData(homeCatalogKeys.rows(rowsSignature), phased);
    }, bothPreference),
    staleTime: rowsStaleTime,
    gcTime: HOME_GC_TIME,
  });
  const heroPromise = queryClient.prefetchQuery({
    queryKey: homeCatalogKeys.hero(currentHeroSignature),
    queryFn: fetchHomeHero,
    staleTime: heroStaleTime,
    gcTime: HOME_GC_TIME,
  });
  // `Promise.allSettled` arriba espera a que las filas queden completas (base +
  // anime). A partir de ahi el prewarm sí ve todas las filas, no solo la fase 1.
  await Promise.allSettled([rowsPromise, heroPromise]);
  onProgress?.(0.55);

  onImages?.();

  // Un solo reloj para todo lo que queda de arranque. Antes cada etapa tenia su
  // techo (el prewarm 300 s, la espera 120 s) y se sumaban: el splash llegaba a
  // los 148 s medidos en un arranque en frio de verdad, cuando el presupuesto
  // total era de 90 s.
  const postersDeadline = Date.now() + SPLASH_POSTER_BUDGET_MS;

  // Las filas se leen de la query YA SETTLEADA (`rowsPromise`), no de la cache.
  // Este era el bug que dejaba media pantalla en TMDB: `fetchHomeRows` pinta en
  // dos fases (base primero, anime despues, con `setQueryData`), y `getQueryData`
  // en ese momento devolvia solo la fase 1. El prewarm|precalientaba ~117
  // posters y las filas de anime se quedaban sin generar para siempre, porque
  // nadie volvia a mirarlas.
  const readyRows = await queryClient.fetchQuery<CatalogRowData[]>({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    staleTime: HOME_ROWS_STALE_TIME,
  }).catch(() => queryClient.getQueryData<CatalogRowData[]>(homeCatalogKeys.rows(rowsSignature)) ?? []);
  const heroSource = queryClient.getQueryData<MediaItem[]>(homeCatalogKeys.hero(heroSignature())) ?? [];
  const heroItems = mergeHeroItems(heroSource, readyRows, contentOrientation, bothPreference);

  const backgroundUrls = collectHomeDetailBackgroundUrls(readyRows, heroItems);
  // El progreso del prewarm se reporta como fraccion del tramo final: los
  // catalogos ya cargaron (0.55) y lo que queda son las imagenes. Asi la barra
  // de la pantalla de carga avanza con los posteres reales en vez de quedarse
  // clavada en el mismo numero mientras se hornea todo.
  const posterProgress = onProgress
    ? (done: number, total: number) => {
        if (total <= 0) return;
        onProgress(0.55 + (done / total) * 0.45);
      }
    : undefined;

  await Promise.allSettled([
    prewarmSpatialPosterRows(readyRows, posterProgress, postersDeadline),
    preloadImageUrls(backgroundUrls),
  ]);

  // Ultimo filtro antes de dejar entrar a Home. Lo que no se haya verificado se
  // reintenta con lo que queda del mismo presupuesto. Si al final siguen
  // faltando, se entra igual: unas pocas cards con el póster de TMDB son
  // mejores que un splash trabado.
  let pending = await waitForPostersOrGiveUp(
    readyRows,
    posterProgress,
    postersDeadline - Date.now(),
  );
  if (pending > 0) {
    pending = await retryMissingPosters(
      readyRows,
      posterProgress,
      Math.max(1_000, postersDeadline - Date.now()),
    );
  }
  // Sin este log, un arranque lento se ve igual que uno colgado: la pantalla
  // queda en el logo y no hay forma de saber si faltan posters o si algo se
  // rompio. El mensaje lleva los numeros que explican cuanto faltaba y cuanto se
  // espero, que es lo que haria falta para diagnosticar sin instrumentar.
  if (pending > 0) {
    const waitedS = Math.round(
      Math.max(0, SPLASH_POSTER_BUDGET_MS - (postersDeadline - Date.now())) / 1000,
    );
    console.warn(
      `[posters] ${pending} póster(es) sin SpatialPosters tras ${waitedS} s de espera; ` +
        "se entra a Home y esas cards usan el póster de TMDB.",
    );
  }
  onProgress?.(1);
}

/**
 * Espera a que se vacíe la lista de posters pendientes, hasta `remainingMs`.
 * Devuelve los que siguen faltando.
 *
 * El presupuesto es TOTAL y corre para todo lo que queda de arranque: la
 * primera pasada del prewarm mas estas esperas.
 *
 * Cada vuelta re-verifica de verdad a los que faltan: les borra el fallo
 * recordado antes de sondearlos, asi los que cayeron por cola congestionada se
 * recuperan apenas la cola baja. Un fallo terminal (un 404 de un titulo que la
 * instancia no sabe renderizar) no se recupera por mas que se reintente, asi
 * que si el conjunto pendiente no baja en dos vueltas seguidas se corta ahi y
 * esas cards usan el poster de TMDB. Antes se seguia hasta el deadline
 * esperando cada TTL de 15 s: con un solo 404 el splash quemaba los 75 s
 * completos en cada arranque aunque el resto ya estuviera en el registro.
 */
async function waitForPostersOrGiveUp(
  rows: CatalogRowData[],
  posterProgress?: (done: number, total: number) => void,
  remainingMs = SPLASH_POSTER_BUDGET_MS,
): Promise<number> {
  const settings = getSpatialPosterSettings();
  if (!isSpatialPostersConfigured(settings)) return 0;
  const startedAt = Date.now();
  const signature = spatialPosterSignature(settings);
  let noProgressStreak = 0;
  while (Date.now() - startedAt < remainingMs) {
    const missing = collectMissingPosterTargets(rows, settings, signature);
    // Sin pendientes no hay nada que esperar: se entra ya.
    if (!missing.length) return 0;
    for (const url of missing) forgetPosterFailure(url);
    const pending = await retryMissingPosters(
      rows,
      posterProgress,
      remainingMs - (Date.now() - startedAt),
    );
    if (pending === 0) return 0;
    if (pending < missing.length) {
      noProgressStreak = 0;
    } else {
      noProgressStreak += 1;
      if (noProgressStreak >= 2) return pending;
    }
    // La pausa entre vueltas importa: sin ella este bucle corre requests
    // seguidas y compite con el propio SpatialPosters por CPU, que es justo lo
    // que hace que los renders tarden mas.
    await delay(SPLASH_POSTER_POLL_MS);
  }
  return collectMissingPosterTargets(rows, settings, signature).length;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Reintenta los posters pendientes una vez y devuelve los que aun faltan. */
async function retryMissingPosters(
  rows: CatalogRowData[],
  posterProgress?: (done: number, total: number) => void,
  timeoutMs = PREWARM_TIMEOUT_MS,
): Promise<number> {
  const settings = getSpatialPosterSettings();
  if (!isSpatialPostersConfigured(settings)) return 0;
  const signature = spatialPosterSignature(settings);
  const missing = collectMissingPosterTargets(rows, settings, signature);
  if (!missing.length) return 0;

  let retried = 0;
  let next = 0;
  const workers = Array.from(
    { length: Math.min(POSTER_PROBE_MAX_CONCURRENT, missing.length) },
    async () => {
      while (next < missing.length) {
        const url = missing[next++];
        await preloadPosterArtwork(url, settings, signature);
        retried += 1;
        posterProgress?.(retried, missing.length);
      }
    },
  );
  await withTimeout(
    Promise.allSettled(workers),
    timeoutMs,
  ).catch(() => undefined);
  return collectMissingPosterTargets(rows, settings, signature).length;
}

/** Fondos de Home y de detalle para cada medio precargado. */
function collectHomeDetailBackgroundUrls(rows: CatalogRowData[], heroItems: MediaItem[]) {
  const urls = new Set<string>();
  for (const item of heroItems) {
    if (item.background) urls.add(item.background);
    const detailBackground = resolveDetailBackground(item.type, item.id, item.background);
    if (detailBackground) urls.add(detailBackground);
  }
  for (const row of rows) {
    for (const item of row.items) {
      const detailBackground = resolveDetailBackground(item.type, item.id, item.background);
      const background = readHomeCardArtwork(
        "background",
        item.type,
        item.id,
        detailBackground ?? item.background,
      );
      if (background) urls.add(background);
      if (detailBackground) urls.add(detailBackground);
    }
  }
  for (const entry of getContinueWatchingRows()) {
    const background = readHomeCardArtwork("background", entry.type, entry.id, entry.background);
    const detailBackground = resolveDetailBackground(entry.type, entry.id, entry.background);
    if (entry.episodeStill) urls.add(entry.episodeStill);
    if (background) urls.add(background);
    if (detailBackground) urls.add(detailBackground);
  }
  return [...urls];
}

/**
 * Presupuesto TOTAL de espera de posters durante el arranque.
 *
 * Reparte lo que queda entre la primera pasada y las re rondas, para que el
 * tiempo en el splash este acotado por este numero y no por la suma de varios.
 *
 * Medido en este equipo con arranque en frío y caché vacía: 3.5 s por póster
 * (el render de sharp con badges) y ~150 pósteres visibles en Home. A 12
 * verificaciones en paralelo son ~45 s. El presupuesto queda en 75 s: margen
 * para renders más lentos, sin llegar a que el splash se haga eterno.
 *
 * Con la concurrencia que había antes (6) eran 86 s solo la cola, más las re
 * rondas: de ahi el arranque de 148 s que se veía. Acá, con un solo deadline
 * compartido, pase lo que pase se entra a Home dentro de este techo.
 */
const SPLASH_POSTER_BUDGET_MS = 75_000;

/** Pausa entre rondas de reintento. Sin ella el bucle satura el server. */
const SPLASH_POSTER_POLL_MS = 750;

/**
 * Techo de la primera pasada. Es una parte del presupuesto total, no un
 * presupuesto propio: si se la comiera entero, las re rondas no tendrian nada.
 */
const PREWARM_TIMEOUT_MS = Math.round(SPLASH_POSTER_BUDGET_MS * 0.6);

/**
 * Calienta el póster final de los medios de las filas recibidas.
 *
 * Home pasa todas sus filas y usa el resultado para su pantalla de carga; las
 * páginas de plataforma pasan solo las primeras cards de cada fila y lo hacen
 * en segundo plano.
 */
export async function prewarmSpatialPosterRows(
  rows: CatalogRowData[],
  onProgress?: (done: number, total: number) => void,
  deadlineAt = Date.now() + PREWARM_TIMEOUT_MS,
): Promise<number> {
  const settings = getSpatialPosterSettings();
  if (!isSpatialPostersConfigured(settings)) return 0;
  // El server recien arrancado puede tardar un par de segundos en responder.
  // Si la instancia no esta levantada no se intenta ni un póster: el pipeline
  // queda en los de TMDB y la pantalla de carga no se queda esperando.
  if (!await probeSpatialInstance(await resolvePosterEndpoint(settings))) return 0;
  const signature = spatialPosterSignature(settings);
  const jobs: Array<() => Promise<void>> = [];
  for (const row of rows) {
    const overrides = isTopFormatRow(row) ? TOP_SPATIAL_POSTER_OVERRIDES : undefined;
    for (const item of row.items) {
      jobs.push(() => prewarmOnePoster(item, settings, signature, overrides));
    }
  }
  // El pool no sube de `POSTER_PROBE_MAX_CONCURRENT` (6) a proposito: el
  // navegador abre 6 conexiones por host y `posterProbe` ya tiene su propia cola
  // con ese limite. Lanzar mas workers de los que hay slots solo hace que
  // esperen dentro de esa cola, sin ganar nada.
  const total = jobs.length;
  let done = 0;
  onProgress?.(0, total);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(POSTER_PROBE_MAX_CONCURRENT, jobs.length) },
    async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        await job();
        done += 1;
        onProgress?.(done, total);
      }
    },
  );
  // Se espera a TODOS, pero no mas alla del deadline que le paso el arranque.
  // Los que fallan o no tienen id TMDB resuelven igual (con `allSettled` y el
  // catch interno de `prewarmOnePoster`), asi que esta promesa no se cuelga por
  // un poster problematico: solo por uno que se quede colgado contra el
  // servidor.
  await withTimeout(
    Promise.allSettled(workers),
    Math.max(1_000, deadlineAt - Date.now()),
  ).catch(() => undefined);

  return collectMissingPosterTargets(rows, settings, signature).length;
}

/**
 * URLs de SpatialPosters que siguen sin verificar tras el prewarm.
 *
 * Solo cuenta los que tienen id TMDB: sin id no hay URL de SpatialPosters que
 * construir, y ese item ya está en su fallback de forma correcta y permanente.
 * Los que sí tienen id y fallaron -cola congestionada o fallo terminal- son
 * los que las re rondas reintentan; el corte por falta de progreso de
 * `waitForPostersOrGiveUp` evita esperar por los que no se van a recuperar.
 */
function collectMissingPosterTargets(
  rows: CatalogRowData[],
  settings: SpatialPosterSettings,
  signature: string,
): string[] {
  const missing: string[] = [];
  for (const row of rows) {
    const overrides = isTopFormatRow(row) ? TOP_SPATIAL_POSTER_OVERRIDES : undefined;
    for (const item of row.items) {
      // Un artwork elegido a mano manda sobre el poster del catalogo: para el
      // no se genera un poster de SpatialPosters, asi que se saltea.
      if (readHomeCardArtwork("poster", item.type, item.id)) continue;
      const tmdbId = extractTmdbId(item.id);
      if (!tmdbId || !item.poster) continue;
      const url = applySpatialPosterToUrl(item.poster, tmdbId, item.type, settings, overrides);
      if (!url) continue;
      if (!isPosterArtworkFailed(url, settings, signature)) continue;
      missing.push(url);
    }
  }
  return missing;
}

async function prewarmOnePoster(
  item: MediaItem,
  settings: SpatialPosterSettings,
  signature: string,
  overrides?: SpatialPosterOverrides,
) {
  try {
    const custom = readHomeCardArtwork("poster", item.type, item.id);
    const base = custom ?? item.poster;
    if (!base) return;
    if (custom) {
      await preloadPosterArtwork(base, settings, signature);
      return;
    }
    const tmdbId = extractTmdbId(item.id);
    const candidate = tmdbId
      ? applySpatialPosterToUrl(base, tmdbId, item.type, settings, overrides)
      : base;
    if (candidate && await preloadPosterArtwork(candidate, settings, signature)) return;
    const fallback = item.originalPoster ?? base;
    if (fallback && fallback !== candidate) await preloadPosterArtwork(fallback, settings, signature);
  } catch { /* prewarm best-effort: nunca rompe el arranque */ }
}


export function useHomeCatalogs(
  addons: InstalledAddon[],
  contentOrientation: ContentOrientation = "both",
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
  enabled = true,
) {
  const queryClient = useQueryClient();
  // TMDB siempre disponible: key propia en directo o proxy del servidor.
  const tmdbReady = enabled;
  // Fuerza recomputar rowsSignature (incluye ajustes SpatialPosters) al cambiarlos.
  const [posterVersion, setPosterVersion] = useState(0);

  useEffect(() => {
    const refresh = () => {
      // Cambiar la instancia invalida el sondeo de disponibilidad de la anterior.
      resetSpatialAvailability();
      clearSpatialRankCache();
      setPosterVersion(version => version + 1);
    };
    window.addEventListener(SPATIAL_POSTER_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SPATIAL_POSTER_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const rowsSignature = useMemo(
    () => enabledAddonSignature(addons, contentOrientation, bothPreference),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addons, contentOrientation, bothPreference, posterVersion],
  );
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
  const homeSnapshot = useCacheStore.getState().home;
  const rowsStaleTime = homeSnapshot?.rowsSignature === rowsSignature ? HOME_ROWS_STALE_TIME : 0;
  const heroStaleTime = homeSnapshot?.heroSignature === currentHeroSignature ? HOME_HERO_STALE_TIME : 0;

  const rowsQuery = useQuery({
    queryKey: homeCatalogKeys.rows(rowsSignature),
    // La query emite una fase parcial (filas base) a mitad de camino para
    // pintar sin esperar al anime ni al enrich; el resultado final la reemplaza.
    queryFn: () => fetchHomeRows(addons, contentOrientation, phased => {
      queryClient.setQueryData(homeCatalogKeys.rows(rowsSignature), phased);
    }, bothPreference),
    enabled: tmdbReady,
    initialData: initialRows,
    initialDataUpdatedAt: initialRows ? useCacheStore.getState().home?.rowsUpdatedAt : undefined,
    staleTime: rowsStaleTime,
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
    staleTime: heroStaleTime,
    gcTime: HOME_GC_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    // No persistir la fase parcial (llega con isFetching=true); solo el
    // resultado final, para no congelar filas sin logos en el arranque.
    if (rowsQuery.data && !rowsQuery.isFetching) {
      useCacheStore.getState().setHomeRows(rowsQuery.data, rowsSignature);
    }
  }, [rowsQuery.data, rowsQuery.isFetching, rowsSignature]);

  useEffect(() => {
    if (heroQuery.data) {
      useCacheStore.getState().setHomeHero(heroQuery.data, currentHeroSignature);
    }
  }, [heroQuery.data, currentHeroSignature]);

  useEffect(() => {
    if (tmdbReady) {
      prefetchHomeData(queryClient, addons, contentOrientation, bothPreference);
    }
  }, [addons, queryClient, contentOrientation, bothPreference, tmdbReady]);

  // Calienta en background el último episodio emitido de las series
  // completadas: es lo que permite ocultar vistos con episodios nuevos
  // como única excepción. Barato si la caché está fresca.
  useEffect(() => {
    if (!tmdbReady) return;
    void refreshWatchedSeriesCache();
    const refresh = () => { void refreshWatchedSeriesCache(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [tmdbReady]);

  const rows = rowsQuery.data ?? [];
  const heroItems = useMemo(
    () => mergeHeroItems(heroQuery.data ?? [], rows, contentOrientation, bothPreference),
    [bothPreference, contentOrientation, heroQuery.data, rows],
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

  return {
    rows,
    heroItems,
    // Las filas son la condición mínima para pintar Home. El héroe puede
    // resolverse después y no debe cubrir una biblioteca ya disponible.
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
  const workers = Math.min(homeImagePreloadConcurrency(), urls.length);
  let index = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (index < urls.length) {
      const url = urls[index];
      index += 1;
      await preloadArtworkImage(url);
    }
  }));
}
