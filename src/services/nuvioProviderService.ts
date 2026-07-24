import { tmdbFetch } from "../config/apiKeys.ts";
import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { MediaStream, StreamQuery, StreamSubtitle } from "../types/stream.ts";

interface ProviderManifestSource {
  key: string;
  fallbackName: string;
  url: string;
  custom?: boolean;
}

const CUSTOM_PROVIDER_REPOSITORIES_KEY = "aetherio-custom-provider-repositories";
const PROVIDER_MANIFEST_SOURCES: readonly ProviderManifestSource[] = [
  {
    key: "yoruix",
    fallbackName: "Yoru",
    url: "https://raw.githubusercontent.com/yoruix/nuvio-providers/refs/heads/main/manifest.json",
  },
  {
    key: "adrianjael",
    fallbackName: "Adrian",
    url: "https://raw.githubusercontent.com/adrianjael/pluggin-latino/refs/heads/main/manifest.json",
  },
  {
    key: "kennethjys",
    fallbackName: "Kenneth",
    url: "https://raw.githubusercontent.com/KennethJYS/Nuvio-Providers-Latino/refs/heads/main/manifest.json",
  },
] as const;
const PROVIDER_MANIFEST_URLS = PROVIDER_MANIFEST_SOURCES.map(source => source.url);
const PROVIDER_CONCURRENCY = 14;
const PROVIDER_TIMEOUT_MS = 15_000;
const RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const OKRU_SIGNED_RESULT_CACHE_TTL_MS = 30 * 1000;
const SIGNED_RESULT_CACHE_TTL_MS = 2 * 60 * 1000;
const EMPTY_PROVIDER_CACHE_TTL_MS = 90 * 1000;
const FAILED_PROVIDER_COOLDOWN_MS = 20 * 1000;
const DEBUG_PROVIDERS = import.meta.env.DEV;

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

interface ProviderManifest {
  name: string;
  version: string;
  scrapers: ProviderManifestEntry[];
}

interface ProviderManifestEntry {
  id: string;
  name: string;
  description?: string;
  filename: string;
  enabled?: boolean;
  supportedTypes?: string[];
  contentLanguage?: string[];
  supportsExternalPlayer?: boolean;
}

interface ProviderDefinition {
  key: string;
  ownerName: string;
  repositoryName: string;
  manifestUrl: string;
  scriptUrl: string;
  scraper: ProviderManifestEntry;
}

export interface NuvioProviderScraperInfo {
  key: string;
  id: string;
  name: string;
  description?: string;
  supportedTypes: string[];
  contentLanguage: string[];
  enabledByManifest: boolean;
  supportsExternalPlayer: boolean;
}

export interface NuvioProviderRepositoryInfo {
  key: string;
  ownerName: string;
  name: string;
  version?: string;
  manifestUrl: string;
  scrapers: NuvioProviderScraperInfo[];
  custom?: boolean;
  error?: string;
}

export interface ProviderStreamOrigin {
  kind: "cloudstream";
  repositoryName: string;
  repositoryUrl: string;
  pluginName: string;
  language: string;
}

export interface ProviderBatchStatus {
  providerCount: number;
  failedProviderCount: number;
  streamCount: number;
  fromCache: boolean;
}

interface RawProviderStream {
  url?: unknown;
  externalUrl?: unknown;
  name?: unknown;
  title?: unknown;
  quality?: unknown;
  headers?: unknown;
  subtitles?: unknown;
  subtitle?: unknown;
  type?: unknown;
  verified?: unknown;
  size?: unknown;
  folderSize?: unknown;
  indexer?: unknown;
  duration?: unknown;
  languages?: unknown;
  language?: unknown;
  behaviorHints?: unknown;
}

type WorkerMessage =
  | { type: "http-request"; id: number; request: ProviderHttpRequest }
  | { type: "result"; value: unknown }
  | { type: "error"; error: string };

