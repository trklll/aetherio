import { sanitizeLogoUrl } from "./artwork";
import type { MdbListRatings } from "../config/mdblist";
import { getScopedStorageKey } from "./localProfiles";

const DETAIL_MEDIA_META_KEY = "aetherio-detail-media-meta-v1";
const DETAIL_BACKGROUND_OVERRIDE_KEY = "aetherio-detail-background-override-v1";
const DETAIL_LOGO_OVERRIDE_KEY = "aetherio-detail-logo-override-v1";

export interface MediaMetadataSeed {
  id: string;
  type: string;
  name?: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  year?: number;
  source?: string;
  sourceName?: string;
  mdbListRatings?: MdbListRatings;
  updatedAt?: number;
}

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function localStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function entryKey(type: string, id: string) {
  return `${type}:${id}`;
}

function readMap(): Record<string, MediaMetadataSeed> {
  if (!storageAvailable()) return {};
  try {
    const raw = window.sessionStorage.getItem(DETAIL_MEDIA_META_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, MediaMetadataSeed>) {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.setItem(DETAIL_MEDIA_META_KEY, JSON.stringify(map));
  } catch {
    // Artwork cache is best-effort.
  }
}

function parseYear(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : undefined;
}

export function readDetailMediaMeta(type?: string, id?: string) {
  if (!type || !id) return undefined;
  return readMap()[entryKey(type, id)];
}

export function writeDetailMediaMeta(seed: MediaMetadataSeed) {
  if (!seed.type || !seed.id) return;
  const map = readMap();
  const key = entryKey(seed.type, seed.id);
  const cleanSeed: MediaMetadataSeed = {
    id: seed.id,
    type: seed.type,
    name: seed.name,
    poster: seed.poster,
    background: seed.background,
    logo: seed.logo,
    description: seed.description,
    year: seed.year,
    source: seed.source,
    sourceName: seed.sourceName,
  };
  map[key] = {
    ...map[key],
    ...cleanSeed,
    logo: sanitizeLogoUrl(seed.logo) ?? map[key]?.logo,
    mdbListRatings: seed.mdbListRatings ?? map[key]?.mdbListRatings,
    updatedAt: Date.now(),
  };
  writeMap(map);
}

export function readDetailBackgroundOverride(type?: string, id?: string) {
  if (!type || !id || !localStorageAvailable()) return undefined;
  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(DETAIL_BACKGROUND_OVERRIDE_KEY));
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, string>;
    return map[entryKey(type, id)];
  } catch {
    return undefined;
  }
}

export function writeDetailBackgroundOverride(type: string, id: string, background: string) {
  if (!localStorageAvailable()) return;
  try {
    const storageKey = getScopedStorageKey(DETAIL_BACKGROUND_OVERRIDE_KEY);
    const raw = window.localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) as Record<string, string> : {};
    map[entryKey(type, id)] = background;
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // User-selected backgrounds are best-effort.
  }
}

export function readDetailLogoOverride(type?: string, id?: string) {
  if (!type || !id || !localStorageAvailable()) return undefined;
  try {
    const raw = window.localStorage.getItem(getScopedStorageKey(DETAIL_LOGO_OVERRIDE_KEY));
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, string>;
    const key = entryKey(type, id);
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  } catch {
    return undefined;
  }
}

export function writeDetailLogoOverride(type: string, id: string, logo: string) {
  if (!localStorageAvailable()) return;
  try {
    const storageKey = getScopedStorageKey(DETAIL_LOGO_OVERRIDE_KEY);
    const raw = window.localStorage.getItem(storageKey);
    const map = raw ? JSON.parse(raw) as Record<string, string> : {};
    map[entryKey(type, id)] = sanitizeLogoUrl(logo) ?? "";
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // User-selected logos are best-effort.
  }
}

export function resolveDetailBackground(type?: string, id?: string, fallback?: string) {
  return readDetailBackgroundOverride(type, id) ?? fallback;
}

export function normalizeAddonMediaMeta(raw: any, fallbackType?: string, sourceName?: string): MediaMetadataSeed | null {
  const id = String(raw?.id ?? "").trim();
  if (!id) return null;
  const type = String(raw?.type ?? fallbackType ?? "").trim();
  if (!type) return null;
  const normalizedType = type === "tv" ? "series" : type;
  return {
    id,
    type: normalizedType,
    name: raw?.name ?? raw?.title,
    poster: raw?.poster,
    background: raw?.background ?? raw?.backdrop,
    logo: sanitizeLogoUrl(raw?.logo),
    description: raw?.description ?? raw?.overview,
    year: parseYear(raw?.year ?? raw?.releaseInfo ?? raw?.released),
    source: "addon",
    sourceName,
  };
}
