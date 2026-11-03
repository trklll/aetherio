import type { MediaStream } from "../types.ts";
import { createContext, publicUrl } from "./context.ts";
import { allowsAdditionalTorrent, allowsAdditionalVideo } from "./policy.ts";

export interface SeanimeMetadata {
  id: string;
  name: string;
  lang: string;
  type?: "onlinestream-provider" | "anime-torrent-provider";
  policy?: "spanish" | "original-soft";
  trustedSoft?: boolean;
  rawCategory?: boolean;
  needsAnimeId?: boolean;
  config?: Record<string, string>;
  manifestURI?: string;
}

export interface CompatResponse {
  ok: boolean; status: number; statusText: string; url: string; redirected: boolean;
  headers: Headers; cookies: Record<string, string>; contentType: string; contentLength: number;
  text(): string; json(): any; arrayBuffer(): ArrayBuffer;
}

/** Seanime's extension API is intentionally dynamic; the bridge validates outputs. */
export interface CompatContext {
  fetch(input: string, options?: Record<string, any>): Promise<CompatResponse>;
  [key: string]: any;
}
interface SearchResult { id: string; title?: string; Title?: string; subOrDub?: string; [key: string]: any }
interface Episode { id: string; number: number; url?: string; [key: string]: any }
interface EpisodeServer { server: string; headers?: Record<string, string>; videoSources?: Array<Record<string, any>> }
interface Provider {
  getSettings(): any;
  search(options: any): Promise<SearchResult[]>;
  smartSearch?(options: any): Promise<any[]>;
  findEpisodes?(id: string): Promise<Episode[]>;
  findEpisodeServer?(episode: Episode, server: string): Promise<EpisodeServer>;
  getTorrentInfoHash?(torrent: any): Promise<string>;
  getTorrentMagnetLink?(torrent: any): Promise<string>;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(?:audio\s+)?(?:latino|castellano|japones|subtitulado)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function seasonNumber(title: string): number | null {
  const numeric = title.match(/(\d+)\s*(?:st|nd|rd|th|ª)?\s*(?:season|temporada|cour)|\b(?:season|temporada|cour|s)\s*(\d+)/i);
  if (numeric) return Number(numeric[1] ?? numeric[2]);
  const roman = title.match(/(?:^|\s)(iv|v|iii|ii|i)(?:\s*:|$)/i);
  if (roman) return ({ i: 1, ii: 2, iii: 3, iv: 4, v: 5 } as Record<string, number>)[roman[1].toLowerCase()];
  const trailing = title.match(/\b(\d{1,2})\s*$/);
  return trailing && Number(trailing[1]) <= 50 && !/\b(?:part|parte|movie|film)\s+\d+\s*$/i.test(title) ? Number(trailing[1]) : null;
}

function hasMovieLikeWord(value: string): boolean {
  return /\b(movie|film|pelicula|ova|special|especial|specials)\b/i.test(value);
}

function hasArcSuffix(value: string): boolean {
  return /(?:-hen|final season)\s*$/i.test(value);
}

function hasStrongTitleMatch(results: SearchResult[], query: string): boolean {
  const wanted = normalizeTitle(query);
  return results.some(result => {
    const candidate = normalizeTitle(String(result.title ?? result.Title ?? ""));
    return candidate === wanted || candidate.startsWith(wanted) || candidate.includes(wanted) || wanted.includes(candidate);
  });
}

/** Ranking ported from Aetherio's local AnimeAV1 scraper. */
export function rankLocalAnimeAv1Results(results: SearchResult[], title: string, season: number): SearchResult[] {
  const wanted = normalizeTitle(title);
  const queryTokens = wanted.split(/\s+/).filter(Boolean);
  const requestedSeason = season || 1;
  return (Array.isArray(results) ? results : []).filter(result => result && typeof result.id === "string")
    .map((result, index) => {
      const name = String(result.title ?? result.Title ?? "");
      const normalized = normalizeTitle(name);
      const strong = normalized === wanted || normalized.startsWith(wanted)
        || normalized.includes(wanted) || wanted.includes(normalized);
      let score = (results.length - index) * (requestedSeason === 1 ? 1 : 10_000);
      if (strong) {
        score += normalized === wanted ? 1_000_000
          : normalized.startsWith(wanted) ? 500_000
            : normalized.includes(wanted) ? 300_000 : 100_000;
        const titleTokens = normalized.split(/\s+/).filter(Boolean);
        const contained = queryTokens.filter(token => titleTokens.includes(token)).length;
        score += Math.floor(contained / Math.max(1, queryTokens.length) * 100_000);
      }
      if (!hasMovieLikeWord(title) && hasMovieLikeWord(name)) score -= 200_000;
      if (requestedSeason === 1 && hasArcSuffix(name)) score -= 1_000_000;
      const parsedSeason = seasonNumber(name);
      if (parsedSeason === requestedSeason) score += strong ? 1_000_000 : 200_000;
      else if (parsedSeason !== null) score -= strong ? 1_000_000 : 200_000;
      else if (requestedSeason === 1) score += 200_000;
      score -= normalized.length;
      return { result: { ...result, title: name }, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.result);
}

/** Season/movie ranking follows the original independent animeav1.rs scraper. */
export function rankSearchResults(results: SearchResult[], title: string, season: number, mediaType: string): SearchResult[] {
  const wanted = normalizeTitle(title);
  const movie = /\b(movie|film|pelicula|ova|special|especial)\b/i;
  return (Array.isArray(results) ? results : []).filter(result => result && typeof result.id === "string")
    .map((result, index) => {
      const name = String(result.title ?? result.Title ?? "");
      const normalized = normalizeTitle(name);
      const parsedSeason = seasonNumber(name);
      if (mediaType !== "movie" && parsedSeason !== null && parsedSeason !== season) return null;
      let score = Math.max(0, 100 - index);
      if (normalized === wanted) score += 1_000;
      else if (normalized.startsWith(wanted)) score += 500;
      else if (normalized.includes(wanted) || wanted.includes(normalized) && normalized) score += 300;
      if (mediaType !== "movie" && movie.test(name) && !movie.test(title)) score -= 2_000;
      if (mediaType !== "movie" && parsedSeason === season) score += 2_000;
      if (season === 1 && /(?:-hen|final season)\s*$/i.test(name)) score -= 2_000;
      score -= normalized.length;
      return { result: { ...result, title: name }, score };
    }).filter((entry): entry is { result: SearchResult & { title: string }; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score).map(entry => entry.result);
}

async function pool<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await task(items[index]); }
      catch { /* One broken host must not hide the other real servers. */ }
    }
  }));
  return results.filter(value => value !== undefined);
}