const scriptCache = new Map<string, Promise<string>>();
const manifestCache = new Map<string, Promise<ProviderManifest>>();
const resultCache = new Map<string, { streams: MediaStream[]; updatedAt: number; ttlMs: number }>();
type ProviderExecutionStatus = "success" | "empty" | "error";
interface ProviderExecutionCacheEntry {
  streams: MediaStream[];
  status: ProviderExecutionStatus;
  updatedAt: number;
  ttlMs: number;
}
interface ProviderRuntimeHealth {
  successes: number;
  failures: number;
  totalDurationMs: number;
  lastSuccessAt: number;
}
const providerExecutionCache = new Map<string, ProviderExecutionCacheEntry>();
const providerRuntimeHealth = new Map<string, ProviderRuntimeHealth>();
let repositoriesPromise: Promise<NuvioProviderRepositoryInfo[]> | null = null;
let definitionsPromise: Promise<ProviderDefinition[]> | null = null;

function customRepositoryKey(url: string) {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `custom-${(hash >>> 0).toString(36)}`;
}

export function getCustomNuvioProviderRepositoryUrls(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_PROVIDER_REPOSITORIES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && /^https?:\/\//i.test(value))
      : [];
  } catch {
    return [];
  }
}

function providerManifestSources(): ProviderManifestSource[] {
  const custom = getCustomNuvioProviderRepositoryUrls().map(url => ({
    key: customRepositoryKey(url),
    fallbackName: new URL(url).hostname,
    url,
    custom: true,
  }));
  return [...PROVIDER_MANIFEST_SOURCES, ...custom];
}

const WORKER_PRELUDE = String.raw`
"use strict";
const __providerDependencies = globalThis.__NUVIO_PROVIDER_DEPS__ || {};
function require(name) {
  if (name === "axios") return __providerDependencies.axios;
  if (name === "crypto-js") return __providerDependencies.CryptoJS;
  if (name === "cheerio" || name === "cheerio-without-node-native") return __providerDependencies.cheerio;
  throw new Error("Provider module is not allowed: " + name);
}
const module = { exports: {} };
const exports = module.exports;
let __httpSequence = 0;
const __httpPending = new Map();

class ProviderBuffer extends Uint8Array {
  static isBuffer(value) {
    return value instanceof ProviderBuffer || value instanceof Uint8Array;
  }

  static from(value, encoding) {
    if (typeof value === "string") {
      const mode = String(encoding || "utf8").toLowerCase();
      if (mode === "base64" || mode === "base64url") {
        let encoded = value.replace(/-/g, "+").replace(/_/g, "/");
        encoded += "=".repeat((4 - encoded.length % 4) % 4);
        const binary = atob(encoded);
        return new ProviderBuffer(Array.from(binary, character => character.charCodeAt(0)));
      }
      if (mode === "hex") {
        const bytes = [];
        for (let index = 0; index + 1 < value.length; index += 2) bytes.push(parseInt(value.slice(index, index + 2), 16));
        return new ProviderBuffer(bytes);
      }
      return new ProviderBuffer(new TextEncoder().encode(value));
    }
    if (value instanceof ArrayBuffer) return new ProviderBuffer(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return new ProviderBuffer(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return new ProviderBuffer(value || []);
  }

  toString(encoding) {
    const mode = String(encoding || "utf8").toLowerCase();
    if (mode === "hex") return Array.from(this, byte => byte.toString(16).padStart(2, "0")).join("");
    if (mode === "binary" || mode === "latin1") return Array.from(this, byte => String.fromCharCode(byte)).join("");
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
globalThis.Buffer = ProviderBuffer;

function __headers(value) {
  const output = {};
  if (!value) return output;
  if (value instanceof Headers) {
    value.forEach((headerValue, key) => { output[key] = headerValue; });
  } else if (Array.isArray(value)) {
    for (const pair of value) if (Array.isArray(pair) && pair.length >= 2) output[String(pair[0])] = String(pair[1]);
  } else if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined && value[key] !== null) output[key] = String(value[key]);
    }
  }
  return output;
}

async function __body(value) {
  if (value === undefined || value === null) return {};
  if (typeof value === "string") return { body: value, bodyBase64: false };
  if (value instanceof URLSearchParams) return { body: value.toString(), bodyBase64: false };
  let bytes;
  let contentType;
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    const encoded = new Request("https://aetherio.invalid/form", { method: "POST", body: value });
    contentType = encoded.headers.get("content-type") || undefined;
    bytes = new Uint8Array(await encoded.arrayBuffer());
  }
  else if (value instanceof Blob) {
    contentType = value.type || undefined;
    bytes = new Uint8Array(await value.arrayBuffer());
  }
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else return { body: String(value), bodyBase64: false };
  return { body: ProviderBuffer.from(bytes).toString("base64"), bodyBase64: true, contentType };
}

function __abortError() {
  try { return new DOMException("The operation was aborted", "AbortError"); }
  catch (_) { const error = new Error("The operation was aborted"); error.name = "AbortError"; return error; }
}

globalThis.fetch = async function providerFetch(input, init) {
  const options = init || {};
  const inputRequest = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const url = inputRequest ? inputRequest.url : String(input);
  const headers = Object.assign({}, __headers(inputRequest && inputRequest.headers), __headers(options.headers));
  const serializedBody = await __body(options.body !== undefined ? options.body : inputRequest && inputRequest.body);
  if (serializedBody.contentType && !Object.keys(headers).some(key => key.toLowerCase() === "content-type")) {
    headers["content-type"] = serializedBody.contentType;
  }
  const signal = options.signal || (inputRequest && inputRequest.signal);
  if (signal && signal.aborted) throw __abortError();
  const id = ++__httpSequence;
  const responseData = await new Promise((resolve, reject) => {
    const onAbort = () => {
      __httpPending.delete(id);
      reject(__abortError());
    };
    const cleanup = () => signal && signal.removeEventListener("abort", onAbort);
    __httpPending.set(id, {
      resolve(value) { cleanup(); resolve(value); },
      reject(error) { cleanup(); reject(error); }
    });
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    postMessage({
      type: "http-request",
      id,
      request: Object.assign({
        url,
        method: String(options.method || (inputRequest && inputRequest.method) || "GET"),
        headers
      }, {
        body: serializedBody.body,
        bodyBase64: serializedBody.bodyBase64
      })
    });
  });
  const binary = atob(responseData.bodyBase64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const response = new Response(bytes.length ? bytes : null, {
    status: responseData.status,
    statusText: String(responseData.statusText || "").replace(/[^\x20-\x7e]/g, "").slice(0, 128),
    headers: responseData.headers
  });
  try {
    Object.defineProperty(response, "url", { value: responseData.url, configurable: true });
    Object.defineProperty(response, "redirected", { value: responseData.url !== url, configurable: true });
  } catch (_) {}
  return response;
};
`;

