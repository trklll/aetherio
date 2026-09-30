import type { MediaItem } from "../types/ui.ts";
import { tmdbFetch } from "../config/apiKeys.ts";
import { pickTmdbSearchCandidate } from "../utils/tmdbIdentity.ts";

const ANILIST_URL = "https://graphql.anilist.co";
const anilistIdByMalCache = new Map<number, number>();
const anilistIdByMalMisses = new Map<number, number>();
const anilistIdByMalPromises = new Map<number, Promise<number | null>>();

/**
 * AniList tiene una cuota global y responde 429 sin cabecera CORS (por eso el
 * navegador reporta a la vez "429" y "error de CORS": es el mismo incidente).
 * Antes salian en rafaga: las 4 entradas del Home en `Promise.all` mas un
 * reintento cada una, y ademas `fetchAnilistIdByMalId` en cada apertura de
 * detalle. Aqui se serializan con una separacion minima entre arranques.
 */
const ANILIST_MIN_INTERVAL_MS = 250;
const ANILIST_TIMEOUT_MS = 8_000;
const ANILIST_COOLDOWN_MS = 60_000;
/** Un id que no existe en AniList no va a aparecer solo: se recuerda un rato. */
const ANILIST_MISS_TTL_MS = 10 * 60 * 1000;

let anilistChain: Promise<unknown> = Promise.resolve();
let anilistLastStart = 0;
let anilistCooldownUntil = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Encadena las consultas y respeta la separacion minima y el cooldown. */
function scheduleAnilist<T>(task: () => Promise<T>): Promise<T> {
  const run = anilistChain.then(async () => {
    const wait = Math.max(
      anilistCooldownUntil - Date.now(),
      anilistLastStart + ANILIST_MIN_INTERVAL_MS - Date.now(),
      0,
    );
    if (wait > 0) await sleep(wait);
    anilistLastStart = Date.now();
    return task();
  });
  // La cadena no se rompe si una consulta falla.
  anilistChain = run.then(() => undefined, () => undefined);
  return run;
}

const PROBE_TTL_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5_000;
let probeAt = 0;
let probeOk = true;

/**
 * ¿Responde la API de AniList? Con caché corta: cuando la suspenden (403
 * documentado por "stability issues") se salta sus intentos y se tira de
 * TMDB directo sin esperar timeouts.
 */
export async function probeAnilist(): Promise<boolean> {
  if (Date.now() - probeAt < PROBE_TTL_MS) return probeOk;
  probeAt = Date.now();
  probeOk = await scheduleAnilist(async () => {
    try {
      const response = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query: "query { Page(page: 1, perPage: 1) { media { id } } }" }),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  });
  return probeOk;
}

interface AniListMedia {
  id: number;
  idMal: number | null;
  title: { romaji: string; english: string | null };
  coverImage: { large: string | null } | null;
  bannerImage: string | null;
  description: string | null;
  averageScore: number | null;
  genres: string[] | null;
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
}

interface AniListPage {
  data: {
    Page: {
      media: AniListMedia[];
    };
  };
}

function anilistSeason(): { season: string; seasonYear: number } {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  if (month < 3) return { season: "WINTER", seasonYear: year };
  if (month < 6) return { season: "SPRING", seasonYear: year };
  if (month < 9) return { season: "SUMMER", seasonYear: year };
  return { season: "FALL", seasonYear: year };
}

function mediaToItem(media: AniListMedia): MediaItem {
  const name = media.title.english ?? media.title.romaji;
  const poster = media.coverImage?.large ?? undefined;
  const year = media.startDate?.year ?? media.seasonYear ?? undefined;

  return {
    id: `anilist:${media.id}`,
    type: "anime",
    name,
    searchAliases: [media.title.romaji, media.title.english ?? ""].filter(Boolean),
    poster,
    background: poster,
    logo: undefined,
    description: media.description?.replace(/<[^>]*>/g, "") ?? undefined,
    year,
    genres: media.genres?.length ? media.genres : undefined,
    rating: media.averageScore != null ? String(media.averageScore) : undefined,
    _anilistId: media.id,
    _malId: media.idMal ?? undefined,
    _romaji: media.title.romaji,
    _english: media.title.english ?? undefined,
  } as MediaItem & { _anilistId: number; _malId?: number; _romaji: string; _english?: string };
}