function audioMode(result: SearchResult, episode: Episode, requestedDub: boolean): "sub" | "dub" {
  try {
    const parsed = JSON.parse(episode.id);
    if (parsed.type === "sub" || parsed.type === "dub") return parsed.type;
  } catch { /* Other extensions use opaque episode IDs. */ }
  return result.subOrDub === "dub" || result.subOrDub === "both" && requestedDub ? "dub" : "sub";
}

function playbackHeaders(meta: SeanimeMetadata, headers: Record<string, string>): Record<string, string> {
  const merged = Object.fromEntries(Object.entries(headers).filter(([, value]) => typeof value === "string"));
  if (meta.id === "animeav1") {
    const referer = Object.entries(merged).find(([key]) => key.toLowerCase() === "referer")?.[1];
    if (referer) {
      merged.Origin = new URL(referer).origin;
      merged["Sec-Fetch-Site"] = "same-origin";
      merged["Sec-Fetch-Mode"] = "cors";
      merged["Sec-Fetch-Dest"] = "empty";
    }
  }
  return merged;
}

async function online(provider: Provider, meta: SeanimeMetadata, media: any, title: string, season: number, number: number, type: string): Promise<MediaStream[]> {
  const settings = await provider.getSettings();
  const strict = meta.policy === "original-soft";
  const modes = settings.supportsDub && !strict ? [false, true] : [false];
  const variants = await pool(modes, 2, async dub => {
    // AnimeAV1's native search returns all seasons. Supplying a base AniList
    // title here would prematurely narrow it to season 1 in the upstream code.
    let results = await provider.search({ query: title, dub, ...(meta.id === "animeav1" ? {} : { media }) });
    let rankingTitle = title;
    if (meta.id === "animeav1" && !hasStrongTitleMatch(results, title)) {
      // The local Aetherio scraper handled AnimeAV1's English-alias/Japanese-
      // title mismatch by searching again with the first non-movie result.
      const anchor = results.find(item => !hasMovieLikeWord(String(item.title ?? item.Title ?? "")));
      if (anchor) {
        const isolated = await provider.search({ query: String(anchor.title ?? anchor.Title), dub });
        if (isolated.length > 0) {
          results = isolated;
          rankingTitle = String(anchor.title ?? anchor.Title);
        }
      }
    }
    const ranked = meta.id === "animeav1"
      ? rankLocalAnimeAv1Results(results, rankingTitle, season)
      : rankSearchResults(results, title, season, type);
    const result = ranked.find(item => dub ? item.subOrDub === "dub" || item.subOrDub === "both" : item.subOrDub !== "dub");
    if (!result || !provider.findEpisodes || !provider.findEpisodeServer) return [];
    const episodes = await provider.findEpisodes(result.id);
    const episode = episodes.find(item => Number(item.number) === number);
    if (!episode) return [];
    const mode = audioMode(result, episode, dub);
    if (strict && mode === "dub") return [];
    const servers: string[] = Array.isArray(settings.episodeServers) && settings.episodeServers.length ? settings.episodeServers : ["default"];
    const selected = servers.filter(server => !strict || !/\b(?:dub|hard|english|hindi|tamil|telugu|german|french)\b/i.test(server)).slice(0, 8);
    const found = await pool(selected, 3, server => provider.findEpisodeServer!(episode, server));
    return found.flatMap<MediaStream>(server => (server.videoSources ?? []).flatMap(source => {
      if (typeof source.url !== "string" || !["mp4", "m3u8", "hls", "mpd", "mkv"].includes(String(source.type).toLowerCase())) return [];
      try { publicUrl(source.url); } catch { return []; }
      if (strict && !allowsAdditionalVideo(source, server.server, meta.trustedSoft)) return [];
      const headers = playbackHeaders(meta, { ...server.headers, ...source.headers });
      return [{
        name: meta.name, sourceName: meta.name,
        title: [server.server, source.quality, mode === "dub" ? "Audio Español" : strict ? "Audio Japonés · subtítulos opcionales" : "Sub: Español"].filter(Boolean).join(" · "),
        url: source.url, type: "direct", quality: source.quality,
        headers, languages: [mode === "dub" ? "es" : "ja"],
        subtitles: Array.isArray(source.subtitles) ? source.subtitles.filter((subtitle: any) => typeof subtitle?.url === "string" && /^https?:\/\//i.test(subtitle.url)) : [],
        behaviorHints: { providerName: meta.name, providerId: meta.id, mediaExtensionManifest: meta.manifestURI, scraperResolvedDirect: true, headers },
      }];
    }));
  });
  return variants.flat();
}

export function torrentHash(value: unknown): string | null {
  const input = String(value ?? "").trim();
  if (/^[a-f\d]{40}$/i.test(input)) return input.toLowerCase();
  const hash = input.match(/[?&]xt=urn(?::|%3A)btih(?::|%3A)([a-z0-9]{32,40})(?:&|$)/i)?.[1] ?? input;
  if (/^[a-f\d]{40}$/i.test(hash)) return hash.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(hash)) return null;
  let bits = 0, accumulator = 0, hex = "";
  for (const character of hash.toUpperCase()) {
    accumulator = (accumulator << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) { bits -= 8; hex += ((accumulator >>> bits) & 255).toString(16).padStart(2, "0"); }
  }
  return hex;
}

