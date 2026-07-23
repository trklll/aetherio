import { tmdbFetch } from "../config/apiKeys";
import { invokeCommand, isTauriRuntime } from "../runtime/platform";
import type { MediaItem, TrailerSource } from "../types/ui";

export interface YouTubeClipCandidate {
  videoId: string;
  source: TrailerSource;
  duration: number;
}

interface CacheEntry extends YouTubeClipCandidate {
  fetchedAt: number;
  fallbacks: YouTubeClipCandidate[];
}

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  duration?: number | null;
  uploader?: string | null;
  uploaderId?: string | null;
}

const CACHE_KEY = "aetherio-youtube-clips-v3";
const CACHE_TTL = 1000 * 60 * 60 * 24;
const OFFICIAL_CHANNELS = [
  { handle: "@CrunchyrollenEspañol", source: "crunchyroll" as const },
  { handle: "@netflixanime", source: "netflix" as const },
  { handle: "@HBOMaxLa", source: "hbo" as const },
  { handle: "@disneyplusla", source: "disney" as const },
];
const REJECTED_SCENE_WORDS = [
  "trailer", "teaser", "review", "reaction", "amv", "opening", "ending",
  "recap", "explained", "analysis", "top 10", "soundtrack", "ost",
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
  } catch {
    // Clip caching is an optimization; private storage modes may reject writes.
  }
}

function getCached(id: string): CacheEntry | null {
  const cache = getCache();
  const entry = cache[id];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    delete cache[id];
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore storage cleanup failures.
    }
    return null;
  }
  return entry;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTitleTokens(name: string) {
  const ignored = new Set(["a", "an", "and", "de", "del", "el", "la", "las", "los", "of", "the", "y"]);
  return normalizeText(name)
    .split(" ")
    .filter(token => token.length > 1 && !ignored.has(token));
}

function sourceForCandidate(candidate: YouTubeSearchResult): TrailerSource {
  const channel = normalizeText(`${candidate.uploader ?? ""} ${candidate.uploaderId ?? ""}`);
  if (channel.includes("crunchyroll")) return "crunchyroll";
  if (channel.includes("netflix")) return "netflix";
  if (channel.includes("hbo max") || channel.includes("hbomax")) return "hbo";
  if (channel.includes("disney plus") || channel.includes("disneyplus")) return "disney";
  return "youtube";
}

function sceneScore(candidate: YouTubeSearchResult, mediaName: string) {
  const title = normalizeText(candidate.title);
  const tokens = meaningfulTitleTokens(mediaName);
  const matchingTokens = tokens.filter(token => title.includes(token)).length;
  const coverage = tokens.length ? matchingTokens / tokens.length : 0;
  if (coverage < 0.5) return Number.NEGATIVE_INFINITY;
  if (REJECTED_SCENE_WORDS.some(word => title.includes(word))) return Number.NEGATIVE_INFINITY;

  const duration = candidate.duration ?? 0;
  if (duration > 0 && (duration < 25 || duration > 12 * 60)) return Number.NEGATIVE_INFINITY;

  let score = coverage * 100;
  if (/\b(scene|clip|fight|moment|vs)\b/.test(title)) score += 18;
  if (duration >= 45 && duration <= 4 * 60) score += 16;
  if (sourceForCandidate(candidate) !== "youtube") score += 20;
  return score;
}

async function runYouTubeSearch(query: string, channel?: string) {
  try {
    return await invokeCommand<YouTubeSearchResult[]>("youtube_search", {
      query,
      limit: channel ? 8 : 10,
      channel: channel ?? null,
    });
  } catch (error) {
    console.warn(`[Aetherio:YouTube] Falló la búsqueda${channel ? ` en ${channel}` : " global"}:`, error);
    return [];
  }
}

