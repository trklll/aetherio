import { tmdbFetch } from "../config/apiKeys.ts";
import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { MediaItem, TrailerSource } from "../types/ui.ts";

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

export type YouTubeSearchPhase = "primary" | "trailer" | "scene";
export type YouTubeFetchPriority = "foreground" | "background";

interface SearchContext {
  priority: YouTubeFetchPriority;
  generation: number;
  queries: number;
  errors: number;
  phase: YouTubeSearchPhase | "idle";
}

interface SearchTask<T> {
  context: SearchContext;
  startedAsBackground: boolean;
  sequence: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface InFlightEntry {
  promise: Promise<CacheEntry | null>;
  context: SearchContext;
}

type MissStatus = "miss" | "error";

interface MissCacheEntry {
  fetchedAt: number;
  status: MissStatus;
}

const CACHE_KEY = "aetherio-youtube-clips-v4";
const MISS_CACHE_KEY = "aetherio-youtube-clips-misses-v1";
const CACHE_TTL = 1000 * 60 * 60 * 24;
const MISS_TTL = 1000 * 60 * 60 * 6;
const ERROR_TTL = 1000 * 60 * 10;
const MAX_CANDIDATES = 10;
const YTDLP_CONCURRENCY = 4;
const BACKGROUND_CONCURRENCY = 1;

let activeYtdlpCount = 0;
let activeBackgroundCount = 0;
let taskSequence = 0;
let foregroundGeneration = 0;
const ytdlpQueue: Array<SearchTask<unknown>> = [];
const inFlight = new Map<string, InFlightEntry>();

function createSearchContext(priority: YouTubeFetchPriority): SearchContext {
  return {
    priority,
    generation: priority === "foreground" ? ++foregroundGeneration : 0,
    queries: 0,
    errors: 0,
    phase: "idle",
  };
}

function taskRank(task: SearchTask<unknown>) {
  return task.context.priority === "foreground" ? task.context.generation : -1;
}

function drainYtdlpQueue() {
  while (activeYtdlpCount < YTDLP_CONCURRENCY && ytdlpQueue.length) {
    ytdlpQueue.sort((left, right) => taskRank(right) - taskRank(left) || left.sequence - right.sequence);
    const taskIndex = ytdlpQueue.findIndex(task =>
      task.context.priority === "foreground" || activeBackgroundCount < BACKGROUND_CONCURRENCY,
    );
    if (taskIndex < 0) return;
    const [task] = ytdlpQueue.splice(taskIndex, 1);
    activeYtdlpCount++;
    task.startedAsBackground = task.context.priority === "background";
    if (task.startedAsBackground) activeBackgroundCount++;
    void task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activeYtdlpCount--;
        if (task.startedAsBackground) activeBackgroundCount--;
        drainYtdlpQueue();
      });
  }
}

function withYtdlpSlot<T>(fn: () => Promise<T>, context: SearchContext): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    ytdlpQueue.push({
      context,
      startedAsBackground: false,
      sequence: taskSequence++,
      run: fn,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    drainYtdlpQueue();
  });
}

const OFFICIAL_CHANNELS = [
  { handle: "@CrunchyrollenEspañol", source: "crunchyroll" as const },
  { handle: "@netflixanime", source: "netflix" as const },
  { handle: "@HBOMaxLa", source: "hbo" as const },
  { handle: "@disneyplusla", source: "disney" as const },
];

const SERIES_MOVIE_OFFICIAL_CHANNELS = [
  { handle: "@NetflixLATAM", source: "netflix" as const },
  { handle: "@HBOMaxLa", source: "hbo" as const },
  { handle: "@DisneyPlusLA", source: "disney" as const },
  { handle: "@PrimeVideoLATAM", source: "prime" as const },
  { handle: "@MubiLatinoamerica", source: "mubi" as const },
  { handle: "@AppleTV", source: "apple" as const },
  { handle: "@HuluLatinoamerica", source: "hulu" as const },
  { handle: "@ParamountPlusLA", source: "paramount" as const },
];

