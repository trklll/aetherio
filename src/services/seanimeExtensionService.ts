import { tmdbFetch } from "../config/apiKeys.ts";
import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { MediaStream, StreamQuery, StreamSubtitle } from "../types/stream.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";
import { getMagnetBtih, isValidMagnetUri, normalizeBtih } from "../utils/playableMedia.ts";
import { normalizeSeederCount } from "../utils/torrentHealth.ts";

export type SeanimeExtensionType = "anime-torrent-provider" | "onlinestream-provider";

interface ProviderHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: boolean;
  sessionKey?: string;
}

interface ProviderHttpResponse {
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  bodyBase64: string;
}

export interface SeanimeConfigField {
  type: "text" | "switch" | "select";
  name: string;
  label: string;
  default?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface SeanimeExtensionManifest {
  id: string;
  name: string;
  version: string;
  manifestURI: string;
  language: "javascript" | "typescript";
  type: SeanimeExtensionType;
  description?: string;
  author?: string;
  icon?: string;
  website?: string;
  lang?: string;
  payload?: string;
  payloadURI?: string;
  userConfig?: {
    version: number;
    requiresConfig?: boolean;
    fields: SeanimeConfigField[];
  };
}

export interface SeanimeExtensionInventory {
  installed: SeanimeExtensionManifest[];
  errors: string[];
}

interface SeanimeMedia {
  id: number;
  idMal?: number;
  status?: string;
  format?: string;
  englishTitle?: string;
  romajiTitle?: string;
  episodeCount?: number;
  absoluteSeasonOffset?: number;
  synonyms: string[];
  isAdult: boolean;
  startDate?: { year: number; month?: number; day?: number };
}

interface OnlineWorkerVariant {
  requestedDub?: boolean;
  searchResult?: { id?: string; title?: string; subOrDub?: string };
  episode?: { id?: string; number?: number; title?: string; url?: string };
  servers?: Array<{
    server?: string;
    headers?: Record<string, unknown>;
    videoSources?: Array<{
      url?: string;
      type?: string;
      quality?: string;
      label?: string;
      headers?: Record<string, unknown>;
      subtitles?: unknown[];
    }>;
  }>;
}

interface OnlineWorkerResult {
  variants?: OnlineWorkerVariant[];
  searchResult?: OnlineWorkerVariant["searchResult"];
  episode?: OnlineWorkerVariant["episode"];
  servers?: OnlineWorkerVariant["servers"];
}

interface TorrentWorkerResult {
  torrents?: Array<{
    name?: string;
    date?: string;
    size?: number;
    formattedSize?: string;
    seeders?: number;
    leechers?: number;
    downloadCount?: number;
    link?: string;
    downloadUrl?: string;
    magnetLink?: string;
    infoHash?: string;
    resolution?: string;
    isBatch?: boolean;
    episodeNumber?: number;
    releaseGroup?: string;
    isBestRelease?: boolean;
    confirmed?: boolean;
  }>;
}

type WorkerMessage =
  | { type: "http-request"; id: number; request: ProviderHttpRequest }
  | { type: "result"; value: unknown }
  | { type: "error"; error: string };

const DEFAULT_MANIFEST_URLS = [
  "https://raw.githubusercontent.com/kRYstall9/Seanime-streaming-providers/refs/heads/main/src/AnimeKai/manifest.json",
  "https://raw.githubusercontent.com/kRYstall9/Seanime-streaming-providers/refs/heads/main/src/AnimeSaturn/manifest.json",
  "https://raw.githubusercontent.com/kRYstall9/Seanime-streaming-providers/refs/heads/main/src/AnimeUnity/animeunity.json",
  "https://raw.githubusercontent.com/kRYstall9/Seanime-streaming-providers/refs/heads/main/src/AnimeWorld/manifest.json",
  "https://raw.githubusercontent.com/kRYstall9/Seanime-streaming-providers/refs/heads/main/src/GojoWtf/manifest.json",
  "https://island.clap.ing/api/extensions/anime-torrent-providers/seadex/seadex.json",
  "https://raw.githubusercontent.com/dot-fx/seanime-extensions/master/src/TPB/manifest.json",
  "https://island.clap.ing/api/extensions/anime-torrent-providers/nyaa/nyaa.json",
  "https://island.clap.ing/api/extensions/anime-torrent-providers/animetosho/animetosho.json",
];
const CONFIG_STORAGE_KEY = "aetherio-seanime-config";
const RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 60_000;
const ARM_API = "https://arm.haglund.dev/api/v2";

const textCache = new Map<string, Promise<string>>();
const manifestCache = new Map<string, Promise<SeanimeExtensionManifest>>();
const resultCache = new Map<string, { streams: MediaStream[]; updatedAt: number }>();

const WORKER_RUNTIME = String.raw`
"use strict";
globalThis.window = globalThis;
globalThis.global = globalThis;
importScripts(__DEPENDENCY_URL__, __TYPESCRIPT_DEPENDENCY_URL__);
const __deps = globalThis.__NUVIO_PROVIDER_DEPS__ || {};
let __httpSequence = 0;
const __httpPending = new Map();
let __userConfig = {};

class SeanimeBuffer extends Uint8Array {
  static from(value, encoding) {
    if (typeof value === "string") {
      const mode = String(encoding || "utf8").toLowerCase();
      if (mode === "base64" || mode === "base64url") {
        let encoded = value.replace(/-/g, "+").replace(/_/g, "/");
        encoded += "=".repeat((4 - encoded.length % 4) % 4);
        return new SeanimeBuffer(Array.from(atob(encoded), char => char.charCodeAt(0)));
      }
      if (mode === "hex") {
        const bytes = [];
        for (let index = 0; index + 1 < value.length; index += 2) bytes.push(parseInt(value.slice(index, index + 2), 16));
        return new SeanimeBuffer(bytes);
      }
      return new SeanimeBuffer(new TextEncoder().encode(value));
    }
    if (value instanceof ArrayBuffer) return new SeanimeBuffer(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return new SeanimeBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return new SeanimeBuffer(value || []);
  }
  toString(encoding) {
    const mode = String(encoding || "utf8").toLowerCase();
    if (mode === "hex") return Array.from(this, byte => byte.toString(16).padStart(2, "0")).join("");
    if (mode === "base64" || mode === "base64url") {
      let binary = "";
      for (let offset = 0; offset < this.length; offset += 8192) {
        binary += Array.from(this.subarray(offset, offset + 8192), byte => String.fromCharCode(byte)).join("");
      }
      const encoded = btoa(binary);
      return mode === "base64url" ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : encoded;
    }
    return new TextDecoder().decode(this);
  }
}
globalThis.Buffer = SeanimeBuffer;
globalThis.CryptoJS = __deps.CryptoJS;
globalThis.$toString = raw => {
  if (typeof raw === "string") return raw;
  if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) return SeanimeBuffer.from(raw).toString("utf8");
  try { return JSON.stringify(raw); } catch (_) { return String(raw); }
};
globalThis.$toBytes = raw => SeanimeBuffer.from(typeof raw === "string" ? raw : globalThis.$toString(raw));
function __wrapSelection($, selection) {
  const wrapped = { __selection: selection };
  const length = function() { return selection.length; };
  length.valueOf = () => selection.length;
  length.toString = () => String(selection.length);
  length[Symbol.toPrimitive] = () => selection.length;
  wrapped.length = length;
  wrapped.html = () => selection.html();
  wrapped.text = () => selection.text();
  wrapped.attr = name => selection.attr(name);
  wrapped.attrs = () => selection.get(0)?.attribs || {};
  wrapped.data = name => name == null
    ? Object.fromEntries(Object.entries(selection.get(0)?.attribs || {}).filter(([key]) => key.startsWith("data-")))
    : selection.attr("data-" + name);
  const selectionMethods = [
    "find", "children", "parent", "parents", "closest", "first", "last", "eq", "contents",
    "filter", "not", "has", "next", "nextAll", "prev", "prevAll", "siblings", "end"
  ];
  for (const method of selectionMethods) {
    wrapped[method] = (...args) => __wrapSelection($, selection[method](...args));
  }
  wrapped.parentsUntil = (...args) => __wrapSelection($, selection.parentsUntil(...args));
  wrapped.nextUntil = (...args) => __wrapSelection($, selection.nextUntil(...args));
  wrapped.prevUntil = (...args) => __wrapSelection($, selection.prevUntil(...args));
  wrapped.contentsFiltered = selector => __wrapSelection($, selection.contents().filter(selector));
  wrapped.is = selector => selection.is(selector);
  wrapped.each = callback => {
    selection.each((index, element) => callback(index, __wrapSelection($, $(element))));
    return wrapped;
  };
  wrapped.map = callback => selection.map((index, element) => callback(index, __wrapSelection($, $(element)))).get();
  return wrapped;
}
globalThis.LoadDoc = html => {
  const $ = __deps.cheerio.load(String(html || ""));
  return selector => {
    if (selector && selector.__selection) return __wrapSelection($, selector.__selection);
    return __wrapSelection($, $(String(selector || "")));
  };
};
globalThis.Doc = function(html) {
  const query = globalThis.LoadDoc(html);
  return query("html");
};
globalThis.load = globalThis.LoadDoc;
globalThis.$getUserPreference = key => __userConfig[String(key)];
globalThis.$sleep = milliseconds => new Promise(resolve => setTimeout(resolve, Number(milliseconds) || 0));
globalThis.$isOffline = () => false;
const __searchSyntax = /[()[\]{}|"'~*?\\^!]/g;
const __noiseWords = /\b(?:1080p|720p|480p|2160p|bluray|blu-ray|webrip|web-dl|webdl|hdtv|x264|x265|hevc|av1|aac|flac|multi|dual audio|subbed|dubbed)\b/gi;
const __cleanSearch = value => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(__searchSyntax, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
const __extractSeason = value => {
  const text = String(value || "");
  const match = text.match(/(?:\bseason\s*|\bs)(\d{1,2})\b/i) || text.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  return match ? Number(match[1]) : -1;
};
const __extractPart = value => {
  const match = String(value || "").match(/\b(?:part|cour)\s*(\d{1,2})\b/i) || String(value || "").match(/\b(\d{1,2})(?:st|nd|rd|th)\s+(?:part|cour)\b/i);
  return match ? Number(match[1]) : -1;
};
const __baseSearchTitle = value => __cleanSearch(value)
  .replace(/\b(?:season\s*\d+|s\d{1,2}|\d+(?:st|nd|rd|th)\s+season)\b/gi, " ")
  .replace(/\b(?:part|cour)\s*\d+\b/gi, " ")
  .replace(__noiseWords, " ").replace(/\s+/g, " ").trim();
globalThis.$scannerUtils = {
  normalizeTitle(value) {
    const original = String(value || "");
    const normalized = __cleanSearch(original).toLowerCase();
    const cleanBaseTitle = __baseSearchTitle(original);
    return {
      original,
      normalized,
      cleanBaseTitle,
      denoisedTitle: cleanBaseTitle,
      tokens: cleanBaseTitle.toLowerCase().split(/\s+/).filter(Boolean),
      season: __extractSeason(original),
      part: __extractPart(original),
      year: Number(original.match(/\b(?:19|20)\d{2}\b/)?.[0] || -1),
      isMain: true
    };
  },
  extractPartNumber: __extractPart,
  extractSeasonNumber: __extractSeason,
  extractYear: value => Number(String(value || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || -1),
  compareTitles(left, right) {
    const a = new Set(__baseSearchTitle(left).toLowerCase().split(/\s+/).filter(Boolean));
    const b = new Set(__baseSearchTitle(right).toLowerCase().split(/\s+/).filter(Boolean));
    if (!a.size || !b.size) return 0;
    const shared = Array.from(a).filter(token => b.has(token)).length;
    return (2 * shared) / (a.size + b.size);
  },
  findBestMatch(target, candidates) {
    return (Array.isArray(candidates) ? candidates : []).slice().sort((left, right) =>
      globalThis.$scannerUtils.compareTitles(target, right) - globalThis.$scannerUtils.compareTitles(target, left)
    )[0] || "";
  },
  getSignificantTokens: value => __baseSearchTitle(value).toLowerCase().split(/\s+/).filter(Boolean),
  buildSearchQuery: __baseSearchTitle,
  buildAdvancedQuery(titles) {
    const values = Array.from(new Set((Array.isArray(titles) ? titles : []).map(__baseSearchTitle).filter(Boolean)));
    return values.length > 1 ? "(" + values.join(" | ") + ")" : values[0] || "";
  },
  sanitizeQuery: __cleanSearch,
  buildSeasonQuery(title, season) {
    const base = __baseSearchTitle(title);
    if (Number(season) <= 1) return base;
    return "(" + [base + " S" + String(season).padStart(2, "0"), base + " S" + season, base + " Season " + season].join(" | ") + ")";
  },
  buildPartQuery(title, part) {
    const base = __baseSearchTitle(title);
    return Number(part) <= 1 ? base : "(" + base + " Part " + part + " | " + base + " Cour " + part + ")";
  },
  buildSmartSearchTitles(titles) {
    const values = Array.isArray(titles) ? titles.filter(Boolean) : [];
    const season = values.map(__extractSeason).find(value => value > 0) || -1;
    const part = values.map(__extractPart).find(value => value > 0) || -1;
    const output = [];
    for (const value of values) {
      const clean = __baseSearchTitle(value);
      if (clean && !output.some(item => item.toLowerCase() === clean.toLowerCase())) output.push(clean);
      const short = clean.split(/\s*:\s*/)[0];
      if (short && !output.some(item => item.toLowerCase() === short.toLowerCase())) output.push(short);
    }
    return { titles: output, season, part };
  }
};
globalThis.$habari = {
  parse(value) {
    const fileName = String(value || "");
    const releaseGroup = fileName.match(/^\s*\[([^\]]+)\]/)?.[1];
    const resolution = fileName.match(/\b(2160p|1080p|720p|576p|480p|360p)\b/i)?.[1];
    const season = __extractSeason(fileName);
    const part = __extractPart(fileName);
    const episode = fileName.match(/\bS\d{1,2}E(\d{1,4}(?:\.\d+)?)\b/i)?.[1]
      || fileName.match(/(?:\s-\s|\bEP?\s*)(\d{1,4}(?:\.\d+)?)\b/i)?.[1];
    const extension = fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    let title = fileName.replace(/^\s*\[[^\]]+\]\s*/, " ").replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
    title = title.replace(/\bS\d{1,2}E\d{1,4}(?:\.\d+)?\b/ig, " ").replace(/(?:\s-\s|\bEP?\s*)\d{1,4}(?:\.\d+)?\b/i, " ");
    title = title.replace(__noiseWords, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
    const lower = fileName.toLowerCase();
    return {
      title,
      formatted_title: title,
      file_name: fileName,
      file_extension: extension,
      release_group: releaseGroup,
      season_number: season > 0 ? [String(season)] : [],
      part_number: part > 0 ? [String(part)] : [],
      episode_number: episode ? [episode] : [],
      video_resolution: resolution,
      audio_term: /dual[ ._-]*audio|multi[ ._-]*audio/i.test(fileName) ? ["Dual Audio"] : [],
      language: [lower.includes("latino") || lower.includes("spanish") ? "Spanish" : lower.includes("english") ? "English" : "Japanese"],
      subtitles: /(?:sub|subs|subbed)/i.test(fileName) ? [lower.includes("spanish") || lower.includes("latino") ? "Spanish" : "English"] : []
    };
  }
};

function __headers(value) {
  const output = {};
  if (!value) return output;
  if (value instanceof Headers) value.forEach((headerValue, key) => { output[key] = headerValue; });
  else if (Array.isArray(value)) for (const pair of value) if (Array.isArray(pair) && pair.length > 1) output[String(pair[0])] = String(pair[1]);
  else if (typeof value === "object") for (const key of Object.keys(value)) if (value[key] != null) output[key] = String(value[key]);
  return output;
}

async function __body(value) {
  if (value == null) return {};
  if (typeof value === "string") return { body: value, bodyBase64: false };
  if (value instanceof URLSearchParams) return { body: value.toString(), bodyBase64: false };
  let bytes;
  if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else return { body: String(value), bodyBase64: false };
  return { body: SeanimeBuffer.from(bytes).toString("base64"), bodyBase64: true };
}

globalThis.fetch = async function(input, init) {
  const options = init || {};
  const inputRequest = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const url = inputRequest ? inputRequest.url : String(input);
  const headers = Object.assign({}, __headers(inputRequest && inputRequest.headers), __headers(options.headers));
  const serializedBody = await __body(options.body !== undefined ? options.body : inputRequest && inputRequest.body);
  const id = ++__httpSequence;
  const responseData = await new Promise((resolve, reject) => {
    __httpPending.set(id, { resolve, reject });
    postMessage({ type: "http-request", id, request: Object.assign({
      url,
      method: String(options.method || (inputRequest && inputRequest.method) || "GET"),
      headers
    }, serializedBody) });
  });
  const binary = atob(responseData.bodyBase64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const text = new TextDecoder().decode(bytes);
  const responseHeaders = responseData.headers || {};
  const cookies = {};
  const setCookie = responseHeaders["set-cookie"] || responseHeaders["Set-Cookie"] || "";
  const cookiePattern = /(?:^|,\s*)([^=;,\s]+)=([^;]*)/g;
  let cookieMatch;
  while ((cookieMatch = cookiePattern.exec(setCookie))) cookies[cookieMatch[1]] = cookieMatch[2];
  return {
    status: responseData.status,
    statusText: String(responseData.statusText || ""),
    method: String(options.method || (inputRequest && inputRequest.method) || "GET"),
    rawHeaders: Object.fromEntries(Object.entries(responseHeaders).map(([key, value]) => [key, [String(value)]])),
    ok: responseData.status >= 200 && responseData.status < 300,
    url: responseData.url,
    headers: responseHeaders,
    cookies,
    redirected: responseData.url !== url,
    contentType: responseHeaders["content-type"] || responseHeaders["Content-Type"] || "",
    contentLength: bytes.length,
    text: () => text,
    json: () => JSON.parse(text)
  };
};

function __cloneable(value) {
  return JSON.parse(JSON.stringify(value, (_key, candidate) => {
    if (typeof candidate === "function" || typeof candidate === "symbol") return undefined;
    if (candidate instanceof Headers) return Object.fromEntries(candidate.entries());
    if (candidate instanceof URL) return candidate.toString();
    return candidate;
  }));
}

async function __mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try { results[index] = await task(items[index], index); }
      catch (_) { results[index] = null; }
    }
  }));
  return results.filter(Boolean);
}

async function __runOnline(provider, args) {
  const settings = await provider.getSettings();
  const normalizeTitle = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const wantedTitle = normalizeTitle(args.title);
  const score = item => {
    const title = normalizeTitle(item && item.title);
    if (title === wantedTitle) return 4;
    if (title.startsWith(wantedTitle) || wantedTitle.startsWith(title)) return 3;
    if (title.includes(wantedTitle) || wantedTitle.includes(title)) return 2;
    return 0;
  };
  const modes = [false].concat(settings && settings.supportsDub ? [true] : []);
  const searches = await __mapLimit(modes, 2, async requestedDub => ({
    requestedDub,
    results: await provider.search({ media: args.media, query: args.title, dub: requestedDub, year: args.year })
  }));
  const candidates = [];
  const seen = new Set();
  for (const search of searches) {
    const results = (Array.isArray(search.results) ? search.results : []).filter(Boolean).sort((left, right) => score(right) - score(left));
    const matchingMode = results.find(item => search.requestedDub
      ? item.subOrDub === "dub" || item.subOrDub === "both"
      : item.subOrDub !== "dub");
    const preferred = matchingMode || results[0];
    if (!preferred) continue;
    const key = String(preferred.id) + "|" + String(preferred.subOrDub || (search.requestedDub ? "dub" : "sub"));
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ requestedDub: search.requestedDub, searchResult: preferred });
  }
  const variants = await __mapLimit(candidates, 2, async candidate => {
    const episodes = await provider.findEpisodes(candidate.searchResult.id);
    const episode = (episodes || []).find(item => Number(item.number) === Number(args.episode))
      || (episodes || [])[Math.max(0, Number(args.episode) - 1)];
    if (!episode) return Object.assign({}, candidate, { servers: [] });
    const serverNames = settings && Array.isArray(settings.episodeServers) && settings.episodeServers.length
      ? settings.episodeServers
      : ["default"];
    const servers = await __mapLimit(serverNames, 3, server => provider.findEpisodeServer(episode, server));
    return Object.assign({}, candidate, { episode, servers });
  });
  return { variants };
}

async function __runTorrent(provider, args) {
  const settings = await provider.getSettings();
  const smartOptions = {
    media: args.media,
    query: args.title,
    batch: false,
    episodeNumber: args.episode,
    resolution: "",
    anidbAID: 0,
    anidbEID: 0,
    bestReleases: true
  };
  let torrents = settings && settings.canSmartSearch
    ? await provider.smartSearch(smartOptions)
    : await provider.search({ media: args.media, query: args.title });
  torrents = Array.isArray(torrents) ? torrents.slice(0, 40) : [];
  torrents = await __mapLimit(torrents, 5, async torrent => {
    const result = Object.assign({}, torrent);
    if (!result.infoHash && typeof provider.getTorrentInfoHash === "function") {
      try { result.infoHash = await provider.getTorrentInfoHash(result); } catch (_) {}
    }
    if (!result.magnetLink && typeof provider.getTorrentMagnetLink === "function") {
      try { result.magnetLink = await provider.getTorrentMagnetLink(result); } catch (_) {}
    }
    return result;
  });
  return { torrents };
}

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === "http-response") {
    const pending = __httpPending.get(message.id);
    if (!pending) return;
    __httpPending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.response);
    return;
  }
  if (message.type !== "run") return;
  try {
    __userConfig = message.userConfig || {};
    const compiled = message.language === "typescript"
      ? __deps.ts.transpileModule(message.source, {
          compilerOptions: { target: __deps.ts.ScriptTarget.ES2020, module: __deps.ts.ModuleKind.None }
        }).outputText
      : message.source;
    (0, eval)(compiled + "\nglobalThis.__SeanimeProvider = Provider;");
    if (typeof globalThis.__SeanimeProvider !== "function") throw new Error("El payload no declara la clase Provider");
    const provider = new globalThis.__SeanimeProvider();
    const value = message.providerType === "onlinestream-provider"
      ? await __runOnline(provider, message.args)
      : await __runTorrent(provider, message.args);
    postMessage({ type: "result", value: __cloneable(value) });
  } catch (error) {
    postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
`;

function storageKey(key: string) {
  const legacyKey = getScopedStorageKey(key);
  if (legacyKey !== key && localStorage.getItem(key) === null) {
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue !== null) localStorage.setItem(key, legacyValue);
  }
  return key;
}

