import { getScopedStorageKey } from "../utils/localProfiles.ts";

/**
 * Las credenciales de servicio ya NO viajan en el cliente: sin key propia
 * del usuario, las llamadas TMDB/IntroDB salen por el proxy del servidor
 * (mismo origen que la API de cuentas), que inyecta la key del lado seguro.
 */
const AETHERIO_API_BASE = (import.meta.env.VITE_AETHERIO_API_URL as string | undefined)?.replace(/\/$/, "")
  ?? "https://trkll.aetherio.workers.dev";
const TMDB_PROXY_PREFIX = "/api/tmdb";

/** Key propia del usuario o "" (entonces se usa el proxy del servidor). */
export async function getTmdbApiKeyAsync(): Promise<string> {
  return getApiKeys().tmdbApiKey;
}

interface CacheEntry {
  data: any;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<any>>();

/** Una respuesta buena se puede reusar un rato: casi nada cambia en minutos. */
const SUCCESS_TTL_MS = 300_000;
/**
 * Un fallo de red o un 5xx no mejora por insistir. Cachearlo es lo que corta
 * la tormenta: sin esto, cada consumidor que reintenta vuelve a pedir lo
 * mismo y los 180 titulos de anime se multiplican por los reintentos de cada uno.
 */
const FAILURE_TTL_MS = 60_000;
/** 401/403: la credencial del proxy esta vencida o no esta puesta. Reintentar no la arregla. */
const AUTH_FAILURE_TTL_MS = 300_000;
/** 429: el upstream nos esta limitando. Margen extra para no reintentarle encima. */
const RATE_LIMIT_TTL_MS = 120_000;
/** Techo por peticion para que un fetch colgado no se quede ocupando un slot. */
const REQUEST_TIMEOUT_MS = 12_000;

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (now > entry.expiresAt) {
      responseCache.delete(key);
    }
  }
}

function failureTtlFor(status: number): number {
  if (status === 401 || status === 403) return AUTH_FAILURE_TTL_MS;
  if (status === 429) return RATE_LIMIT_TTL_MS;
  return FAILURE_TTL_MS;
}

/** Combina el signal del llamador con un techo de tiempo propio. */
function withTimeout(signal: AbortSignal | null | undefined, ms: number): AbortSignal | undefined {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const anyOf = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyOf === "function") return anyOf([signal, timeout]);
  return signal;
}

export interface ApiKeys {
  tmdbApiKey: string;
  introDbApiKey: string;
  animeSkipClientId: string;
  omdbApiKey: string;
}

export const API_KEYS_STORAGE_KEY = "aetherio-api-keys";
export const API_KEYS_CHANGED_EVENT = "aetherio-api-keys-changed";

export const EMPTY_API_KEYS: ApiKeys = {
  tmdbApiKey: "",
  introDbApiKey: "",
  animeSkipClientId: "",
  omdbApiKey: "",
};

// Token de TheIntroDB (theintrodb.org) para créditos de películas/series.
// Solo el que configure el usuario: el valor por defecto sale por el proxy
// del servidor para que ningún token viaje en el cliente.
export function getTheIntroDbToken(): string {
  return getApiKeys().introDbApiKey.trim();
}

/** Base del proxy IntroDB del servidor (inyecta el token del lado seguro). */
export function getIntroDbProxyBase(): string {
  return `${AETHERIO_API_BASE}/api/introdb`;
}

const TMDB_IMAGE_PROXY_PREFIX = "/api/tmdb-image";
const TMDB_IMAGE_PROXY_SIZE = /^(w92|w154|w185|w342|w500|w780|original)$/;
const TMDB_IMAGE_PROXY_FILE = /^[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i;

/**
 * URL de una imagen TMDB servida por el proxy del servidor (añade CORS para
 * poder muestrear píxeles en canvas). Devuelve null si no es una imagen TMDB
 * válida.
 */
export function getTmdbImageProxyUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  try {
    const parsed = new URL(imageUrl);
    if (parsed.hostname.toLowerCase() !== "image.tmdb.org") return null;
    const match = parsed.pathname.match(/^\/t\/p\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    const [, size, file] = match;
    if (!TMDB_IMAGE_PROXY_SIZE.test(size) || !TMDB_IMAGE_PROXY_FILE.test(file)) return null;
    return `${AETHERIO_API_BASE}${TMDB_IMAGE_PROXY_PREFIX}/${size}/${file}`;
  } catch {
    return null;
  }
}

export function getApiKeys(): ApiKeys {
  try {
    const raw = localStorage.getItem(getApiKeysStorageKey());
    if (!raw) return EMPTY_API_KEYS;
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return {
      tmdbApiKey: typeof parsed.tmdbApiKey === "string" ? parsed.tmdbApiKey.trim() : "",
      introDbApiKey: typeof parsed.introDbApiKey === "string" ? parsed.introDbApiKey.trim() : "",
      animeSkipClientId: typeof parsed.animeSkipClientId === "string" ? parsed.animeSkipClientId.trim() : "",
      omdbApiKey: typeof parsed.omdbApiKey === "string" ? parsed.omdbApiKey.trim() : "",
    };
  } catch {
    return EMPTY_API_KEYS;
  }
}

export function saveApiKeys(keys: ApiKeys) {
  const normalized: ApiKeys = {
    tmdbApiKey: keys.tmdbApiKey.trim(),
    introDbApiKey: keys.introDbApiKey.trim(),
    animeSkipClientId: keys.animeSkipClientId.trim(),
    omdbApiKey: keys.omdbApiKey.trim(),
  };
  localStorage.setItem(getApiKeysStorageKey(), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(API_KEYS_CHANGED_EVENT, { detail: normalized }));
}

export function getApiKeysForProfile(profileId: string): ApiKeys {
  try {
    const key = `aetherio-profile:${profileId}:${API_KEYS_STORAGE_KEY}`;
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_API_KEYS;
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return {
      tmdbApiKey: typeof parsed.tmdbApiKey === "string" ? parsed.tmdbApiKey.trim() : "",
      introDbApiKey: typeof parsed.introDbApiKey === "string" ? parsed.introDbApiKey.trim() : "",
      animeSkipClientId: typeof parsed.animeSkipClientId === "string" ? parsed.animeSkipClientId.trim() : "",
      omdbApiKey: typeof parsed.omdbApiKey === "string" ? parsed.omdbApiKey.trim() : "",
    };
  } catch {
    return EMPTY_API_KEYS;
  }
}

export function getTmdbApiKey() {
  return getApiKeys().tmdbApiKey;
}

const TMDB_BASE = "https://api.themoviedb.org/3";

export async function validateTmdbApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (!normalized) return false;
  try {
    const url = new URL(`${TMDB_BASE}/configuration`);
    url.searchParams.set("api_key", normalized);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    return response.ok;
  } catch {
    return false;
  }
}

