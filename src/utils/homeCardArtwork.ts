import { getScopedStorageKey, LOCAL_PROFILES_CHANGED_EVENT } from "./localProfiles";

export type HomeCardArtworkMode = "background" | "poster" | "logo";

const HOME_CARD_ARTWORK_KEY = "aetherio-home-card-artwork-v1";
export const HOME_CARD_ARTWORK_CHANGED_EVENT = "aetherio-home-card-artwork-changed";

function artworkKey(mode: HomeCardArtworkMode, type: string, id: string) {
  const normalizedType = type === "tv" ? "series" : type;
  return `${mode}:${normalizedType}:${id}`;
}

function readArtworkMap() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return {};
  if (artworkMapCache !== null) return artworkMapCache;
  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(HOME_CARD_ARTWORK_KEY));
    artworkMapCache = raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    artworkMapCache = {};
  }
  return artworkMapCache;
}

let artworkMapCache: Record<string, string> | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === getScopedStorageKey(HOME_CARD_ARTWORK_KEY)) artworkMapCache = null;
  });
  window.addEventListener(HOME_CARD_ARTWORK_CHANGED_EVENT, () => {
    artworkMapCache = null;
  });
  window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, () => {
    artworkMapCache = null;
  });
}

export function readHomeCardArtwork(
  mode: HomeCardArtworkMode,
  type: string,
  id: string,
  fallback?: string,
) {
  return readArtworkMap()[artworkKey(mode, type, id)] ?? fallback;
}

export function writeHomeCardArtwork(
  mode: HomeCardArtworkMode,
  type: string,
  id: string,
  url: string,
) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    const storageKey = getScopedStorageKey(HOME_CARD_ARTWORK_KEY);
    const map = readArtworkMap();
    map[artworkKey(mode, type, id)] = url;
    window.localStorage.setItem(storageKey, JSON.stringify(map));
    artworkMapCache = map;
    window.dispatchEvent(new CustomEvent(HOME_CARD_ARTWORK_CHANGED_EVENT, {
      detail: { mode, type, id, url },
    }));
  } catch {
    // User-selected card artwork is best-effort.
  }
}