export function getInstalledSeanimeManifestUrls() {
  return [...DEFAULT_MANIFEST_URLS];
}

export function clearSeanimeCaches() {
  textCache.clear();
  manifestCache.clear();
  resultCache.clear();
}

function decodeBase64Text(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function providerHttp(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
  return invokeCommand<ProviderHttpResponse>("provider_http_request", { request });
}

function fetchText(url: string, refresh = false): Promise<string> {
  if (refresh) textCache.delete(url);
  const cached = textCache.get(url);
  if (cached) return cached;
  const pending = providerHttp({ url, method: "GET" })
    .then(response => {
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return decodeBase64Text(response.bodyBase64);
    })
    .catch(error => {
      textCache.delete(url);
      throw error;
    });
  textCache.set(url, pending);
  return pending;
}

function normalizeManifest(raw: unknown, sourceUrl: string): SeanimeExtensionManifest {
  if (!raw || typeof raw !== "object") throw new Error("Manifest Seanime invalido");
  const manifest = raw as Record<string, unknown>;
  if (manifest.type !== "anime-torrent-provider" && manifest.type !== "onlinestream-provider") {
    throw new Error("El manifest no es un provider de anime compatible");
  }
  if (typeof manifest.id !== "string" || !manifest.id.trim() || typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new Error("El manifest no tiene id o nombre");
  }
  const language = manifest.language === "typescript" ? "typescript" : "javascript";
  const manifestURI = typeof manifest.manifestURI === "string" && manifest.manifestURI.trim()
    ? new URL(manifest.manifestURI, sourceUrl).toString()
    : sourceUrl;
  return {
    ...manifest,
    id: manifest.id,
    name: manifest.name,
    version: typeof manifest.version === "string" ? manifest.version : "0.0.0",
    manifestURI,
    language,
    type: manifest.type,
    payload: typeof manifest.payload === "string" ? manifest.payload : undefined,
    payloadURI: typeof manifest.payloadURI === "string" ? new URL(manifest.payloadURI, sourceUrl).toString() : undefined,
  } as SeanimeExtensionManifest;
}

function loadManifest(url: string, refresh = false): Promise<SeanimeExtensionManifest> {
  if (refresh) manifestCache.delete(url);
  const cached = manifestCache.get(url);
  if (cached) return cached;
  const pending = fetchText(url, refresh)
    .then(text => normalizeManifest(JSON.parse(text), url))
    .catch(error => {
      manifestCache.delete(url);
      throw error;
    });
  manifestCache.set(url, pending);
  return pending;
}

export async function getSeanimeExtensionInventory(refresh = false): Promise<SeanimeExtensionInventory> {
  if (!isTauriRuntime()) return { installed: [], errors: [] };
  if (refresh) clearSeanimeCaches();
  const errors: string[] = [];
  const manifestUrls = getInstalledSeanimeManifestUrls();
  const installedResults = await Promise.allSettled(manifestUrls.map(url => loadManifest(url, refresh)));
  const installed = installedResults.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    errors.push(`${manifestUrls[index]}: ${String(result.reason)}`);
    return [];
  });
  return { installed, errors };
}