async function anilistQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  return scheduleAnilist(async () => {
    try {
      const response = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(ANILIST_TIMEOUT_MS),
      });
      if (response.status === 429) {
        // Congela el resto de la cola: seguir golpeando solo alarga el bloqueo.
        const retryAfter = Number(response.headers.get("Retry-After"));
        const cooldown = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : ANILIST_COOLDOWN_MS;
        anilistCooldownUntil = Date.now() + cooldown;
        if (import.meta.env.DEV) {
          console.warn(`[ANILIST] 429: pausando consultas ${Math.round(cooldown / 1000)}s.`);
        }
        return null;
      }
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  });
}

/** Resuelve el identificador AniList de una obra que solo trae ID de MyAnimeList. */
export async function fetchAnilistIdByMalId(malId: number): Promise<number | null> {
  if (!Number.isInteger(malId) || malId <= 0) return null;
  const cached = anilistIdByMalCache.get(malId);
  if (cached) return cached;
  const missedAt = anilistIdByMalMisses.get(malId);
  if (missedAt != null) {
    if (Date.now() - missedAt < ANILIST_MISS_TTL_MS) return null;
    anilistIdByMalMisses.delete(malId);
  }
  const pending = anilistIdByMalPromises.get(malId);
  if (pending) return pending;
  const request = (async () => {
    const result = await anilistQuery<{ data?: { Media?: { id?: number | null } | null } }>(
      `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id } }`,
      { idMal: malId },
    );
    const id = result?.data?.Media?.id;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) {
      anilistIdByMalCache.set(malId, id);
      anilistIdByMalMisses.delete(malId);
      return id;
    }
    anilistIdByMalMisses.set(malId, Date.now());
    return null;
  })().finally(() => anilistIdByMalPromises.delete(malId));
  anilistIdByMalPromises.set(malId, request);
  return request;
}

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english }
  coverImage { large }
  bannerImage
  description
  averageScore
  genres
  season
  seasonYear
  startDate { year }
