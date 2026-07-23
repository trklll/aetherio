import { getScopedStorageKey } from "../utils/localProfiles";

let _builtinTmdbKey: string | undefined;

export async function initBuiltinTmdbKey(): Promise<void> {
  if (_builtinTmdbKey !== undefined) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    _builtinTmdbKey = await invoke<string>("get_builtin_tmdb_key");
  } catch {
    _builtinTmdbKey = "";
  }
}

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

class SimpleRateLimiter {
  private requests: Map<string, number[]> = new Map();
  private cache: Map<string, CacheEntry> = new Map();

  private cleanExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  async checkLimit(identifier: string, limit: number, windowMs: number): Promise<boolean> {
    if (limit <= 0) return true;

    const now = Date.now();
    const windowStart = now - windowMs;

    let requests = this.requests.get(identifier) || [];
    requests = requests.filter(time => time > windowStart);

    if (requests.length >= limit) {
      return false;
    }

    requests.push(now);
    this.requests.set(identifier, requests);

    return true;
  }

  async getFromCache(key: string): Promise<any> {
    this.cleanExpiredCache();
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  async setCache(key: string, data: any, ttlSeconds: number): Promise<void> {
    const ttlMs = ttlSeconds * 1000;
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, timestamp: Date.now(), expiresAt });
  }
}

export function isTmdbReady() {
  return Boolean(_builtinTmdbKey);
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

const rateLimiter = new SimpleRateLimiter();

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
    introDbApiKey: keys.introDbApiKey.trim(),
    animeSkipClientId: keys.animeSkipClientId.trim(),
    tmdbApiKey: "",
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
  if (_builtinTmdbKey) return _builtinTmdbKey;
  return "";
}

const TMDB_BASE = "https://api.themoviedb.org/3";

export async function tmdbFetch<T = any>(path: string, init?: RequestInit & { params?: Record<string, string> }): Promise<T | null> {
  const key = getTmdbApiKey();
  if (!key) return null;

  const now = Date.now();
  const url = new URL(path.startsWith("http") ? path : `${TMDB_BASE}${path}`);

  if (init?.params) {
    for (const [k, v] of Object.entries(init.params)) {
      url.searchParams.set(k, v);
    }
  }

  const cacheKey = `${path}?${url.search}`;

  const cacheEntry = await rateLimiter.getFromCache(cacheKey);
  if (cacheEntry) {
    return cacheEntry as T;
  }

  const ip = "default";
  const rateLimitCheck = await rateLimiter.checkLimit(`tmdb_${ip}`, 60, 60000);
  if (!rateLimitCheck) {
    console.warn("TMDB rate limit exceeded");
    return null;
  }

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      "Accept": "application/json",
      ...init?.headers,
    },
  });

  if (response.status === 429) {
    console.warn("TMDB rate limit exceeded (HTTP 429)");
    await rateLimiter.setCache(cacheKey, null, 300);
    return null;
  }

  if (response.status === 401) {
    console.error("TMDB API key invalid");
    return null;
  }

  if (!response.ok) {
    console.error(`TMDB API error: ${response.status}`);
    return null;
  }

  try {
    const data = await response.json() as T;

    await rateLimiter.setCache(cacheKey, data, 300);

    return data;
  } catch (error) {
    console.error("TMDB response parsing error:", error);
    return null;
  }
}

function getApiKeysStorageKey() {
  return getScopedStorageKey(API_KEYS_STORAGE_KEY);
}