function rankCandidates(candidates: YouTubeSearchResult[], name: string) {
  const unique = new Map<string, YouTubeSearchResult>();
  for (const candidate of candidates) unique.set(candidate.videoId, candidate);
  return [...unique.values()]
    .map(candidate => ({ candidate, score: sceneScore(candidate, name) }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)
    .map(entry => entry.candidate);
}

async function searchAnimeScene(name: string): Promise<YouTubeClipCandidate[]> {
  if (!isTauriRuntime()) return [];
  const baseQuery = `${name} anime scene clip`;
  const strictQuery = `${baseQuery} -trailer -teaser -review -reaction -amv -opening -ending -recap -explained -analysis -ost`;
  const official: YouTubeClipCandidate[] = [];

  // Search every preferred channel directly, first with exclusions and then
  // without them. The channel page itself is the filter; uploader-name guesses
  // are not used for this priority pass.
  for (const preferred of OFFICIAL_CHANNELS) {
    const [strict, relaxed] = await Promise.all([
      runYouTubeSearch(strictQuery, preferred.handle),
      runYouTubeSearch(baseQuery, preferred.handle),
    ]);
    for (const candidate of rankCandidates([...strict, ...relaxed], name)) {
      if (official.some(entry => entry.videoId === candidate.videoId)) continue;
      official.push({
        videoId: candidate.videoId,
        source: preferred.source,
        duration: candidate.duration ?? 0,
      });
    }
    if (official.length >= 8) break;
  }

  if (official.length >= 8) return official.slice(0, 8);

  const [strictGlobal, relaxedGlobal] = await Promise.all([
    runYouTubeSearch(strictQuery),
    runYouTubeSearch(baseQuery),
  ]);
  const global = rankCandidates([...strictGlobal, ...relaxedGlobal], name)
    .filter(candidate => !official.some(entry => entry.videoId === candidate.videoId))
    .map(candidate => ({
      videoId: candidate.videoId,
      source: sourceForCandidate(candidate),
      duration: candidate.duration ?? 0,
    }));
  return [...official, ...global].slice(0, 10);
}

async function searchTmdbVideos(
  tmdbType: "movie" | "tv",
  tmdbId: number,
): Promise<Array<{ videoId: string; source: TrailerSource }>> {
  try {
    const data = await tmdbFetch<{ results: Array<{ key: string; site: string; type: string; official: boolean }> }>(
      `/${tmdbType}/${tmdbId}/videos`,
      { params: { language: "es-ES,en-US" } },
    );
    if (!data?.results?.length) return [];
    const clips = data.results.filter(video => video.site === "YouTube" && (video.type === "Clip" || video.type === "Scene"));
    const trailers = data.results.filter(video => video.site === "YouTube" && video.type === "Trailer" && video.official);
    return [...clips, ...trailers]
      .filter((video, index, all) => all.findIndex(entry => entry.key === video.key) === index)
      .slice(0, 4)
      .map(video => ({ videoId: video.key, source: "tmdb" as const }));
  } catch {
    return [];
  }
}

function getItemCacheKey(item: MediaItem) {
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

export function getCachedClipInfo(item: MediaItem) {
  return getCached(getItemCacheKey(item));
}

export function getTrailerSkipEnd(source: TrailerSource) {
  return TRAILER_SKIP_END[source] ?? 0;
}

export async function fetchYouTubeClip(item: MediaItem): Promise<CacheEntry | null> {
  const cacheKey = getItemCacheKey(item);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const candidates: YouTubeClipCandidate[] = [];
  if (item.type === "anime") {
    candidates.push(...await searchAnimeScene(item.name));
  }

  const tmdbId = Number(String(item.id).replace("tmdb:", "").replace("anilist:", ""));
  if (Number.isFinite(tmdbId) && tmdbId > 0) {
    const results = await searchTmdbVideos(item.type === "movie" ? "movie" : "tv", tmdbId);
    for (const result of results) {
      if (!candidates.some(candidate => candidate.videoId === result.videoId)) {
        candidates.push({ ...result, duration: 0 });
      }
    }
  }

  const [primary, ...fallbacks] = candidates;
  if (!primary) return null;
  const entry: CacheEntry = { ...primary, fallbacks, fetchedAt: Date.now() };
  setCache(cacheKey, entry);
  return entry;
}