function getUserConfig(manifest: SeanimeExtensionManifest): Record<string, string> {
  let saved: Record<string, Record<string, string>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(CONFIG_STORAGE_KEY)) ?? "{}") as Record<string, Record<string, string>>;
  } catch {}
  return Object.fromEntries((manifest.userConfig?.fields ?? []).map(field => [
    field.name,
    saved[manifest.id]?.[field.name] ?? field.default ?? "",
  ]));
}

export function getSeanimeExtensionUserConfig(manifest: SeanimeExtensionManifest) {
  return getUserConfig(manifest);
}

export function saveSeanimeExtensionUserConfig(manifest: SeanimeExtensionManifest, values: Record<string, string>) {
  let saved: Record<string, Record<string, string>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey(CONFIG_STORAGE_KEY)) ?? "{}") as Record<string, Record<string, string>>;
  } catch {}
  const allowedFields = new Set((manifest.userConfig?.fields ?? []).map(field => field.name));
  saved[manifest.id] = Object.fromEntries(
    Object.entries(values).filter(([name, value]) => allowedFields.has(name) && typeof value === "string"),
  );
  localStorage.setItem(storageKey(CONFIG_STORAGE_KEY), JSON.stringify(saved));
  resultCache.clear();
}

function applyUserConfig(source: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (current, [key, value]) => current.split(`{{${key}}}`).join(value),
    source,
  );
}

