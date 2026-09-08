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

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (now > entry.expiresAt) {
      responseCache.delete(key);
    }
  }
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
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data as T;
  }

  const { params: _params, ...fetchInit } = init ?? {};
  const response = await fetch(url.toString(), {
    ...fetchInit,
    headers: {
      "Accept": "application/json",
      ...fetchInit.headers,
    },
  });
  if (!response.ok) return null;
  try {
    const data = await response.json() as T;
    responseCache.set(cacheKey, { data, expiresAt: Date.now() + 300_000 });
    return data;
  } catch {
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
