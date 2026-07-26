const DEFAULT_PAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const MAX_PAGE_CACHE_ENTRIES = 120;

interface PageCacheEntry {
  value: unknown;
  updatedAt: number;
}

const pageDataCache = new Map<string, PageCacheEntry>();

export function readPageDataCache<T>(
  namespace: string,
  key: string,
  maxAgeMs = DEFAULT_PAGE_CACHE_TTL_MS,
): T | null {
  if (!key) return null;
  const cacheKey = `${namespace}:${key}`;
  const entry = pageDataCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt >= maxAgeMs) {
    pageDataCache.delete(cacheKey);
    return null;
  }

  // Refresh insertion order so frequently revisited pages remain in memory.
  pageDataCache.delete(cacheKey);
  pageDataCache.set(cacheKey, entry);
  return entry.value as T;
}

export function writePageDataCache<T>(namespace: string, key: string, value: T) {
  if (!key) return value;
  const cacheKey = `${namespace}:${key}`;
  pageDataCache.delete(cacheKey);
  pageDataCache.set(cacheKey, { value, updatedAt: Date.now() });

  while (pageDataCache.size > MAX_PAGE_CACHE_ENTRIES) {
    const oldestKey = pageDataCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    pageDataCache.delete(oldestKey);
  }
  return value;
}

export function deletePageDataCache(namespace: string, key: string) {
  if (key) pageDataCache.delete(`${namespace}:${key}`);
}