`;

export async function fetchAnilistAiringAnime(): Promise<MediaItem[]> {
  const { season, seasonYear } = anilistSeason();
  const result = await anilistQuery<AniListPage>(
    `query ($season: MediaSeason, $seasonYear: Int) {
      Page(page: 1, perPage: 25) {
        media(status: RELEASING, type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
    { season, seasonYear },
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistTopAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistDiscover({
  page = 1,
  genre,
  sort = "POPULARITY_DESC",
}: {
  page?: number;
  genre?: string;
  sort?: "POPULARITY_DESC" | "SCORE_DESC" | "TRENDING_DESC" | "FAVOURITES_DESC";
} = {}): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query ($page: Int, $genre: String, $sort: [MediaSort]) {
      Page(page: $page, perPage: 25) {
        media(type: ANIME, genre: $genre, sort: $sort, isAdult: false) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
    { page, genre: genre || null, sort: [sort] },
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistMostFavorites(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(type: ANIME, sort: FAVOURITES_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistTopAiring(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(status: RELEASING, type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistActionAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Action", type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistAdventureAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Adventure", type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistComedyAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Comedy", type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistDramaAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Drama", type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistRomanceAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Romance", type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistFantasyAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Fantasy", type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistSciFiAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Sci-Fi", type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

function prevAnilistSeason(): { season: string; seasonYear: number } {
  const { season, seasonYear } = anilistSeason();
  const order = ["WINTER", "SPRING", "SUMMER", "FALL"];
  const idx = order.indexOf(season);
  const prevIdx = (idx - 1 + order.length) % order.length;
  const prevSeason = order[prevIdx];
  const prevYear = idx === 0 ? seasonYear - 1 : seasonYear;
  return { season: prevSeason, seasonYear: prevYear };
}

export async function fetchAnilistLastYearBestAnime(): Promise<MediaItem[]> {
  const { season, seasonYear } = prevAnilistSeason();
  const result = await anilistQuery<AniListPage>(
    `query ($season: MediaSeason, $seasonYear: Int) {
      Page(page: 1, perPage: 25) {
        media(season: $season, seasonYear: $seasonYear, type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
    { season, seasonYear },
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

interface AnilistEnrichedItem extends MediaItem {
  _anilistId: number;
  _malId?: number;
  _romaji: string;
  _english?: string;
}

interface TmdbSearchResult {
  id: number;
  poster_path?: string;
  backdrop_path?: string;
  name?: string;
  title?: string;
  original_name?: string;
  popularity?: number;
}

async function searchTmdbByTitle(
  title: string,
  searchType: "tv" | "movie",
  year?: number,
): Promise<TmdbSearchResult | null> {
  const params: Record<string, string> = {
    query: title,
    language: "es-ES",
    page: "1",
  };
  if (year) {
    params[searchType === "tv" ? "first_air_date_year" : "year"] = String(year);
  }
  return withTmdbSearchSlot(async () => {
    const result = await tmdbFetch<{ results: TmdbSearchResult[] }>(`/search/${searchType}`, { params });
    if (!result?.results?.length) return null;
    const selected = pickTmdbSearchCandidate(
      result.results.map(item => ({ kind: searchType, item })),
      title,
      year,
    );
    return selected?.item ?? null;
  });
}

/**
 * Limite GLOBAL de busquedas TMDB. Antes cada fila de anime llevaba su propio
 * pool de 3, y como las filas corren en `Promise.all` eso multiplicaba la
 * concurrencia (9 filas x 3). El tope tiene que ser de todo el cliente, no por
 * fila, y conviene que sea bajo: en redes con limitacion (escuela, movil,
 * coworking) lo que tira la conexion abajo es la rafaga, no el total.
 */
const TMDB_SEARCH_CONCURRENCY = 3;
let tmdbSearchActive = 0;
const tmdbSearchQueue: Array<() => void> = [];

async function withTmdbSearchSlot<T>(task: () => Promise<T>): Promise<T> {
  if (tmdbSearchActive >= TMDB_SEARCH_CONCURRENCY) {
    await new Promise<void>(resolve => {
      tmdbSearchQueue.push(resolve);
    });
  } else {
    tmdbSearchActive += 1;
  }
  try {
    return await task();
  } finally {
    // El slot se cede al siguiente de la cola; si no hay, se libera.
    const next = tmdbSearchQueue.shift();
    if (next) next();
    else tmdbSearchActive -= 1;
  }
}

interface AnimeTmdbMatch {
  tmdbId: number;
  poster?: string;
  background?: string;
}

/** Un acierto aguanta media hora: la correspondencia titulo -> tmdb no cambia. */
const ANIME_MATCH_TTL_MS = 30 * 60 * 1000;
/** Un "no existe" se recuerda menos: si fue la red y no TMDB, quiero reintentar. */
const ANIME_MISS_TTL_MS = 10 * 60 * 1000;
const animeTmdbCache = new Map<string, { match: AnimeTmdbMatch; expiresAt: number }>();

function toTmdbItem(r: TmdbSearchResult) {
  return {
    tmdbId: r.id,
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : undefined,
    background: r.backdrop_path ? `https://image.tmdb.org/t/p/original${r.backdrop_path}` : undefined,
  };
}

function rememberAnimeMatch(key: string, match: AnimeTmdbMatch) {
  if (animeTmdbCache.size > 400) {
    const now = Date.now();
    for (const [k, v] of animeTmdbCache) {
      if (now > v.expiresAt) animeTmdbCache.delete(k);
    }
  }
  const ttl = match.tmdbId > 0 ? ANIME_MATCH_TTL_MS : ANIME_MISS_TTL_MS;
  animeTmdbCache.set(key, { match, expiresAt: Date.now() + ttl });
}

async function trySearch(
  title: string,
  searchType: "tv" | "movie",
  year?: number,
): Promise<AnimeTmdbMatch | null> {
  try {
    const r = await searchTmdbByTitle(title, searchType, year);
    return r ? toTmdbItem(r) : null;
  } catch {
    return null;
  }
}

async function searchTmdbAnime(
  englishTitle: string | undefined,
  romajiTitle: string,
  year?: number,
): Promise<AnimeTmdbMatch> {
  // Sin deduplicar, pasar el mismo nombre por english y por romaji disparaba
  // dos veces cada consulta identica.
  const titles = [...new Set(
    [englishTitle, romajiTitle]
      .map((t) => t?.trim())
      .filter((t): t is string => Boolean(t)),
  )];
  if (!titles.length) return { tmdbId: 0 };

  const cacheKey = `${titles.join("\u0000")}\u0000${year ?? 0}`;
  const cached = animeTmdbCache.get(cacheKey);
  if (cached) {
    if (Date.now() < cached.expiresAt) return cached.match;
    animeTmdbCache.delete(cacheKey);
  }

  let match: AnimeTmdbMatch = { tmdbId: 0 };

  // 1) Titulo exacto con ano.
  outer: for (const title of titles) {
    for (const searchType of ["tv", "movie"] as const) {
      const hit = await trySearch(title, searchType, year);
      if (hit) {
        match = hit;
        break outer;
      }
    }
  }

  // 2) Titulo exacto sin ano.
  if (!match.tmdbId) {
    outer2: for (const title of titles) {
      for (const searchType of ["tv", "movie"] as const) {
        const hit = await trySearch(title, searchType);
        if (hit) {
          match = hit;
          break outer2;
        }
      }
    }
  }

  // 3) Titulo sin el sufijo de temporada ("Gintama: THE VERY FINAL" -> "Gintama").
  if (!match.tmdbId) {
    for (const title of titles) {
      const shortTitle = title.split(/[:\-–]/)[0].trim();
      if (shortTitle.length < 3 || shortTitle === title) continue;
      for (const searchType of ["tv", "movie"] as const) {
        const hit = await trySearch(shortTitle, searchType);
        if (hit) {
          match = hit;
          break;
        }
      }
      if (match.tmdbId) break;
    }
  }

  rememberAnimeMatch(cacheKey, match);
  return match;
}

const TMDB_CONCURRENCY = 3;

export function stripSeasonPattern(name: string): string | null {
  const cleaned = name.trim();
  const match = cleaned.match(/^(.*?)\s+(?:(?:Season|Part|Cour|Saga)\s+\d+|S\d{1,2}|\d+(?:st|nd|rd|th)\s+Season)\s*$/i);
  if (match && match[1].trim().length > 0) return match[1].trim();
  return null;
}

export async function resolveAnilistToTmdb(items: MediaItem[]): Promise<MediaItem[]> {
  const anilistItems = items.filter(
    (item): item is AnilistEnrichedItem =>
      item.id.startsWith("anilist:") && "_romaji" in item,
  ).slice(0, 40);
  if (!anilistItems.length) return items;

  const resolved = new Map<number, AnimeTmdbMatch>();
  const seasonBaseNames = new Map<number, string>();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < anilistItems.length) {
      const i = nextIndex++;
      const item = anilistItems[i];
      try {
        const baseName = stripSeasonPattern(item._romaji) ?? (item._english ? stripSeasonPattern(item._english) : null);
        if (baseName) {
          seasonBaseNames.set(item._anilistId, baseName);
          const tmdb = await searchTmdbAnime(undefined, baseName, item.year);
          if (tmdb && tmdb.tmdbId > 0) {
            resolved.set(item._anilistId, tmdb);
          }
        } else {
          const tmdb = await searchTmdbAnime(item._english, item._romaji, item.year);
          if (tmdb && tmdb.tmdbId > 0) {
            resolved.set(item._anilistId, tmdb);
          }
        }
      } catch {}
    }
  }

  await Promise.all(Array.from({ length: Math.min(TMDB_CONCURRENCY, anilistItems.length) }, worker));

  const seenTmdbIds = new Set<number>();
  const seenBaseKeys = new Set<string>();

  return items.reduce<MediaItem[]>((acc, item) => {
    if (!item.id.startsWith("anilist:")) {
      acc.push(item);
      return acc;
    }
    const enriched = item as AnilistEnrichedItem;
    const tmdb = resolved.get(enriched._anilistId);
    if (tmdb && tmdb.tmdbId > 0 && !seenTmdbIds.has(tmdb.tmdbId)) {
      seenTmdbIds.add(tmdb.tmdbId);
      const baseName = seasonBaseNames.get(enriched._anilistId);
      const finalName = baseName ?? item.name;
      const dedupKey = (stripSeasonPattern(finalName) ?? finalName).toLowerCase().trim();
      if (seenBaseKeys.has(dedupKey)) return acc;
      seenBaseKeys.add(dedupKey);
      acc.push({
        ...item,
        id: `tmdb:${tmdb.tmdbId}`,
        name: finalName,
        poster: tmdb.poster ?? item.poster,
        background: tmdb.background ?? item.background,
      });
    }
    return acc;
  }, []);
}
