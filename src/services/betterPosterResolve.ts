import { tmdbFetch } from "../config/apiKeys.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

/**
 * Resuelve el IMDb id (`tt...`) de un item TMDB a través del endpoint meta de
 * btttr.cc, que acepta ids `tmdb:` y devuelve `behaviorHints.defaultVideoId`.
 *
 * - Caché persistente (los ids IMDb no cambian) → tras la primera carga no hay
 *   más peticiones.
 * - Cola con concurrencia limitada (4) + deduplicación de vuelos para no
 *   saturar el servicio gratuito en el primer arranque.
 */

export type BetterMetaType = "movie" | "series";

const CACHE_KEY = "aetherio-bp-tmdb2imdb-v1";
const MAX_CONCURRENT = 6;
const FETCH_TIMEOUT_MS = 12_000;
// Tiempo máximo que una tarea puede retener un slot del limitador, aunque el
// fetch subyacente se quede colgado (evita atascos permanentes de la cola).
const TASK_SETTLE_TIMEOUT_MS = 20_000;
const TMDB_RESOLVE_TIMEOUT_MS = 8_000;

let memoryCache: Record<string, string> | null = null;
const negativeMemory = new Set<string>();
const inFlight = new Map<string, Promise<string | null>>();
const queue: Array<() => void> = [];
let active = 0;

export function betterMetaTypeFor(mediaType: string): BetterMetaType {
  return mediaType.toLowerCase() === "movie" ? "movie" : "series";
}

/** `tmdb:123` → 123. Devuelve null si no es un id TMDB. */
export function parseTmdbId(id?: string | null): number | null {
  if (!id) return null;
  const match = id.match(/^tmdb:(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function cacheKeyFor(type: BetterMetaType, tmdbId: number): string {
  return `${type}:${tmdbId}`;
}

function readCache(): Record<string, string> {
  if (memoryCache) return memoryCache;
  try {
    const storageKey = getScopedStorageKey(CACHE_KEY);
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) : null;
    memoryCache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

/** Lectura síncrona (caché en memoria/persistente) sin red. */
export function readCachedImdb(type: BetterMetaType, tmdbId: number): string | null {
  return readCache()[cacheKeyFor(type, tmdbId)] ?? null;
}

function writeCachedImdb(type: BetterMetaType, tmdbId: number, imdbId: string) {
  const cache = readCache();
  const key = cacheKeyFor(type, tmdbId);
  if (cache[key] === imdbId) return;
  cache[key] = imdbId;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(getScopedStorageKey(CACHE_KEY), JSON.stringify(cache));
    }
  } catch { /* best-effort */ }
}

function drain() {
  while (active < MAX_CONCURRENT && queue.length) {
    queue.shift()?.();
  }
}

/**
 * Resuelve `tt...` para un TMDB id. Devuelve null si btttr.cc no lo conoce o
 * falla la red (el llamador debe mantener el póster original).
 */
export function resolveTmdbToImdb(type: BetterMetaType, tmdbId: number): Promise<string | null> {
  const key = cacheKeyFor(type, tmdbId);
  const cached = readCache()[key];
  if (cached) return Promise.resolve(cached);
  if (negativeMemory.has(key)) return Promise.resolve(null);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = new Promise<string | null>(resolve => {
    const run = () => {
      active += 1;
      const pending = resolveImdbId(type, tmdbId);
      // Aunque se agote el presupuesto, un resultado tardío se guarda en caché.
      void pending.then(result => {
        if (result) writeCachedImdb(type, tmdbId, result);
      }).catch(() => {});
      void Promise.race([pending, delay(TASK_SETTLE_TIMEOUT_MS).then(() => null)])
        .then(result => {
          if (result) writeCachedImdb(type, tmdbId, result);
          else negativeMemory.add(key);
          resolve(result);
        })
        .catch(() => {
          negativeMemory.add(key);
          resolve(null);
        })
        .finally(() => {
          active -= 1;
          inFlight.delete(key);
          drain();
        });
    };
    queue.push(run);
    drain();
  });
  inFlight.set(key, task);
  return task;
}

function delay(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error("resolve-timeout")), ms);
  });
}

/**
 * Cadena de resolución: TMDB external_ids (rápido, ligero) y, si falla,
 * meta de btttr.cc como respaldo.
 */
async function resolveImdbId(type: BetterMetaType, tmdbId: number): Promise<string | null> {
  const viaTmdb = await fetchTmdbExternalImdb(type, tmdbId).catch(() => null);
  if (viaTmdb) return viaTmdb;
  return fetchMetaImdb(type, tmdbId);
}

function tmdbTypeFor(type: BetterMetaType): "movie" | "tv" {
  return type === "movie" ? "movie" : "tv";
}

async function fetchTmdbExternalImdb(type: BetterMetaType, tmdbId: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TMDB_RESOLVE_TIMEOUT_MS);
  try {
    const data = await tmdbFetch<any>(`/${tmdbTypeFor(type)}/${tmdbId}/external_ids`, { signal: controller.signal });
    const imdb = typeof data?.imdb_id === "string" ? data.imdb_id.match(/tt\d+/i)?.[0] ?? null : null;
    return imdb;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchMetaImdb(type: BetterMetaType, tmdbId: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://btttr.cc/meta/${type}/tmdb:${tmdbId}.json`,
      { signal: controller.signal },
    );
    if (!response.ok) return null;
    const data = await response.json() as any;
    return extractImdbFromMeta(data?.meta);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Extrae tt... del meta de btttr: los metas de series no traen
 * behaviorHints.defaultVideoId, pero sí videos ("tt...:temporada:episodio")
 * o enlace IMDb.
 */
function extractImdbFromMeta(meta: any): string | null {
  const fromHints = typeof meta?.behaviorHints?.defaultVideoId === "string"
    ? meta.behaviorHints.defaultVideoId.match(/tt\d+/i)?.[0] ?? null
    : null;
  if (fromHints) return fromHints;
  const metaId = typeof meta?.id === "string" ? meta.id.match(/tt\d+/i)?.[0] ?? null : null;
  if (metaId) return metaId;
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  for (const video of videos) {
    const id = typeof video?.id === "string" ? video.id.match(/tt\d+/i)?.[0] ?? null : null;
    if (id) return id;
  }
  const links = Array.isArray(meta?.links) ? meta.links : [];
  for (const link of links) {
    const url = typeof link?.url === "string" ? link.url : "";
    const imdb = url.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] ?? url.match(/tt\d+/i)?.[0] ?? null;
    if (imdb && /imdb/i.test(url)) return imdb;
  }
  return null;
}
