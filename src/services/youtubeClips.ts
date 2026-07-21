import { tmdbFetch } from "../config/apiKeys";
import type { MediaItem, TrailerSource } from "../types/ui";

interface CacheEntry {
  videoId: string;
  source: TrailerSource;
  duration: number;
  fetchedAt: number;
}

const CACHE_KEY = "aetherio-youtube-clips";
const CACHE_TTL = 1000 * 60 * 60 * 24;

interface ChannelConfig {
  query: string;
  source: TrailerSource;
  skipEnd: number;
}

const ANIME_CHANNELS: ChannelConfig[] = [
  { query: "@netflixanime", source: "netflix", skipEnd: 12 },
  { query: "@CrunchyrollenEspañol", source: "crunchyroll", skipEnd: 20 },
  { query: "@HBOMaxLa", source: "hbo", skipEnd: 0 },
  { query: "@disneyplusla", source: "disney", skipEnd: 15 },
];

const INVidIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://yewtu.be",
  "https://invidious.snopyta.org",
];

function getCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function setCache(id: string, entry: CacheEntry) {
  try {
    const cache = getCache();
    cache[id] = entry;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getCached(id: string): CacheEntry | null {
  const cache = getCache();
  const entry = cache[id];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    delete cache[id];
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
    return null;
  }
  return entry;
}

async function searchInvidious(query: string): Promise<string | null> {
  for (const instance of INVidIOUS_INSTANCES) {
    try {
      const url = `${instance}/api/v1/search?type=video&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0 && data[0].videoId) {
        return data[0].videoId;
      }
    } catch {}
  }
  return null;
}

async function searchYouTubeHtml(query: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept-Language": "es-ES,es;q=0.9" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function searchYouTube(query: string): Promise<string | null> {
  const fromInvidious = await searchInvidious(query);
  if (fromInvidious) return fromInvidious;
  const fromHtml = await searchYouTubeHtml(query);
  return fromHtml;
}

async function searchTmdbVideos(tmdbType: "movie" | "tv", tmdbId: number): Promise<{ videoId: string; source: TrailerSource } | null> {
  try {
    const data = await tmdbFetch<{ results: Array<{ key: string; site: string; type: string; official: boolean }> }>(
      `/${tmdbType}/${tmdbId}/videos`,
      { params: { language: "es-ES,en-US" } },
    );
    if (!data?.results?.length) return null;
    const clips = data.results.filter(v => v.site === "YouTube" && (v.type === "Clip" || v.type === "Scene"));
    if (clips.length > 0) return { videoId: clips[0].key, source: "youtube" };
    const trailers = data.results.filter(v => v.site === "YouTube" && v.type === "Trailer" && v.official);
    if (trailers.length > 0) return { videoId: trailers[0].key, source: "tmdb" };
    const anyVideo = data.results.find(v => v.site === "YouTube");
    if (anyVideo) return { videoId: anyVideo.key, source: "tmdb" };
    return null;
  } catch {
    return null;
  }
}

function normalizeSearchName(name: string): string {
  return name
    .replace(/[™®©]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getItemCacheKey(item: MediaItem): string {
  return `clip:${item.type}:${item.id}`;
}

export const TRAILER_SKIP_END: Record<TrailerSource, number> = {
  netflix: 12,
  crunchyroll: 20,
  disney: 15,
  hbo: 0,
  youtube: 0,
  tmdb: 0,
};

export function getCachedClipInfo(item: MediaItem): { videoId: string; source: TrailerSource; duration: number } | null {
  const cacheKey = getItemCacheKey(item);
  return getCached(cacheKey);
}

export function getTrailerSkipEnd(source: TrailerSource): number {
  return TRAILER_SKIP_END[source] ?? 0;
}

export async function fetchYouTubeClip(item: MediaItem): Promise<{ videoId: string; source: TrailerSource; duration: number } | null> {
  const cacheKey = getItemCacheKey(item);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const name = normalizeSearchName(item.name);

  if (item.type === "anime") {
    for (const channel of ANIME_CHANNELS) {
      const query = `${channel.query} ${name} -trailer`;
      const videoId = await searchYouTube(query);
      if (videoId) {
        const entry: CacheEntry = { videoId, source: channel.source, duration: 0, fetchedAt: Date.now() };
        setCache(cacheKey, entry);
        return entry;
      }
    }
  }

  if (item.type === "anime" || item.type === "movie" || item.type === "series") {
    const query = `${name} scene clip -trailer -review -reaction -amv -top 10 -opening -ending -recap`;
    const videoId = await searchYouTube(query);
    if (videoId) {
      const entry: CacheEntry = { videoId, source: "youtube", duration: 0, fetchedAt: Date.now() };
      setCache(cacheKey, entry);
      return entry;
    }
  }

  const tmdbId = Number(item.id.replace("tmdb:", "").replace("anilist:", ""));
  if (Number.isFinite(tmdbId) && tmdbId > 0) {
    const tmdbType = item.type === "movie" ? "movie" : "tv";
    const result = await searchTmdbVideos(tmdbType, tmdbId);
    if (result) {
      const entry: CacheEntry = { ...result, duration: 0, fetchedAt: Date.now() };
      setCache(cacheKey, entry);
      return entry;
    }
  }

  return null;
}

export async function fetchYouTubeDuration(videoId: string): Promise<number> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 0;
    const data = await res.json();
    if (typeof data.duration === "number") return data.duration;
    return 0;
  } catch {
    return 0;
  }
}
