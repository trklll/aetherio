import { getScopedStorageKey } from "../utils/localProfiles";

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
  return getApiKeys().tmdbApiKey;
}

function getApiKeysStorageKey() {
  return getScopedStorageKey(API_KEYS_STORAGE_KEY);
}