async function torrents(provider: Provider, meta: SeanimeMetadata, media: any, title: string, episode: number, type: string): Promise<MediaStream[]> {
  const settings = await provider.getSettings();
  const options = { media, query: title, batch: false, episodeNumber: episode, resolution: "", anidbAID: 0, anidbEID: 0, bestReleases: true };
  const raw = settings.canSmartSearch && provider.smartSearch ? await provider.smartSearch(options) : await provider.search(options);
  const candidates = (Array.isArray(raw) ? raw : []).filter(torrent => {
    if (!torrent || !allowsAdditionalTorrent(torrent, meta.rawCategory)) return false;
    if (type === "movie") return true;
    const name = String(torrent.name ?? "");
    const releaseSeason = seasonNumber(name);
    if (releaseSeason !== null && releaseSeason !== Number(media.season ?? 1)) return false;
    // For later seasons an unlabelled release is ambiguous; SubsPlease and
    // similar feeds use an explicit S02/Season 2 marker for those cour.
    if (Number(media.season ?? 1) > 1 && releaseSeason === null) return false;
    const parsed = name.match(/\bS\d{1,2}E(\d{1,4})\b/i)?.[1] ?? name.match(/(?:\s-\s|\bEP?\s*)(\d{1,4})\b/i)?.[1];
    const number = Number(torrent.episodeNumber) > 0 ? Number(torrent.episodeNumber) : Number(parsed);
    // Do not offer a batch's first file as the requested episode.
    return !torrent.isBatch && number === episode;
  }).slice(0, 12);
  return (await pool(candidates, 3, async torrent => {
    let magnet = String(torrent.magnetLink ?? "");
    let infoHash = torrentHash(torrent.infoHash) ?? torrentHash(magnet);
    if (!infoHash && provider.getTorrentInfoHash) infoHash = torrentHash(await provider.getTorrentInfoHash(torrent));
    if (!infoHash && provider.getTorrentMagnetLink) { magnet = await provider.getTorrentMagnetLink(torrent); infoHash = torrentHash(magnet); }
    if (!infoHash) return null;
    return {
      name: meta.name, title: String(torrent.name), infoHash,
      seeders: Number.isFinite(Number(torrent.seeders)) && Number(torrent.seeders) >= 0 ? Number(torrent.seeders) : undefined,
      size: Number(torrent.size) > 0 ? Number(torrent.size) : undefined,
      languages: ["ja"], sources: torrentHash(magnet) ? [magnet] : undefined,
      behaviorHints: { providerId: meta.id, providerName: meta.name, filename: String(torrent.name), subtitlePolicy: "raw-or-soft", mediaExtensionManifest: meta.manifestURI },
    } satisfies MediaStream;
  })).filter((stream): stream is NonNullable<typeof stream> => stream !== null);
}