const WORKER_POSTLUDE = String.raw`
let __provider = module.exports;
if (__provider && __provider.default && typeof __provider.getStreams !== "function") __provider = __provider.default;
function __cloneable(value) {
  return JSON.parse(JSON.stringify(value, (_key, candidate) => {
    if (candidate instanceof Promise || typeof candidate === "function" || typeof candidate === "symbol") return undefined;
    if (candidate instanceof Headers) return Object.fromEntries(candidate.entries());
    if (candidate instanceof URL) return candidate.toString();
    return candidate;
  }));
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
    if (!__provider || typeof __provider.getStreams !== "function") throw new Error("Provider does not export getStreams");
    const value = await __provider.getStreams(...message.args);
    postMessage({ type: "result", value: __cloneable(Array.isArray(value) ? value : []) });
  } catch (error) {
    postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) });
  }
};
`;

function decodeBase64Text(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

async function providerHttp(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
  return invokeCommand<ProviderHttpResponse>("provider_http_request", { request });
}

async function fetchText(url: string): Promise<string> {
  const response = await providerHttp({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return decodeBase64Text(response.bodyBase64);
}

export async function getNuvioProviderRepositories(): Promise<NuvioProviderRepositoryInfo[]> {
  if (repositoriesPromise) return repositoriesPromise;
  repositoriesPromise = Promise.all(providerManifestSources().map(async source => {
    try {
      const manifest = await loadManifest(source.url);
      return {
        key: source.key,
        ownerName: source.fallbackName,
        name: manifest.name,
        version: manifest.version,
        manifestUrl: source.url,
        custom: source.custom,
        scrapers: manifest.scrapers.map(scraper => ({
          key: `${source.key}:${scraper.id}`,
          id: scraper.id,
          name: scraper.name,
          description: scraper.description,
          supportedTypes: scraper.supportedTypes ?? ["movie", "tv"],
          contentLanguage: scraper.contentLanguage ?? [],
          enabledByManifest: scraper.enabled !== false,
          supportsExternalPlayer: scraper.supportsExternalPlayer !== false,
        })),
      } satisfies NuvioProviderRepositoryInfo;
    } catch (error) {
      console.warn("[AETHERIO:PROVIDERS] manifest failed", source.key, error);
      return {
        key: source.key,
        ownerName: source.fallbackName,
        name: source.fallbackName,
        manifestUrl: source.url,
        custom: source.custom,
        scrapers: [],
        error: error instanceof Error ? error.message : String(error),
      } satisfies NuvioProviderRepositoryInfo;
    }
  }));
  return repositoriesPromise;
}

export async function refreshNuvioProviderRepositories() {
  repositoriesPromise = null;
  definitionsPromise = null;
  manifestCache.clear();
  scriptCache.clear();
  clearNuvioProviderResultCache();
  return getNuvioProviderRepositories();
}

export function clearNuvioProviderResultCache() {
  resultCache.clear();
  providerExecutionCache.clear();
}

export async function addNuvioProviderRepository(rawUrl: string) {
  const url = new URL(rawUrl.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("El repositorio debe usar HTTP o HTTPS.");
  url.hash = "";
  const normalized = url.toString();
  await loadManifest(normalized, true);
  const urls = getCustomNuvioProviderRepositoryUrls();
  if (!urls.includes(normalized)) {
    localStorage.setItem(CUSTOM_PROVIDER_REPOSITORIES_KEY, JSON.stringify([...urls, normalized]));
  }
  await refreshNuvioProviderRepositories();
}

export async function removeNuvioProviderRepository(url: string) {
  const urls = getCustomNuvioProviderRepositoryUrls().filter(candidate => candidate !== url);
  localStorage.setItem(CUSTOM_PROVIDER_REPOSITORIES_KEY, JSON.stringify(urls));
  return refreshNuvioProviderRepositories();
}

async function loadDefinitions(): Promise<ProviderDefinition[]> {
  if (definitionsPromise) return definitionsPromise;
  definitionsPromise = Promise.allSettled(providerManifestSources().map(async source => {
    const manifest = await loadManifest(source.url);
    return manifest.scrapers
      .filter(scraper => scraper.enabled !== false && scraper.supportsExternalPlayer !== false)
      .map(scraper => ({
        key: `${source.key}:${scraper.id}`,
        ownerName: source.fallbackName,
        repositoryName: manifest.name,
        manifestUrl: source.url,
        scriptUrl: new URL(scraper.filename, source.url).toString(),
        scraper,
      }));
  })).then(results => results.flatMap(result => {
    if (result.status === "fulfilled") return result.value;
    console.warn("[AETHERIO:PROVIDERS] manifest failed", result.reason);
    return [];
  }));
  return definitionsPromise;
}

function loadManifest(url: string, refresh = false): Promise<ProviderManifest> {
  if (refresh) manifestCache.delete(url);
  const cached = manifestCache.get(url);
  if (cached) return cached;
  const pending = fetchText(url)
    .then(text => {
      const parsed = JSON.parse(text) as unknown;
      if (
        Array.isArray(parsed)
        || (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).pluginLists))
      ) {
        throw new Error("Este es un repositorio CloudStream .cs3. Esas extensiones Android no pueden ejecutarse en Aetherio Desktop; usa una conversión compatible con Nuvio JS.");
      }
      const manifest = parsed as ProviderManifest;
      if (!manifest.name || !Array.isArray(manifest.scrapers)) throw new Error("Invalid provider manifest");
      return manifest;
    })
    .catch(error => {
      manifestCache.delete(url);
      throw error;
    });
  manifestCache.set(url, pending);
  return pending;
}

function loadScript(url: string): Promise<string> {
  const cached = scriptCache.get(url);
  if (cached) return cached;
  const pending = fetchText(url).catch(error => {
    scriptCache.delete(url);
    throw error;
  });
  scriptCache.set(url, pending);
  return pending;
}

async function runProvider(definition: ProviderDefinition, args: unknown[]): Promise<RawProviderStream[]> {
  const source = await loadScript(definition.scriptUrl);
  const dependencyUrl = new URL("nuvio-provider-deps.js", window.location.href).toString();
  const blob = new Blob([
    `globalThis.window = globalThis; globalThis.global = globalThis; globalThis.XMLHttpRequest = undefined; var process = globalThis.process = globalThis.process || { env: {} }; importScripts(${JSON.stringify(dependencyUrl)});\n`,
    WORKER_PRELUDE,
    "\n(function runProviderModule(process) {\n",
    source,
    "\n}).call(globalThis, globalThis.process);\n",
    WORKER_POSTLUDE,
  ], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl, { name: `provider-${definition.key}` });
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
      () => finish(() => reject(new Error(`Provider ${definition.key} timed out`))),
      PROVIDER_TIMEOUT_MS,
    );
    worker.onerror = event => finish(() => reject(new Error(
      [event.message || `Provider ${definition.key} failed`, event.filename, event.lineno, event.colno]
        .filter(Boolean)
        .join(" @ "),
    )));
    worker.onmessage = event => {
      const message = event.data as WorkerMessage;
      if (message.type === "http-request") {
        void providerHttp({ ...message.request, sessionKey: definition.key })
          .then(response => worker.postMessage({ type: "http-response", id: message.id, response }))
          .catch(error => worker.postMessage({ type: "http-response", id: message.id, error: String(error) }));
        return;
      }
      if (message.type === "result") {
        const value = Array.isArray(message.value) ? message.value as RawProviderStream[] : [];
        finish(() => resolve(value));
        return;
      }
      if (message.type === "error") finish(() => reject(new Error(message.error)));
    };
    worker.postMessage({ type: "run", args });
  });
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => {
      if (typeof entry[1] !== "string" || !entry[1].trim()) return false;
      return !["connection", "content-length", "host", "transfer-encoding"].includes(entry[0].toLowerCase());
    }));
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSubtitles(value: unknown): StreamSubtitle[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.flatMap<StreamSubtitle>((item, index): StreamSubtitle[] => {
    if (typeof item === "string" && item.trim()) {
      const normalized = item.trim();
      return /^https?:\/\//i.test(normalized)
        ? [{ id: `provider-subtitle-${index}`, url: normalized }]
        : [{ id: `provider-subtitle-${index}`, lang: normalized, title: normalized }];
    }
    if (!item || typeof item !== "object") return [];
    const subtitle = item as Record<string, unknown>;
    const url = [subtitle.url, subtitle.file, subtitle.src].find(candidate => typeof candidate === "string");
    const lang = typeof subtitle.lang === "string" ? subtitle.lang : undefined;
    const language = typeof subtitle.language === "string" ? subtitle.language : undefined;
    const title = typeof subtitle.title === "string" ? subtitle.title : undefined;
    if ((typeof url !== "string" || !/^https?:\/\//i.test(url)) && !lang && !language && !title) return [];
    return [{
      id: typeof subtitle.id === "string" ? subtitle.id : `provider-subtitle-${index}`,
      url: typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined,
      lang,
      language,
      title,
    }];
  });
}

function normalizeLanguageList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter((item, index, values) => item && values.findIndex(value => value.toLowerCase() === item.toLowerCase()) === index);
}

function normalizeStreams(
  definition: ProviderDefinition,
  streams: RawProviderStream[],
  origin?: ProviderStreamOrigin,
): MediaStream[] {
  return streams.flatMap((raw, index) => {
    const url = [raw.url, raw.externalUrl].find(value => typeof value === "string" && /^https?:\/\//i.test(value.trim()));
    if (typeof url !== "string") return [];
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === "log.info") return [];
    const knownMediaUrl = /\.(?:m3u8|mp4|mkv|mpd|webm|avi)(?:$|[?#])/i.test(parsedUrl.pathname + parsedUrl.search);
    const supportedEmbedUrl = parsedUrl.hostname === "ok.ru" || parsedUrl.hostname.endsWith(".ok.ru");
    const explicitlyDirect = raw.type === "direct" || raw.verified === true;
    if (!knownMediaUrl && !supportedEmbedUrl && (!explicitlyDirect || raw.verified === false)) return [];
    const hints = raw.behaviorHints && typeof raw.behaviorHints === "object"
      ? raw.behaviorHints as Record<string, unknown>
      : {};
    const proxyHeaders = hints.proxyHeaders && typeof hints.proxyHeaders === "object"
      ? hints.proxyHeaders as Record<string, unknown>
      : {};
    const headers = {
      ...stringRecord(proxyHeaders.request),
      ...stringRecord(raw.headers),
      ...stringRecord(hints.headers),
    };
    const quality = typeof raw.quality === "string" ? raw.quality : undefined;
    const providerName = typeof raw.name === "string" && raw.name.trim() ? raw.name : definition.scraper.name;
    const rawTitle = typeof raw.title === "string" && raw.title.trim()
      ? raw.title.replace(/\[object Promise\]/g, "Auto")
      : undefined;
    const subtitles = normalizeSubtitles(raw.subtitles ?? raw.subtitle);
    const languages = normalizeLanguageList(raw.languages ?? raw.language ?? hints.languages ?? definition.scraper.contentLanguage);
    return [{
      id: `provider|${definition.key}|${index}|${url}`,
      addonId: `nuvio-provider:${definition.key}`,
      addonName: origin
        ? `Cloudstream · ${origin.repositoryName}`
        : `${definition.ownerName} · ${definition.repositoryName}`,
      name: providerName,
      title: rawTitle ?? providerName,
      description: [quality, ...(definition.scraper.contentLanguage ?? [])].filter(Boolean).join(" · ") || definition.scraper.description,
      url,
      size: positiveNumber(raw.size ?? hints.videoSize ?? hints.size),
      folderSize: positiveNumber(raw.folderSize ?? hints.folderSize),
      indexer: optionalText(raw.indexer ?? hints.indexer),
      duration: positiveNumber(raw.duration ?? hints.duration),
      languages: languages.length ? languages : undefined,
      subtitles: subtitles.length ? subtitles : undefined,
      behaviorHints: {
        ...hints,
        filename: rawTitle ?? providerName,
        headers,
        providerId: definition.scraper.id,
        providerOwner: definition.ownerName,
        providerRepository: definition.repositoryName,
        providerHttpSessionKey: definition.key,
        sourceOrigin: origin?.kind ?? "nuvio",
        cloudstreamRepository: origin?.repositoryName,
        cloudstreamRepositoryUrl: origin?.repositoryUrl,
        cloudstreamPlugin: origin?.pluginName,
        cloudstreamLanguage: origin?.language,
        scraperPlayback: "direct",
        scraperResolvedDirect: true,
      },
    } satisfies MediaStream];
  });
}

function isSignedOkruUrl(value?: string) {
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase().endsWith("okcdn.ru");
  } catch {
    return false;
  }
}

function isLikelySignedMediaUrl(value?: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    const signedKeys = [
      "token",
      "expires",
      "expiry",
      "exp",
      "signature",
      "sig",
      "auth",
      "hdnts",
      "policy",
      "key-pair-id",
    ];
    return signedKeys.some(key => url.searchParams.has(key));
  } catch {
    return false;
  }
}

function providerResultCacheTtl(streams: MediaStream[]) {
  if (streams.some(stream => isSignedOkruUrl(stream.url))) return OKRU_SIGNED_RESULT_CACHE_TTL_MS;
  if (streams.some(stream => isLikelySignedMediaUrl(stream.url))) return SIGNED_RESULT_CACHE_TTL_MS;
  return RESULT_CACHE_TTL_MS;
}

function providerExecutionCacheKey(
  definition: ProviderDefinition,
  query: StreamQuery,
  tmdbId: number,
  mediaType: string,
  title: string | undefined,
  origin: ProviderStreamOrigin | undefined,
) {
  return [
    definition.key,
    tmdbId,
    mediaType,
    query.season ?? "",
    query.episode ?? "",
    title ?? "",
    origin?.repositoryUrl ?? "nuvio",
    origin?.pluginName ?? "",
  ].join("|");
}

function readProviderExecutionCache(key: string) {
  const cached = providerExecutionCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.updatedAt >= cached.ttlMs) {
    providerExecutionCache.delete(key);
    return null;
  }
  return cached;
}

