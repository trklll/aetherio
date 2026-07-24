import { getScopedStorageKey } from "../utils/localProfiles.ts";
import { invoke } from "@tauri-apps/api/core";

const APP_TMDB_API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() ?? "";

let _builtinTmdbKey = "";
let _tmdbKeyPromise: Promise<string> | null = null;

export function initBuiltinTmdbKey(): Promise<string> {
  if (_tmdbKeyPromise) return _tmdbKeyPromise;
  _tmdbKeyPromise = (async () => {
    try {
      _builtinTmdbKey = await invoke<string>("get_builtin_tmdb_key");
    } catch {
      _builtinTmdbKey = "";
    }
    return _builtinTmdbKey;
  })();
  return _tmdbKeyPromise;
}

export async function getTmdbApiKeyAsync(): Promise<string> {
  const userKey = getApiKeys().tmdbApiKey;
  if (userKey) return userKey;
  if (_builtinTmdbKey) return _builtinTmdbKey;
  if (_tmdbKeyPromise) return _tmdbKeyPromise;
  return initBuiltinTmdbKey();
}

export function isTmdbReady() {
  return Boolean(getApiKeys().tmdbApiKey || _builtinTmdbKey || APP_TMDB_API_KEY);
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
}

export const API_KEYS_STORAGE_KEY = "aetherio-api-keys";
export const API_KEYS_CHANGED_EVENT = "aetherio-api-keys-changed";

export const EMPTY_API_KEYS: ApiKeys = {
  tmdbApiKey: "",
  introDbApiKey: "",
  animeSkipClientId: "",
};

export function getApiKeys(): ApiKeys {
  try {
    const raw = localStorage.getItem(getApiKeysStorageKey());
    if (!raw) return EMPTY_API_KEYS;
    const parsed = JSON.parse(raw) as Partial<ApiKeys>;
    return {
      tmdbApiKey: typeof parsed.tmdbApiKey === "string" ? parsed.tmdbApiKey.trim() : "",
      introDbApiKey: typeof parsed.introDbApiKey === "string" ? parsed.introDbApiKey.trim() : "",
      animeSkipClientId: typeof parsed.animeSkipClientId === "string" ? parsed.animeSkipClientId.trim() : "",
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
    };
  } catch {
    return EMPTY_API_KEYS;
  }
}

export function getTmdbApiKey() {
  return getApiKeys().tmdbApiKey || _builtinTmdbKey || APP_TMDB_API_KEY;
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
  const key = await getTmdbApiKeyAsync();
  if (!key) return null;
  const url = new URL(path.startsWith("http") ? path : `${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
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
