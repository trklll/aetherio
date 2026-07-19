import { getScopedStorageKey } from "../utils/localProfiles";

const APP_TMDB_API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() ?? "";

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

export function getTmdbApiKey() {
  return getApiKeys().tmdbApiKey || APP_TMDB_API_KEY;
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
  const key = getTmdbApiKey();
  if (!key) return null;
  const url = new URL(path.startsWith("http") ? path : `${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", key);
  if (init?.params) {
    for (const [k, v] of Object.entries(init.params)) {
      url.searchParams.set(k, v);
    }
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
  return response.json() as Promise<T>;
}

function getApiKeysStorageKey() {
  return getScopedStorageKey(API_KEYS_STORAGE_KEY);
}