function updateProviderRuntimeHealth(providerKey: string, succeeded: boolean, durationMs: number) {
  const current = providerRuntimeHealth.get(providerKey) ?? {
    successes: 0,
    failures: 0,
    totalDurationMs: 0,
    lastSuccessAt: 0,
  };
  current.totalDurationMs += durationMs;
  if (succeeded) {
    current.successes += 1;
    current.lastSuccessAt = Date.now();
  } else {
    current.failures += 1;
  }
  providerRuntimeHealth.set(providerKey, current);
}

function providerRuntimePriority(definition: ProviderDefinition) {
  const health = providerRuntimeHealth.get(definition.key);
  if (!health) return 0;
  const attempts = health.successes + health.failures;
  const averageDuration = attempts ? health.totalDurationMs / attempts : PROVIDER_TIMEOUT_MS;
  return (health.successes * 100) - (health.failures * 35) - Math.min(30, averageDuration / 500);
}

function providerLogContext(definition: ProviderDefinition, origin?: ProviderStreamOrigin) {
  return {
    providerKey: definition.key,
    providerId: definition.scraper.id,
    providerName: definition.scraper.name,
    origin: origin?.kind ?? "nuvio",
    repository: origin?.repositoryName ?? definition.repositoryName,
    repositoryUrl: origin?.repositoryUrl ?? definition.manifestUrl,
    cloudstreamPlugin: origin?.pluginName,
    cloudstreamLanguage: origin?.language,
  };
}