async function loadPayload(manifest: SeanimeExtensionManifest) {
  const source = manifest.payload ?? (manifest.payloadURI ? await fetchText(manifest.payloadURI) : "");
  if (!source.trim()) throw new Error(`El provider ${manifest.name} no tiene payload`);
  return applyUserConfig(source, getUserConfig(manifest));
}

async function runExtension<T>(manifest: SeanimeExtensionManifest, args: Record<string, unknown>): Promise<T> {
  const source = await loadPayload(manifest);
  const dependencyUrl = new URL("nuvio-provider-deps.js", window.location.href).toString();
  const typescriptDependencyUrl = new URL("seanime-typescript-deps.js", window.location.href).toString();
  const runtime = WORKER_RUNTIME
    .replace("__DEPENDENCY_URL__", JSON.stringify(dependencyUrl))
    .replace("__TYPESCRIPT_DEPENDENCY_URL__", JSON.stringify(typescriptDependencyUrl));
  const blob = new Blob([runtime], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl, { name: `seanime-${manifest.id}` });
  URL.revokeObjectURL(workerUrl);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      callback();
    };
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error(`${manifest.name} excedio ${PROVIDER_TIMEOUT_MS / 1000}s`))),
      PROVIDER_TIMEOUT_MS,
    );
    worker.onerror = event => finish(() => reject(new Error(event.message || `${manifest.name} fallo`)));
    worker.onmessage = event => {
      const message = event.data as WorkerMessage;
      if (message.type === "http-request") {
        void providerHttp({ ...message.request, sessionKey: `seanime:${manifest.id}` })
          .then(response => worker.postMessage({ type: "http-response", id: message.id, response }))
          .catch(error => worker.postMessage({ type: "http-response", id: message.id, error: String(error) }));
        return;
      }
      if (message.type === "result") finish(() => resolve(message.value as T));
      if (message.type === "error") finish(() => reject(new Error(message.error)));
    };
    worker.postMessage({
      type: "run",
      source,
      language: manifest.language,
      providerType: manifest.type,
      userConfig: getUserConfig(manifest),
      args,
    });
  });
}