const PRIMARY_REJECTED_WORDS = [
  "trailer", "teaser", "review", "reaction", "reaccion", "amv", "opening", "ending",
  "recap", "explained", "analysis", "top 10", "soundtrack", "ost", "interview",
  "entrevista", "podcast", "live", "directo", "en vivo",
];
const TRAILER_WORDS = ["trailer", "teaser", "avance", "adelanto"];
const SCENE_WORDS = ["scene", "clip", "fight", "moment", "escena", "momento", "batalla"];
const SHORT_TITLE_CONTEXT = [
  "official", "oficial", "movie", "pelicula", "film", "series", "serie", "anime",
  "clip", "scene", "escena", "moment", "momento", "part", "parte", "season", "temporada",
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

function getMissCache(): Record<string, MissCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(MISS_CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function getCachedMiss(id: string) {
  const cache = getMissCache();
  const entry = cache[id];
  if (!entry) return false;
  const ttl = entry.status === "error" ? ERROR_TTL : MISS_TTL;
  if (Date.now() - entry.fetchedAt <= ttl) return true;
  delete cache[id];
  try {
    localStorage.setItem(MISS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage cleanup failures.
  }
  return false;
}

function setCachedMiss(id: string, status: MissStatus) {
  try {
    const cache = getMissCache();
    cache[id] = { fetchedAt: Date.now(), status };
    localStorage.setItem(MISS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures; the next mount can retry.
  }
}

export function normalizeYouTubeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[™®©]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTitleTokens(name: string) {
  const ignored = new Set(["a", "an", "and", "de", "del", "el", "la", "las", "los", "of", "the", "y"]);
  return normalizeYouTubeText(name)
    .split(" ")
    .filter(token => token.length > 1 && !ignored.has(token));
}

function hasExplicitTitle(candidateTitle: string, mediaName: string, year?: number) {
  const title = normalizeYouTubeText(candidateTitle);
  const phrase = normalizeYouTubeText(mediaName);
  if (!title || !phrase || !title.includes(phrase)) return false;

  const tokens = meaningfulTitleTokens(mediaName);
  if (tokens.length !== 1 || tokens[0].length >= 4) return true;
  const hasYear = year != null && title.includes(String(year));
  const hasContext = SHORT_TITLE_CONTEXT.some(word => title.split(" ").includes(word));
  return hasYear || hasContext;
}

function containsAnyWord(title: string, words: string[]) {
  const normalized = normalizeYouTubeText(title);
  return words.some(word => {
    const normalizedWord = normalizeYouTubeText(word);
    return normalizedWord.includes(" ")
      ? normalized.includes(normalizedWord)
      : normalized.split(" ").includes(normalizedWord);
  });
}

function durationIsUsable(duration?: number | null) {
  return !duration || (duration >= 25 && duration <= 12 * 60);
}

function sourceForCandidate(candidate: YouTubeSearchResult): TrailerSource {
  const channel = normalizeYouTubeText(`${candidate.uploader ?? ""} ${candidate.uploaderId ?? ""}`);
  if (channel.includes("crunchyroll")) return "crunchyroll";
  if (channel.includes("netflix")) return "netflix";
  if (channel.includes("hbo max") || channel.includes("hbomax")) return "hbo";
  if (channel.includes("disney plus") || channel.includes("disneyplus")) return "disney";
  if (channel.includes("prime video") || channel.includes("primevideo")) return "prime";
  if (channel.includes("apple tv")) return "apple";
  if (channel.includes("hulu")) return "hulu";
  if (channel.includes("paramount")) return "paramount";
  if (channel.includes("mubi")) return "mubi";
  return "youtube";
}

function candidateScore(
  candidate: YouTubeSearchResult,
  names: string[],
  phase: YouTubeSearchPhase,
  year?: number,
) {
  const title = normalizeYouTubeText(candidate.title);
  const nameIndex = names.findIndex(name => hasExplicitTitle(candidate.title, name, year));
  if (nameIndex < 0 || !durationIsUsable(candidate.duration)) return Number.NEGATIVE_INFINITY;

  if (phase === "primary" && containsAnyWord(title, PRIMARY_REJECTED_WORDS)) return Number.NEGATIVE_INFINITY;
  if (phase === "trailer" && (!containsAnyWord(title, TRAILER_WORDS) || containsAnyWord(title, ["review", "reaction", "recap", "explained", "analysis"]))) {
    return Number.NEGATIVE_INFINITY;
  }
  if (phase === "scene" && containsAnyWord(title, PRIMARY_REJECTED_WORDS)) return Number.NEGATIVE_INFINITY;

  const matchedName = normalizeYouTubeText(names[nameIndex]);
  let score = 1000 - nameIndex * 40;
  if (title === matchedName) score += 60;
  if (year != null && title.includes(String(year))) score += 28;
  if (phase === "primary" && containsAnyWord(title, ["clip", "scene", "escena", "moment", "momento", "promo"])) score += 14;
  if (phase === "scene" && containsAnyWord(title, SCENE_WORDS)) score += 24;
  if (candidate.duration != null && candidate.duration >= 45 && candidate.duration <= 4 * 60) score += 16;
  if (sourceForCandidate(candidate) !== "youtube") score += 20;
  return score;
}

export function rankYouTubeCandidates(
  candidates: YouTubeSearchResult[],
  names: string[],
  phase: YouTubeSearchPhase,
  year?: number,
) {
  const unique = new Map<string, YouTubeSearchResult>();
  for (const candidate of candidates) {
    if (candidate.videoId && !unique.has(candidate.videoId)) unique.set(candidate.videoId, candidate);
  }
  return [...unique.values()]
    .map((candidate, index) => ({ candidate, score: candidateScore(candidate, names, phase, year), index }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(entry => entry.candidate);
}

async function runYouTubeSearch(query: string, channel: string | undefined, context: SearchContext) {
  context.queries++;
  return withYtdlpSlot(async () => {
    try {
      return await invokeCommand<YouTubeSearchResult[]>("youtube_search", {
        query,
        limit: channel ? 10 : 10,
        channel: channel ?? null,
      });
    } catch (error) {
      context.errors++;
      console.warn(`[Aetherio:YouTube] Falló la búsqueda${channel ? ` en ${channel}` : " global"}:`, error);
      return [];
    }
  }, context);
}

function searchNames(item: MediaItem) {
  const values = [item.name, ...(item.searchAliases ?? [])];
  const seen = new Set<string>();
  return values.filter(value => {
    const normalized = normalizeYouTubeText(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function quoteSearch(value: string) {
  return `"${value.replace(/"/g, "").trim()}"`;
}

function phaseQueries(name: string, phase: YouTubeSearchPhase, year?: number, isAnime = false) {
  const quoted = quoteSearch(name);
  if (phase === "primary") {
    const tokens = meaningfulTitleTokens(name);
    return tokens.length === 1 && tokens[0].length < 4 && year
      ? [`${quoted} ${year}`]
      : [quoted];
  }
  if (phase === "trailer") return [`${quoted} trailer`];
  return [
    `${quoted} clip`,
    `${quoted} scene`,
    `${quoted} escena`,
    `${quoted} moment momento${isAnime ? " fight" : ""}`,
  ];
}

type OfficialChannel = { handle: string; source: TrailerSource };

async function searchOfficialPhase(
  item: MediaItem,
  phase: YouTubeSearchPhase,
  channels: OfficialChannel[],
  context: SearchContext,
) {
  if (!isTauriRuntime()) return [] as YouTubeClipCandidate[];
  context.phase = phase;
  const names = searchNames(item);
  const isAnime = item.type === "anime";

  for (const name of names) {
    for (const query of phaseQueries(name, phase, item.year, isAnime)) {
      const results = await Promise.all(channels.map(async (preferred, channelIndex) => ({
        channelIndex,
        preferred,
        results: await runYouTubeSearch(query, preferred.handle, context),
      })));
      const ranked: Array<{ candidate: YouTubeSearchResult; source: TrailerSource; channelIndex: number }> = [];
      for (const result of results) {
        for (const candidate of rankYouTubeCandidates(result.results, [name], phase, item.year)) {
          if (!ranked.some(entry => entry.candidate.videoId === candidate.videoId)) {
            ranked.push({ candidate, source: result.preferred.source, channelIndex: result.channelIndex });
          }
        }
      }
      const sorted = ranked
        .sort((left, right) => {
          const scoreLeft = candidateScore(left.candidate, [name], phase, item.year);
          const scoreRight = candidateScore(right.candidate, [name], phase, item.year);
          return scoreRight - scoreLeft || left.channelIndex - right.channelIndex;
        })
        .slice(0, MAX_CANDIDATES)
        .map(({ candidate, source }) => ({
          videoId: candidate.videoId,
          source,
          duration: candidate.duration ?? 0,
        }));
      if (sorted.length) return sorted;
    }
  }
  return [];
}

interface TmdbVideoResult {
  key: string;
  site: string;
  type: string;
  official?: boolean;
}

async function searchTmdbVideos(tmdbType: "movie" | "tv", tmdbId: number) {
  try {
    const data = await tmdbFetch<{ results: TmdbVideoResult[] }>(
      `/${tmdbType}/${tmdbId}/videos`,
      { params: { language: "es-ES,en-US" } },
    );
    const videos = (data?.results ?? []).filter(video => video.site === "YouTube" && video.key);
    const unique = (values: TmdbVideoResult[]) => values
      .filter((video, index, all) => all.findIndex(entry => entry.key === video.key) === index)
      .slice(0, 4)
      .map(video => ({ videoId: video.key, source: "tmdb" as const, duration: 0 }));
    return {
      clips: unique(videos.filter(video => video.type === "Clip" || video.type === "Scene")),
      trailers: unique(videos.filter(video => video.type === "Trailer" && video.official === true)),
    };
  } catch {
    return { clips: [], trailers: [] };
  }
}

function getItemCacheKey(item: MediaItem) {
  return `clip:${item.type}:${item.id}`;
}

function tmdbIdForItem(item: MediaItem) {
  const match = /^(?:tmdb|anilist):(\d+)$/.exec(String(item.id));
  if (!match) return null;
  const tmdbId = Number(match[1]);
  return Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null;
}

export const TRAILER_SKIP_END: Record<TrailerSource, number> = {
  netflix: 12,
  crunchyroll: 20,
  disney: 15,
  hbo: 0,
  prime: 0,
  apple: 0,
  hulu: 0,
  paramount: 0,
  mubi: 0,
  youtube: 0,
  tmdb: 0,
};

export function getCachedClipInfo(item: MediaItem) {
  return getCached(getItemCacheKey(item));
}

export function getTrailerSkipEnd(source: TrailerSource) {
  return TRAILER_SKIP_END[source] ?? 0;
}

async function discoverYouTubeClip(item: MediaItem, context: SearchContext): Promise<CacheEntry | null> {
  const channels = item.type === "anime" ? OFFICIAL_CHANNELS : SERIES_MOVIE_OFFICIAL_CHANNELS;
  const tmdbId = tmdbIdForItem(item);
  const tmdbPromise = tmdbId
    ? searchTmdbVideos(item.type === "movie" ? "movie" : "tv", tmdbId)
    : Promise.resolve({ clips: [], trailers: [] });

  let candidates = await searchOfficialPhase(item, "primary", channels, context);
  if (!candidates.length) {
    const [officialTrailers, tmdbVideos] = await Promise.all([
      searchOfficialPhase(item, "trailer", channels, context),
      tmdbPromise,
    ]);
    candidates = [...officialTrailers, ...tmdbVideos.trailers]
      .filter((candidate, index, all) => all.findIndex(entry => entry.videoId === candidate.videoId) === index)
      .slice(0, MAX_CANDIDATES);
  }

  if (!candidates.length) {
    const [officialScenes, tmdbVideos] = await Promise.all([
      searchOfficialPhase(item, "scene", channels, context),
      tmdbPromise,
    ]);
    candidates = [...officialScenes, ...tmdbVideos.clips]
      .filter((candidate, index, all) => all.findIndex(entry => entry.videoId === candidate.videoId) === index)
      .slice(0, MAX_CANDIDATES);
    if (!candidates.length) {
      const names = searchNames(item);
      const globalResults: YouTubeSearchResult[] = [];
      for (const name of names) {
        for (const query of phaseQueries(name, "scene", item.year, item.type === "anime")) {
          globalResults.push(...await runYouTubeSearch(query, undefined, context));
        }
        const ranked = rankYouTubeCandidates(globalResults, [name], "scene", item.year);
        if (ranked.length) {
          candidates = ranked.slice(0, MAX_CANDIDATES).map(candidate => ({
            videoId: candidate.videoId,
            source: sourceForCandidate(candidate),
            duration: candidate.duration ?? 0,
          }));
          break;
        }
      }
    }
  }

  const [primary, ...fallbacks] = candidates;
  if (!primary) return null;
  return { ...primary, fallbacks, fetchedAt: Date.now() };
}

function promoteInFlight(entry: InFlightEntry) {
  if (entry.context.priority === "background") {
    entry.context.priority = "foreground";
    entry.context.generation = ++foregroundGeneration;
    console.info("[Aetherio:YouTube] Promoviendo búsqueda prefetched al Hero activo");
    drainYtdlpQueue();
  }
}

export interface YouTubeFetchOptions {
  priority?: YouTubeFetchPriority;
}

export async function fetchYouTubeClip(
  item: MediaItem,
  options: YouTubeFetchOptions = {},
): Promise<CacheEntry | null> {
  const cacheKey = getItemCacheKey(item);
  const cached = getCached(cacheKey);
  if (cached) {
    console.info(`[Aetherio:YouTube] cache-hit item=${cacheKey}`);
    return cached;
  }
  if (getCachedMiss(cacheKey)) {
    console.info(`[Aetherio:YouTube] negative-cache-hit item=${cacheKey}`);
    return null;
  }
  const existing = inFlight.get(cacheKey);
  if (existing) {
    if ((options.priority ?? "foreground") === "foreground") promoteInFlight(existing);
    console.info(`[Aetherio:YouTube] deduplicated item=${cacheKey}`);
    return existing.promise;
  }
  if (!isTauriRuntime()) return null;

  const context = createSearchContext(options.priority ?? "foreground");
  const startedAt = performance.now();
  const promise = discoverYouTubeClip(item, context)
    .then(result => {
      const elapsed = Math.round(performance.now() - startedAt);
      console.info(`[Aetherio:YouTube] item=${cacheKey} phase=${context.phase} queries=${context.queries} errors=${context.errors} elapsedMs=${elapsed} result=${result ? "hit" : "miss"}`);
      if (result) {
        setCache(cacheKey, result);
      } else {
        setCachedMiss(cacheKey, context.errors ? "error" : "miss");
      }
      return result;
    })
    .catch(error => {
      setCachedMiss(cacheKey, "error");
      console.warn("[Aetherio:YouTube] Falló la selección de candidatos:", error);
      return null;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, { promise, context });
  return promise;
}

export function prefetchYouTubeClip(item: MediaItem) {
  return fetchYouTubeClip(item, { priority: "background" });
}