function classifyProviderFailure(error: unknown) {
  const message = String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("timed out") || normalized.includes("timeout")) return "timeout";
  if (
    normalized.includes("module is not allowed")
    || normalized.includes("is not defined")
    || normalized.includes("is not a function")
    || normalized.includes("failed to clone")
  ) return "runtime";
  if (/http\s+(?:429|5\d\d)\b/i.test(message)) return "external-transient";
  if (/http\s+4\d\d\b/i.test(message)) return "external-http";
  if (normalized.includes("network error") || normalized.includes("request failed")) return "external-network";
  return "provider";
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

async function resolveTmdbId(query: StreamQuery): Promise<number | null> {
  const direct = query.id.replace(/^tmdb:/, "");
  if (/^\d+$/.test(direct)) return Number(direct);
  const imdb = query.id.replace(/^imdb:/, "");
  if (!/^tt\d+$/.test(imdb)) return null;
  const response = await tmdbFetch(`/find/${imdb}`, {
    params: { external_source: "imdb_id", language: "en-US" },
  });
  const resultKey = query.type === "movie" ? "movie_results" : "tv_results";
  const id = response?.[resultKey]?.[0]?.id;
  return typeof id === "number" ? id : null;
}

export async function scrapeNuvioProviders(
  query: StreamQuery,
  title?: string,
  providerKeys?: string[],
  onProviderStreams?: (streams: MediaStream[]) => void,
  providerOrigins?: Record<string, ProviderStreamOrigin>,
  onBatchStatus?: (status: ProviderBatchStatus) => void,
): Promise<MediaStream[]> {
  if (!isTauriRuntime()) return [];
  if (providerKeys && providerKeys.length === 0) return [];
  const tmdbId = await resolveTmdbId(query);
  if (!tmdbId) return [];
  const mediaType = query.type === "movie" ? "movie" : "tv";
  const cacheKey = [
    tmdbId,
    mediaType,
    query.season ?? "",
    query.episode ?? "",
    title ?? "",
    providerKeys === undefined ? "all" : providerKeys.slice().sort().join(","),
    JSON.stringify(providerOrigins ?? {}),
  ].join("|");
  const cached = resultCache.get(cacheKey);
  if (cached && cached.streams.length && Date.now() - cached.updatedAt < cached.ttlMs) {
    if (DEBUG_PROVIDERS) console.info("[AETHERIO:PROVIDERS] batch cache hit", {
      queryId: query.id,
      tmdbId,
      mediaType,
      providerCount: providerKeys?.length,
      streamCount: cached.streams.length,
      ageMs: Date.now() - cached.updatedAt,
      ttlMs: cached.ttlMs,
    });
    onProviderStreams?.(cached.streams);
    onBatchStatus?.({
      providerCount: providerKeys?.length ?? 0,
      failedProviderCount: 0,
      streamCount: cached.streams.length,
      fromCache: true,
    });
    return cached.streams;
  }
  resultCache.delete(cacheKey);

  const selectedKeys = providerKeys ? new Set(providerKeys) : null;
  const definitions = (await loadDefinitions())
    .filter(definition => {
      if (selectedKeys && !selectedKeys.has(definition.key)) return false;
      const supportedTypes = definition.scraper.supportedTypes ?? ["movie", "tv"];
      return supportedTypes.includes(mediaType);
    })
    .sort((left, right) => providerRuntimePriority(right) - providerRuntimePriority(left));
  const args = [tmdbId, mediaType, query.season ?? null, query.episode ?? null, title ?? null, null];
  const batchStartedAt = Date.now();
  const batches = await mapWithConcurrency(definitions, PROVIDER_CONCURRENCY, async definition => {
    const origin = providerOrigins?.[definition.key];
    const context = providerLogContext(definition, origin);
    const executionKey = providerExecutionCacheKey(definition, query, tmdbId, mediaType, title, origin);
    const cachedExecution = readProviderExecutionCache(executionKey);
    if (cachedExecution) {
      if (cachedExecution.streams.length) onProviderStreams?.(cachedExecution.streams);
      if (DEBUG_PROVIDERS) console.info("[AETHERIO:PROVIDERS] provider cache hit", {
        ...context,
        status: cachedExecution.status,
        acceptedCount: cachedExecution.streams.length,
        ageMs: Date.now() - cachedExecution.updatedAt,
        ttlMs: cachedExecution.ttlMs,
      });
      return {
        streams: cachedExecution.streams,
        failed: cachedExecution.status === "error",
      };
    }
    const startedAt = Date.now();
    try {
      const rawStreams = await runProvider(definition, args);
      const durationMs = Date.now() - startedAt;
      const streams = normalizeStreams(
        definition,
        rawStreams,
        origin,
      ).map(stream => ({
        ...stream,
        behaviorHints: {
          ...stream.behaviorHints,
          providerResolveMs: durationMs,
        },
      }));
      const providerStatus: ProviderExecutionStatus = streams.length ? "success" : "empty";
      const providerTtlMs = streams.length
        ? providerResultCacheTtl(streams)
        : EMPTY_PROVIDER_CACHE_TTL_MS;
      providerExecutionCache.set(executionKey, {
        streams,
        status: providerStatus,
        updatedAt: Date.now(),
        ttlMs: providerTtlMs,
      });
      updateProviderRuntimeHealth(definition.key, true, durationMs);
      if (streams.length) onProviderStreams?.(streams);
      if (DEBUG_PROVIDERS) console.info("[AETHERIO:PROVIDERS] provider result", {
        ...context,
        status: streams.length ? "success" : rawStreams.length ? "rejected" : "empty",
        rawCount: rawStreams.length,
        acceptedCount: streams.length,
        rejectedCount: Math.max(0, rawStreams.length - streams.length),
        durationMs,
        cacheTtlMs: providerTtlMs,
      });
      return { streams, failed: false };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      providerExecutionCache.set(executionKey, {
        streams: [],
        status: "error",
        updatedAt: Date.now(),
        ttlMs: FAILED_PROVIDER_COOLDOWN_MS,
      });
      updateProviderRuntimeHealth(definition.key, false, durationMs);
      console.warn("[AETHERIO:PROVIDERS] provider result", {
        ...context,
        status: "error",
        failureKind: classifyProviderFailure(error),
        error: String(error),
        rawCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        durationMs,
        cooldownMs: FAILED_PROVIDER_COOLDOWN_MS,
      });
      return { streams: [] as MediaStream[], failed: true };
    }
  });
  const seen = new Set<string>();
  const streams = batches.flatMap(batch => batch.streams).filter(stream => {
    const key = `${stream.url}|${JSON.stringify(stream.behaviorHints?.headers ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const failedProviderCount = batches.filter(batch => batch.failed).length;
  const cacheable = streams.length > 0 && failedProviderCount === 0;
  const ttlMs = providerResultCacheTtl(streams);
  if (cacheable) {
    resultCache.set(cacheKey, { streams, updatedAt: Date.now(), ttlMs });
  } else {
    resultCache.delete(cacheKey);
  }
  if (DEBUG_PROVIDERS) console.info("[AETHERIO:PROVIDERS] batch result", {
    queryId: query.id,
    tmdbId,
    mediaType,
    providerCount: definitions.length,
    failedProviderCount,
    streamCount: streams.length,
    durationMs: Date.now() - batchStartedAt,
    cached: cacheable,
    cacheTtlMs: cacheable ? ttlMs : 0,
  });
  onBatchStatus?.({
    providerCount: definitions.length,
    failedProviderCount,
    streamCount: streams.length,
    fromCache: false,
  });
  return streams;
}

export { PROVIDER_MANIFEST_URLS };
