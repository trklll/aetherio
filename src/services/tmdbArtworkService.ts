import { tmdbFetch } from "../config/apiKeys.ts";
import { pickPreferredTmdbBackdrop, tmdbImage } from "../utils/tmdbArtwork.ts";

/**
 * Resolucion de arte (poster, logo, fondo, overview) de un id de TMDB.
 *
 * Este modulo existe por una sola razon: las peticiones se contaban mal y el
 * proxy del servidor respondia 429. Antes cada consumidor repetia su propia
 * version de la misma consulta y las tres paginas que coexisten en el arranque
 * en frio (Home, Detalle, Continue Viendo) lo hacian por separado.
 *
 * Tres correcciones, todas en el mismo sitio:
 *
 * 1. Una peticion, no dos. El detalle y el bloque de imagenes se piden con
 *    `append_to_response=images` en una sola llamada. Antes eran
 *    `/{type}/{id}` + `/{type}/{id}/images`: el doble de trafico para obtener
 *    exactamente los mismos campos.
 *
 * 2. El namespacemovie/tv se resuelve una vez y se recuerda. TMDB comparte el
 *    espacio de ids entre movie y tv, asi que un id de serie que en realidad
 *    es de pelicula hay que buscarlo en el otro namespace. Antes ese sondeo
 *    se repetia en cada consumidor y en cada arranque; ahora un id que ya se
 *    sabe muerto en un namespace no se vuelve a preguntar en la sesion.
 *
 * 3. Cache propia por id, con deduplicacion de peticiones en vuelo. Aunque
 *    `tmdbFetch` ya comparte peticiones identicas, la cache por id es la que
 *    hace que Home, Detalle y Continue Viendo noRepitan el trabajo del otro:
 *    antes las tres paginas podian pedir el mismo id en el mismo segundo y cada
 *    una se comia su propia cuota del proxy.
 *
 * El cache es de sesion y en memoria a proposito: la cache que sobrevive al
 * arranque es la del borde del Worker, y esta solo tiene que evitar el
 * trabajo repetido dentro de la misma sesion.
 */

const ARTWORK_TTL_MS = 5 * 60_000;
/** Un id que no existe no va a aparecer en TMDB durante la sesion. */
const MISSING_TTL_MS = 10 * 60_000;

export interface TmdbArtwork {
  /** Namespace en el que TMDB tiene realmente el id. */
  type: "movie" | "tv";
  id: number;
  /** Payload crudo, por si el llamador necesita genres, runtime, etc. */
  raw: any;
  /** Logo ya elegido por prioridad de idioma y con URL puesta. */
  logo?: string;
  /** Fondo ya elegido por encuadre y con URL puesta. */
  backdrop?: string;
  posterPath?: string;
  backdropPath?: string;
  logoPath?: string;
  title?: string;
  description?: string;
  year?: string;
  /**
   * La entrada es anime/animacion. Un id asi NO tiene sentido buscarse como
   * pelicula: los catalogos de anime entregan una serie y el sondeo contrario
   * gastaba una peticion por titulo en cada arranque en frio.
   */
  isAnimation: boolean;
}

interface CacheEntry {
  value: TmdbArtwork | null;
  expiresAt: number;
}

/** Resolucion ya calculada, por namespace pedido. */
const artworkCache = new Map<string, CacheEntry>();
/** Peticiones en vuelo, por namespace pedido: no se duplica trabajo concurrente. */
const inFlight = new Map<string, Promise<TmdbArtwork | null>>();
/**
 * Namespaces ya descartados para un id ("tv:57775"). Un id que no esta en tv
 * no se vuelve a preguntar en tv durante la sesion: por eso el coste del
 * namespace alterno es una sola vez por id, no una vez por consumidor.
 */
const deadNamespaces = new Set<string>();

function cacheKey(type: "movie" | "tv", id: number) {
  return `${type}:${id}`;
}

function isAnimationEntry(raw: any) {
  const genreIds = (raw?.genres ?? []).map((genre: any) => Number(genre?.id));
  return raw?.original_language === "ja" || genreIds.includes(16);
}

function yearFrom(value: unknown) {
  const year = String(value ?? "").slice(0, 4);
  return /^\d{4}$/.test(year) ? year : undefined;
}