async function animeMedia(context: CompatContext, meta: SeanimeMetadata, title: string, type: string, season: number): Promise<any> {
  const media: any = { id: 0, romajiTitle: title, englishTitle: title, synonyms: [], isAdult: false, format: type === "movie" ? "MOVIE" : "TV", episodeCount: 0, absoluteSeasonOffset: 0, season };
  if (!meta.needsAnimeId) return media;
  const response = await context.fetch("https://graphql.anilist.co", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    query: "query($search:String){Page(perPage:8){media(search:$search,type:ANIME,isAdult:false){id idMal title{romaji english} synonyms format episodes startDate{year}}}}", variables: { search: title },
  }) });
  if (!response.ok) return media;
  const found = response.json()?.data?.Page?.media ?? [];
  const ranked = rankSearchResults(found.map((item: any) => ({ ...item, id: String(item.id), title: item.title?.romaji ?? item.title?.english })), title, season, type);
  const match = found.find((item: any) => String(item.id) === ranked[0]?.id);
  return match ? { ...media, id: match.id, idMal: match.idMal, romajiTitle: match.title.romaji || title, englishTitle: match.title.english || title, synonyms: match.synonyms ?? [], episodeCount: match.episodes ?? 0, format: match.format, startDate: match.startDate } : media;
}

export function createSeanimeAdapter(factory: (context: CompatContext) => Provider, meta: SeanimeMetadata, dependencies: Record<string, any> = {}) {
  return {
    async getStreams(first: unknown, ...rest: unknown[]): Promise<MediaStream[]> {
      // Hub calls getStreams(args); the existing desktop runtime spreads args.
      const args = Array.isArray(first) ? first : [first, ...rest];
      const [, inputType, rawSeason, rawEpisode, rawTitle] = args;
      const type = inputType === "series" || inputType === "anime" ? "tv" : inputType;
      const title = typeof rawTitle === "string" ? rawTitle.trim().slice(0, 300) : "";
      const season = Number(rawSeason ?? 1);
      const episode = type === "movie" ? 1 : Number(rawEpisode ?? 1);
      if (!title || !["movie", "tv"].includes(String(type)) || !Number.isInteger(episode) || episode < 1 || !Number.isInteger(season) || season < 1) return [];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        const context = createContext(meta, dependencies, controller.signal);
        const provider = factory(context);
        const media = await animeMedia(context, meta, title, String(type), season);
        if (meta.needsAnimeId && !media.id) return [];
        const streams = meta.type === "anime-torrent-provider"
          ? await torrents(provider, meta, media, title, episode, String(type))
          : await online(provider, meta, media, title, season, episode, String(type));
        const seen = new Set<string>();
        return streams.filter(stream => { const key = String(stream.url ?? stream.infoHash); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 12);
      } finally {
        controller.abort();
        clearTimeout(timeout);
      }
    },
  };
}
