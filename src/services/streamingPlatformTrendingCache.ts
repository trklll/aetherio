import type { CatalogRowData } from "../types/ui";

const STORAGE_KEY = "aetherio-streaming-platform-trending-cache-v1";
const CACHE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_CACHE_AGE_MS = 7 * DAY_MS;
const MAX_CACHE_ENTRIES = 144;
const MAX_STORAGE_CHARS = 1_200_000;

export const STREAMING_TRENDING_STALE_TIME_MS = 6 * 60 * 60 * 1_000;
export const STREAMING_TRENDING_GC_TIME_MS = MAX_CACHE_AGE_MS;

export interface StreamingPlatformTrendingCacheEntry {
  rows: CatalogRowData[];
  updatedAt: number;
}

interface StoredCache {
  version: number;
  entries: Record<string, StreamingPlatformTrendingCacheEntry>;
}

function getStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function cacheEntryKey(platformId: string, genreKey?: string) {
  return JSON.stringify([platformId, genreKey ?? ""]);
}

function isRows(value: unknown): value is CatalogRowData[] {
  return Array.isArray(value) && value.every(row =>
    row !== null
    && typeof row === "object"
    && typeof row.catalogId === "string"
    && Array.isArray(row.items),
  );
}

function readStoredCache(): StoredCache {
  const storage = getStorage();
  if (!storage) return { version: CACHE_VERSION, entries: {} };

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: CACHE_VERSION, entries: {} };
    const parsed = JSON.parse(raw) as Partial<StoredCache>;
    if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: CACHE_VERSION, entries: {} };
    }

    const now = Date.now();
    const entries = Object.fromEntries(Object.entries(parsed.entries).filter(([, entry]) =>
      Boolean(entry)
      && Number.isFinite(entry.updatedAt)
      && entry.updatedAt <= now + 60_000
      && now - entry.updatedAt <= MAX_CACHE_AGE_MS
      && isRows(entry.rows),
    ));
    return { version: CACHE_VERSION, entries };
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

export function readStreamingPlatformTrendingCache(
  platformId: string,
  genreKey?: string,
): StreamingPlatformTrendingCacheEntry | undefined {
  const key = cacheEntryKey(platformId, genreKey);
  return readStoredCache().entries[key];
}

export function writeStreamingPlatformTrendingCache(
  platformId: string,
  genreKey: string | undefined,
  rows: CatalogRowData[],
) {
  const storage = getStorage();
  if (!storage || !isRows(rows)) return;

  const entries = readStoredCache().entries;
  entries[cacheEntryKey(platformId, genreKey)] = { rows, updatedAt: Date.now() };

  const oldestFirst = Object.entries(entries).sort(([, first], [, second]) => first.updatedAt - second.updatedAt);
  let serialized = JSON.stringify({ version: CACHE_VERSION, entries });
  while (
    oldestFirst.length > MAX_CACHE_ENTRIES
    || serialized.length > MAX_STORAGE_CHARS
  ) {
    const oldest = oldestFirst.shift();
    if (!oldest) return;
    delete entries[oldest[0]];
    serialized = JSON.stringify({ version: CACHE_VERSION, entries });
  }

  try {
    storage.setItem(STORAGE_KEY, serialized);
  } catch {
    // El almacenamiento persistente es opcional: no debe bloquear la carga.
  }
}