/** Prioridad de idioma del logo: español, ingles, sin idioma, y el primero. */
function pickLogoPath(images: any) {
  const logos = Array.isArray(images?.logos) ? images.logos : [];
  return (logos.find((item: any) => item?.iso_639_1 === "es")
    ?? logos.find((item: any) => item?.iso_639_1 === "en")
    ?? logos.find((item: any) => item?.iso_639_1 == null)
    ?? logos[0])?.file_path;
}

function toArtwork(
  id: number,
  raw: any,
  actualType: "movie" | "tv",
  fallbackBackdropPath?: string | null,
): TmdbArtwork {
  return {
    type: actualType,
    id,
    raw,
    logo: tmdbImage(pickLogoPath(raw?.images), "original"),
    backdrop: pickPreferredTmdbBackdrop(raw?.images?.backdrops, fallbackBackdropPath),
    posterPath: raw?.poster_path,
    backdropPath: raw?.backdrop_path,
    logoPath: pickLogoPath(raw?.images),
    title: raw?.name ?? raw?.title,
    description: raw?.overview,
    year: yearFrom(raw?.first_air_date ?? raw?.release_date),
    isAnimation: isAnimationEntry(raw),
  };
}

/**
 * Detalle + imagenes en una sola peticion. `append_to_response` hereda los
 * parametros de la peticion padre, asi que `include_image_language` tambien
 * aplica al sub-recurso `images`.
 */
function requestDetail(type: "movie" | "tv", id: number) {
  return tmdbFetch<any>(`/${type}/${id}`, {
    params: {
      language: "es-ES",
      append_to_response: "images",
      include_image_language: "es,en,null",
    },
  });
}

function remember(type: "movie" | "tv", id: number, value: TmdbArtwork | null, ttlMs: number) {
  artworkCache.set(cacheKey(type, id), { value, expiresAt: Date.now() + ttlMs });
}

/** Limpia el estado del modulo. Pensado para tests. */
export function resetTmdbArtworkCache() {
  artworkCache.clear();
  inFlight.clear();
  deadNamespaces.clear();
}

async function resolve(type: "movie" | "tv", id: number): Promise<TmdbArtwork | null> {
  const payload = deadNamespaces.has(cacheKey(type, id)) ? null : await requestDetail(type, id);
  if (payload) return toArtwork(id, payload, type);

  // Movie no tiene namespace alterno: si no esta, no esta.
  if (type === "tv") {
    // Este id ya no es una serie. No se vuelve a preguntar en tv.
    deadNamespaces.add(cacheKey("tv", id));
    if (!deadNamespaces.has(cacheKey("movie", id))) {
      const asMovie = await requestDetail("movie", id);
      if (asMovie) {
        // Se guarda tambien bajo el namespace pedido: Home y Detalle pueden
        // haber llegado con "tv" y con "movie" y no se deben repetir el trabajo.
        const artwork = toArtwork(id, asMovie, "movie");
        remember("movie", id, artwork, ARTWORK_TTL_MS);
        return artwork;
      }
      deadNamespaces.add(cacheKey("movie", id));
    }
  }
  return null;
}

/**
 * Arte de un id de TMDB, o null si no existe en movie ni en tv.
 *
 * Nunca lanza: un id que no se encuentra es un resultado valido, no un error
 * (los catalogos de anime entregan ids que TMDB no conoce).
 */
export function fetchTmdbArtwork(
  type: "movie" | "tv",
  id: number,
  fallbackBackdropPath?: string | null,
): Promise<TmdbArtwork | null> {
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
  const key = cacheKey(type, id);
  const cached = artworkCache.get(key);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      const value = cached.value;
      if (!value) return Promise.resolve(null);
      return Promise.resolve(
        fallbackBackdropPath && !value.backdrop
          ? { ...value, backdrop: pickPreferredTmdbBackdrop(value.raw?.images?.backdrops, fallbackBackdropPath) }
          : value,
      );
    }
    artworkCache.delete(key);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = resolve(type, id)
    .then(artwork => {
      remember(type, id, artwork, artwork ? ARTWORK_TTL_MS : MISSING_TTL_MS);
      return artwork;
    })
    .catch(() => {
      remember(type, id, null, MISSING_TTL_MS);
      return null;
    })
    .finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}