function parseId(query: StreamQuery, prefix: string) {
  const match = query.id.match(new RegExp(`^${prefix}:(\\d+)`, "i"));
  return match ? Number(match[1]) : undefined;
}

interface TmdbAnimeContext {
  imdbId: string | null;
  originalTitle?: string;
  year?: number;
}

async function resolveTmdbAnimeContext(query: StreamQuery): Promise<TmdbAnimeContext | null> {
  const tmdbId = parseId(query, "tmdb");
  if (!tmdbId) return null;
  const mediaType = query.type === "movie" ? "movie" : "tv";
  const json = await tmdbFetch(`/${mediaType}/${tmdbId}`, {
    params: { append_to_response: "external_ids" },
  });
  if (!json) return null;
  const date = String(json.release_date ?? json.first_air_date ?? "");
  const parsedYear = Number(date.slice(0, 4));
  const imdbId = json.external_ids?.imdb_id ?? json.imdb_id;
  return {
    imdbId: typeof imdbId === "string" && /^tt\d+$/i.test(imdbId) ? imdbId : null,
    originalTitle: typeof (json.original_name ?? json.original_title) === "string"
      ? String(json.original_name ?? json.original_title)
      : undefined,
    year: Number.isFinite(parsedYear) && parsedYear > 1900 ? parsedYear : undefined,
  };
}