export async function tmdbFetch<T = any>(path: string, init?: RequestInit & { params?: Record<string, string> }): Promise<T | null> {
  // Con key propia se va directo a TMDB; sin ella, por el proxy del servidor
  // (la key built-in ya no existe en el cliente).
  const userKey = getApiKeys().tmdbApiKey;
  let url: URL;
  if (userKey) {
    url = new URL(path.startsWith("http") ? path : `${TMDB_BASE}${path}`);
    url.searchParams.set("api_key", userKey);
  } else {
    const proxyPath = path.startsWith("http") ? tmdbProxyPathForUrl(path) : path;
    if (!proxyPath) return null;
    url = new URL(`${AETHERIO_API_BASE}${TMDB_PROXY_PREFIX}${proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`}`);
  }
  if (init?.params) {
    for (const [k, v] of Object.entries(init.params)) {
      url.searchParams.set(k, v);
    }
  }

  const cacheKey = `${path}?${url.search}`;
  cleanExpiredCache();
  const cached = responseCache.get(cacheKey);
  if (cached) {
    if (Date.now() < cached.expiresAt) return cached.data as T;
    responseCache.delete(cacheKey);
  }

  const { params: _params, ...fetchInit } = init ?? {};

  // Las peticiones con signal del llamador son cancelables (pantallas de
  // detalle). No se comparten: que uno aborte no debe tumbar a los demas.
  if (fetchInit.signal) {
    return requestTmdb<T>(url, fetchInit, cacheKey);
  }

  // Varias filas del Home piden los mismos titulos a la vez. Compartir la
  // peticion en vuelo hace que la segunda no vuelva a salir a la red.
  const pending = inFlight.get(cacheKey);
  if (pending) return pending as Promise<T | null>;

  const request = requestTmdb<T>(url, fetchInit, cacheKey).finally(() => {
    if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
  });
  inFlight.set(cacheKey, request);
  return request;
}

async function requestTmdb<T>(url: URL, fetchInit: RequestInit, cacheKey: string): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...fetchInit,
      signal: withTimeout(fetchInit.signal, REQUEST_TIMEOUT_MS),
      headers: {
        "Accept": "application/json",
        ...fetchInit.headers,
      },
    });
  } catch {
    responseCache.set(cacheKey, { data: null, expiresAt: Date.now() + FAILURE_TTL_MS });
    return null;
  }

  if (!response.ok) {
    // El proxy responde 429 con Retry-After cuando frena una rafaga. Respetarlo
    // evita que el cliente siga insistiendo y prolongue el bloqueo.
    const retryAfter = Number(response.headers.get("Retry-After"));
    const ttl = response.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, RATE_LIMIT_TTL_MS)
      : failureTtlFor(response.status);
    responseCache.set(cacheKey, { data: null, expiresAt: Date.now() + ttl });
    if (import.meta.env.DEV && (response.status === 401 || response.status === 403)) {
      console.warn(
        `[TMDB] ${response.status} en ${url.pathname}: la credencial de TMDB del proxy ` +
        `(${AETHERIO_API_BASE}) esta vencida o no esta configurada. ` +
        `Se cachea el fallo ${AUTH_FAILURE_TTL_MS / 1000}s para no insistir.`,
      );
    }
    return null;
  }

  try {
    const data = await response.json() as T;
    responseCache.set(cacheKey, { data, expiresAt: Date.now() + SUCCESS_TTL_MS });
    return data;
  } catch {
    responseCache.set(cacheKey, { data: null, expiresAt: Date.now() + FAILURE_TTL_MS });
    return null;
  }
}

function getApiKeysStorageKey() {
  return getScopedStorageKey(API_KEYS_STORAGE_KEY);
}

/** De una URL TMDB absoluta, solo la ruta (el proxy solo acepta TMDB). */
function tmdbProxyPathForUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== "api.themoviedb.org") return null;
    const basePath = "/3";
    const pathname = parsed.pathname.startsWith(basePath)
      ? parsed.pathname.slice(basePath.length) || "/"
      : parsed.pathname;
    return pathname;
  } catch {
    return null;
  }
}