async function resolveImdbId(query: StreamQuery, tmdbContext?: TmdbAnimeContext | null) {
  const direct = query.id.replace(/^imdb:/i, "");
  if (/^tt\d+$/i.test(direct)) return direct;
  return tmdbContext?.imdbId ?? null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await providerHttp({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) return null;
  return JSON.parse(decodeBase64Text(response.bodyBase64)) as T;
}

async function searchAnilistId(title: string, year?: number): Promise<number | undefined> {
  if (!title.trim()) return undefined;
  const response = await providerHttp({
    url: "https://graphql.anilist.co",
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: "query ($search: String, $seasonYear: Int) { Page(page: 1, perPage: 8) { media(search: $search, seasonYear: $seasonYear, type: ANIME, sort: SEARCH_MATCH) { id } } }",
      variables: { search: title.trim(), seasonYear: year ?? null },
    }),
  });
  if (response.status < 200 || response.status >= 300) return undefined;
  const id = Number(JSON.parse(decodeBase64Text(response.bodyBase64))?.data?.Page?.media?.[0]?.id);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

async function resolveAnimeMedia(query: StreamQuery, title: string): Promise<SeanimeMedia> {
  let anilistId = parseId(query, "anilist");
  let malId = parseId(query, "mal");
  const kitsuId = parseId(query, "kitsu");
  type ArmEntry = { anilist?: number; myanimelist?: number };
  let arm: ArmEntry | null = null;
  const tmdbContext = await resolveTmdbAnimeContext(query).catch(() => null);
  if (malId) {
    arm = await fetchJson<ArmEntry>(`${ARM_API}/ids?source=myanimelist&id=${malId}&include=anilist`).catch(() => null);
  } else if (kitsuId) {
    arm = await fetchJson<ArmEntry>(`${ARM_API}/ids?source=kitsu&id=${kitsuId}&include=myanimelist,anilist`).catch(() => null);
  } else {
    const imdbId = await resolveImdbId(query, tmdbContext).catch(() => null);
    if (imdbId) {
      const entries = await fetchJson<ArmEntry[]>(`${ARM_API}/imdb?id=${encodeURIComponent(imdbId)}&include=myanimelist,anilist`).catch(() => null);
      arm = entries?.[query.season ? query.season - 1 : 0] ?? entries?.[0] ?? null;
    }
  }
  anilistId ??= arm?.anilist;
  malId ??= arm?.myanimelist;
  if (!anilistId) {
    const candidateTitles = [tmdbContext?.originalTitle, title]
      .filter((value): value is string => Boolean(value?.trim()));
    for (const candidate of [...new Set(candidateTitles)]) {
      anilistId = await searchAnilistId(candidate, tmdbContext?.year).catch(() => undefined);
      if (anilistId) break;
    }
  }

  const fallback: SeanimeMedia = {
    id: anilistId ?? 0,
    idMal: malId,
    englishTitle: title,
    romajiTitle: title,
    synonyms: [],
    isAdult: false,
  };
  if (!anilistId) return fallback;

  const graphql = {
    query: "query ($id: Int) { Media(id: $id, type: ANIME) { id idMal status format episodes synonyms isAdult startDate { year month day } title { english romaji } } }",
    variables: { id: anilistId },
  };
  try {
    const response = await providerHttp({
      url: "https://graphql.anilist.co",
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(graphql),
    });
    if (response.status < 200 || response.status >= 300) return fallback;
    const media = JSON.parse(decodeBase64Text(response.bodyBase64))?.data?.Media;
    if (!media) return fallback;
    return {
      id: media.id,
      idMal: media.idMal ?? malId,
      status: media.status,
      format: media.format,
      englishTitle: media.title?.english ?? title,
      romajiTitle: media.title?.romaji ?? title,
      episodeCount: media.episodes,
      synonyms: Array.isArray(media.synonyms) ? media.synonyms : [],
      isAdult: Boolean(media.isAdult),
      startDate: media.startDate?.year ? media.startDate : undefined,
    };
  } catch {
    return fallback;
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim())));
}

function normalizeSubtitles(value: unknown): StreamSubtitle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const subtitle = item as Record<string, unknown>;
    if (typeof subtitle.url !== "string" || !/^https?:\/\//i.test(subtitle.url)) return [];
    return [{
      id: typeof subtitle.id === "string" ? subtitle.id : `seanime-sub-${index}`,
      url: subtitle.url,
      lang: typeof subtitle.language === "string" ? subtitle.language : undefined,
      title: typeof subtitle.language === "string" ? subtitle.language : undefined,
    }];
  });
}

function normalizeOnlineVariant(manifest: SeanimeExtensionManifest, variant: OnlineWorkerVariant, variantIndex: number): MediaStream[] {
  const mode = variant.searchResult?.subOrDub === "both"
    ? "Sub + Dub"
    : variant.searchResult?.subOrDub === "dub" || variant.requestedDub
      ? "Dub"
      : "Sub";
  return (variant.servers ?? []).flatMap((server, serverIndex) => (server.videoSources ?? []).flatMap((source, sourceIndex) => {
    if (typeof source.url !== "string" || !/^https?:\/\//i.test(source.url)) return [];
    const headers = { ...stringRecord(server.headers), ...stringRecord(source.headers) };
    const quality = source.quality || source.label || source.type;
    const name = [manifest.name, mode, server.server].filter(Boolean).join(" - ");
    return [{
      id: `seanime|${manifest.id}|${variantIndex}|${serverIndex}|${sourceIndex}|${source.url}`,
      addonId: `seanime:${manifest.id}`,
      addonName: manifest.name,
      name,
      title: [variant.searchResult?.title, variant.episode?.title, mode, quality].filter(Boolean).join(" - ") || name,
      description: [mode, quality, manifest.lang?.toUpperCase()].filter(Boolean).join(" - "),
      url: source.url,
      languages: manifest.lang ? [manifest.lang] : undefined,
      subtitles: normalizeSubtitles(source.subtitles),
      behaviorHints: {
        filename: `${variant.searchResult?.title ?? manifest.name} E${variant.episode?.number ?? ""}`,
        headers,
        referrer: headers.Referer ?? headers.referer,
        seanimeProviderType: manifest.type,
        seanimeManifest: manifest.manifestURI,
        seanimeProvider: manifest.id,
        providerHttpSessionKey: `seanime:${manifest.id}`,
        seanimeServer: server.server,
        seanimeSubOrDub: variant.searchResult?.subOrDub ?? (variant.requestedDub ? "dub" : "sub"),
        seanimeEpisode: variant.episode?.number,
        seanimeQuality: quality,
        scraperPlayback: "direct",
      },
    } satisfies MediaStream];
  }));
}

function normalizeOnline(manifest: SeanimeExtensionManifest, result: OnlineWorkerResult): MediaStream[] {
  const variants = result.variants?.length
    ? result.variants
    : [{ searchResult: result.searchResult, episode: result.episode, servers: result.servers }];
  return variants.flatMap((variant, index) => normalizeOnlineVariant(manifest, variant, index));
}

function infoHashFromMagnet(magnet?: string) {
  return getMagnetBtih(magnet);
}

function normalizeTorrents(manifest: SeanimeExtensionManifest, result: TorrentWorkerResult): MediaStream[] {
  return (result.torrents ?? []).flatMap((torrent, index) => {
    const magnet = typeof torrent.magnetLink === "string" && isValidMagnetUri(torrent.magnetLink)
      ? torrent.magnetLink.trim()
      : undefined;
    const infoHash = normalizeBtih(torrent.infoHash) ?? infoHashFromMagnet(magnet);
    const seeders = normalizeSeederCount(torrent.seeders);
    if (!magnet && !infoHash) return [];
    const details = [
      torrent.resolution,
      torrent.formattedSize,
      seeders !== undefined ? `${seeders} seeders` : undefined,
      torrent.releaseGroup,
    ].filter(Boolean).join(" - ");
    return [{
      id: `seanime|${manifest.id}|${infoHash ?? index}`,
      addonId: `seanime:${manifest.id}`,
      addonName: manifest.name,
      name: manifest.name,
      title: torrent.name || manifest.name,
      description: details,
      size: typeof torrent.size === "number" && Number.isFinite(torrent.size) && torrent.size > 0 ? torrent.size : undefined,
      infoHash,
      seeders,
      sources: magnet ? [magnet] : undefined,
      behaviorHints: {
        filename: torrent.name,
        videoSize: torrent.size,
        seeders,
        leechers: torrent.leechers,
        releaseGroup: torrent.releaseGroup,
        seanimeProviderType: manifest.type,
        seanimeManifest: manifest.manifestURI,
      },
    } satisfies MediaStream];
  });
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

export async function scrapeSeanimeExtensions(
  query: StreamQuery,
  title: string,
  extensionIds?: string[],
): Promise<MediaStream[]> {
  if (!isTauriRuntime() || !title.trim()) return [];
  const isAnime = query.type === "anime" || /^(mal|kitsu|anilist|tmdb|imdb):/i.test(query.id);
  if (!isAnime || (extensionIds && extensionIds.length === 0)) return [];
  const cacheKey = [query.id, query.season ?? "", query.episode ?? "", title, extensionIds?.slice().sort().join(",") ?? "all"].join("|");
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.updatedAt < RESULT_CACHE_TTL_MS) return cached.streams;

  const selected = extensionIds ? new Set(extensionIds) : null;
  const inventory = await getSeanimeExtensionInventory();
  const manifests = inventory.installed.filter(manifest => !selected || selected.has(manifest.id));
  const media = await resolveAnimeMedia(query, title.trim());
  const encodedEpisode = Number(query.id.match(/^(?:mal|kitsu|anilist):\d+:(\d+)/i)?.[1]);
  const episode = encodedEpisode || query.episode || 1;
  const args = {
    media,
    title: title.trim(),
    episode,
    year: media.startDate?.year,
  };
  const batches = await mapWithConcurrency(manifests, 3, async manifest => {
    try {
      if (manifest.type === "onlinestream-provider") {
        return {
          streams: normalizeOnline(manifest, await runExtension<OnlineWorkerResult>(manifest, args)),
          succeeded: true,
        };
      }
      return {
        streams: normalizeTorrents(manifest, await runExtension<TorrentWorkerResult>(manifest, args)),
        succeeded: true,
      };
    } catch (error) {
      console.warn("[AETHERIO:SEANIME] provider failed", manifest.id, String(error));
      return { streams: [] as MediaStream[], succeeded: false };
    }
  });
  const seen = new Set<string>();
  const streams = batches.flatMap(batch => batch.streams).filter(stream => {
    const key = stream.url ?? stream.infoHash ?? stream.sources?.[0] ?? stream.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const requestedExtensionCount = extensionIds ? new Set(extensionIds).size : manifests.length;
  const inventoryComplete = inventory.errors.length === 0 && manifests.length === requestedExtensionCount;
  const allProvidersSucceeded = inventoryComplete
    && batches.length === manifests.length
    && batches.every(batch => batch.succeeded);
  if (streams.length > 0 && allProvidersSucceeded) {
    resultCache.set(cacheKey, { streams, updatedAt: Date.now() });
  } else {
    // Un resultado vacio o parcial debe poder reintentarse inmediatamente.
    resultCache.delete(cacheKey);
  }
  return streams;
}

export { DEFAULT_MANIFEST_URLS };
