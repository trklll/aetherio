import { useEffect, useMemo, useRef, useState } from "react";
import { useAddonStore } from "../store/addonStore.ts";
import { tmdbFetch } from "../config/apiKeys.ts";
import type { MediaStream, StreamQuery, StreamSubtitle } from "../types/stream.ts";
import { isPlayableMediaStream } from "../utils/playableMedia.ts";
import { streamSpanishPriority } from "../utils/streamLanguagePriority.ts";

const DEBUG_STREAMS = import.meta.env.DEV;
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_CACHE = new Map<string, { streams: MediaStream[]; updatedAt: number }>();
const IMDB_ID_CACHE = new Map<string, Promise<string | null>>();

export interface UseStreamsResult {
  streams: MediaStream[];
  loading: boolean;
  error: string | null;
  streamId: string;
  reload: () => void;
}

// ── Fingerprint de contenido para deduplicacion inteligente ───────────────
// No solo compara URLs: un mismo recurso puede llegar de distintos addons
// con URL identica, hash identico, o titulo+calidad identicos.
function contentFingerprint(s: MediaStream): string {
  // Prioridad: url exacta > infoHash+fileIdx > titulo normalizado
  if (s.url)      return `url:${s.url.toLowerCase().trim()}`;
  if (s.infoHash) return `hash:${s.infoHash.toLowerCase()}:${s.fileIdx ?? 0}`;
  const magnet = (s.sources ?? []).find(item => /^magnet:/i.test(item));
  if (magnet) return `magnet:${magnet.toLowerCase().trim()}:${s.fileIdx ?? 0}`;
  if (s.ytId)     return `yt:${s.ytId}`;
  // Fallback: normalizar titulo + addon para no perder fuentes distintas
  const title = (s.title ?? s.name ?? "").toLowerCase().replace(/\s+/g, "");
  return `title:${s.addonId}:${title}`;
}

function dedupeStreams(streams: MediaStream[]): MediaStream[] {
  const seen = new Map<string, MediaStream>();
  for (const s of streams) {
    const fp = contentFingerprint(s);
    if (!seen.has(fp)) {
      seen.set(fp, s);
    } else {
      // Preferir el que tenga mas metadata completa
      const existing = seen.get(fp)!;
      const score = (x: MediaStream) =>
        (x.title ? 1 : 0) + (x.description ? 1 : 0) +
        (x.behaviorHints?.videoSize ? 1 : 0) + (x.subtitles?.length ? 1 : 0);
      if (score(s) > score(existing)) seen.set(fp, s);
    }
  }
  return Array.from(seen.values());
}

function playbackScore(stream: MediaStream): number {
  const hints = stream.behaviorHints ?? {};
  const notWebReady = Boolean(hints.notWebReady);
  const lowerName = (stream.name ?? "").toLowerCase();
  const hasDirectUrl = typeof stream.url === "string" && /^https?:\/\//i.test(stream.url);
  const hasHttpSource = (stream.sources ?? []).some(item => /^https?:\/\//i.test(item));
  const hasTorrentSignals =
    Boolean(stream.infoHash) ||
    (stream.sources ?? []).some(item => /^magnet:/i.test(item));

  let score = 0;
  if (hasDirectUrl) score += 50;
  if (hasTorrentSignals) score += 38;
  if (hasHttpSource) score += 20;
  if (stream.subtitles?.length) score += 8;
  if (typeof hints.videoSize === "number" && hints.videoSize > 0) score += 4;
  if (notWebReady) score -= 100;
  if (lowerName.includes("cam")) score -= 12;
  return score;
}

function sortStreamsForPlayback(streams: MediaStream[]): MediaStream[] {
  return [...streams].sort((a, b) => {
    const languagePriority = streamSpanishPriority(b) - streamSpanishPriority(a);
    return languagePriority || playbackScore(b) - playbackScore(a);
  });
}

function buildStreamId(q: StreamQuery): string {
  return buildStreamIdFromMediaId(q, q.id);
}

function buildStreamIdFromMediaId(query: StreamQuery, mediaId: string) {
  return query.type !== "movie" && typeof query.season === "number" && query.episode
    ? `${mediaId}:${query.season}:${query.episode}`
    : mediaId;
}

function addonStreamIdPrefixes(addon: any, type: string) {
  const resourcePrefixes = (addon.manifest?.resources ?? []).flatMap((resource: unknown) => {
    if (!resource || typeof resource !== "object") return [];
    const streamResource = resource as { name?: unknown; types?: unknown; idPrefixes?: unknown };
    if (streamResource.name !== "stream") return [];
    if (Array.isArray(streamResource.types) && !streamResource.types.includes(type)) return [];
    return Array.isArray(streamResource.idPrefixes) ? streamResource.idPrefixes : [];
  });
  const manifestPrefixes = Array.isArray(addon.manifest?.idPrefixes) ? addon.manifest.idPrefixes : [];
  return [...new Set([...manifestPrefixes, ...resourcePrefixes].filter((prefix): prefix is string => typeof prefix === "string"))];
}

async function resolveAddonStreamId(addon: any, query: StreamQuery, requestType: string, fallbackStreamId: string) {
  const prefixes = addonStreamIdPrefixes(addon, requestType);
  const directImdb = query.id.replace(/^imdb:/i, "");
  if (/^tt\d+$/i.test(directImdb) && prefixes.includes("tt")) {
    return buildStreamIdFromMediaId(query, directImdb);
  }
  const tmdbMatch = query.id.match(/^tmdb:(\d+)$/i);
  if (!tmdbMatch || !prefixes.includes("tt") || prefixes.includes("tmdb")) return fallbackStreamId;
  const cacheKey = `${query.type}:${tmdbMatch[1]}`;
  let pending = IMDB_ID_CACHE.get(cacheKey);
  if (!pending) {
    pending = tmdbFetch<any>(`/${query.type === "movie" ? "movie" : "tv"}/${tmdbMatch[1]}`, {
      params: { append_to_response: "external_ids" },
    }).then(details => {
      const imdbId = details?.external_ids?.imdb_id ?? details?.imdb_id;
      return typeof imdbId === "string" && /^tt\d+$/i.test(imdbId) ? imdbId : null;
    }).catch(() => null);
    IMDB_ID_CACHE.set(cacheKey, pending);
  }
  const imdbId = await pending;
  return imdbId ? buildStreamIdFromMediaId(query, imdbId) : fallbackStreamId;
}

function addonHasStreams(addon: any): boolean {
  const resources = addon.manifest?.resources ?? [];
  if (!resources.length) return true; // sin declaracion — intentar igual
  return resources.some((r: unknown) =>
    typeof r === "string" ? r === "stream" : (r as any)?.name === "stream"
  );
}

function addonSupportsType(addon: any, type: string) {
  const types = addon.manifest?.types;
  return !Array.isArray(types) || types.length === 0 || types.includes(type);
}

function streamRequestTypes(addon: any, queryType: string) {
  const candidates = queryType === "anime"
    ? ["anime", "series", "tv"]
    : queryType === "tv" || queryType === "series"
      ? ["series", "tv"]
      : [queryType];
  return candidates.filter((type, index) => candidates.indexOf(type) === index && addonSupportsType(addon, type));
}

function hasP2pStream(streams: MediaStream[]) {
  return streams.some(stream =>
    Boolean(stream.infoHash) ||
    /^(magnet:|stremio:)/i.test(stream.url ?? "") ||
    (stream.sources ?? []).some(source => /^(magnet:|stremio:)/i.test(source))
  );
}

async function fetchStreamPayload(url: string, attempts = 2) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { json: await response.json(), status: response.status };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => window.setTimeout(resolve, 450 * attempt));
      }
    }
  }
  throw lastError;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStringList(value: unknown): string[] | undefined {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = items
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter((item, index, values) => item && values.findIndex(value => value.toLowerCase() === item.toLowerCase()) === index);
  return normalized.length ? normalized : undefined;
}

const STREAM_LANGUAGE_MARKERS: Array<[RegExp, string]> = [
  [/(?:🇲🇽|\blatino\b|\blatam\b)/i, "Latino"],
  [/(?:🇪🇸|\bcastellano\b)/i, "Castellano"],
  [/(?:🇬🇧|🇺🇸|\beng(?:lish)?\b)/i, "English"],
  [/(?:🇫🇷|\bfre\b|\bfra\b|\bfrench\b)/i, "French"],
  [/(?:🇩🇪|\bger\b|\bdeu\b|\bgerman\b)/i, "German"],
  [/(?:🇮🇹|\bita\b|\bitalian\b)/i, "Italian"],
  [/(?:🇵🇹|🇧🇷|\bpor\b|\bportuguese\b)/i, "Portuguese"],
  [/(?:🇷🇺|\brus\b|\brussian\b)/i, "Russian"],
  [/(?:🇮🇳|\bhin\b|\bhindi\b)/i, "Hindi"],
  [/(?:🇨🇳|\bchi\b|\bzho\b|\bchinese\b)/i, "Chinese"],
  [/(?:🇯🇵|\bjpn\b|\bjapanese\b)/i, "Japanese"],
  [/(?:🇺🇦|\bukr\b|\bukrainian\b)/i, "Ukrainian"],
  [/(?:🇹🇭|\btha\b|\bthai\b)/i, "Thai"],
];

function detectStreamLanguages(raw: any, behaviorHints?: Record<string, unknown>) {
  const text = [raw.name, raw.title, raw.description, behaviorHints?.filename]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const detected = STREAM_LANGUAGE_MARKERS
    .filter(([pattern]) => pattern.test(text))
    .map(([, language]) => language);
  return detected.length ? detected : undefined;
}

function normalizeSubtitles(value: unknown): MediaStream["subtitles"] {
  if (!Array.isArray(value)) return undefined;
  const subtitles = value.flatMap<StreamSubtitle>((item, index): StreamSubtitle[] => {
    if (typeof item === "string" && item.trim()) {
      const normalized = item.trim();
      return /^https?:\/\//i.test(normalized)
        ? [{ id: `stream-subtitle-${index}`, url: normalized }]
        : [{ id: `stream-subtitle-${index}`, lang: normalized, title: normalized }];
    }
    if (!item || typeof item !== "object") return [];
    const subtitle = item as Record<string, unknown>;
    const url = [subtitle.url, subtitle.file, subtitle.src].find(candidate => typeof candidate === "string") as string | undefined;
    const lang = optionalText(subtitle.lang);
    const language = optionalText(subtitle.language);
    const title = optionalText(subtitle.title);
    if (!url && !lang && !language && !title) return [];
    return [{
      id: optionalText(subtitle.id) ?? `stream-subtitle-${index}`,
      url,
      lang,
      language,
      title,
    }];
  });
  return subtitles.length ? subtitles : undefined;
}

function normalizeStream(raw: any, addonId: string, addonName: string, idx: number): MediaStream | null {
  const url         = typeof raw.url         === "string" ? raw.url         : undefined;
  const externalUrl = typeof raw.externalUrl === "string" ? raw.externalUrl : undefined;
  const ytId        = typeof raw.ytId        === "string" ? raw.ytId        : undefined;
  const infoHash    = typeof raw.infoHash    === "string" ? raw.infoHash    : undefined;
  const sources     = Array.isArray(raw.sources) ? raw.sources.filter((item: unknown) => typeof item === "string") : undefined;
  const behaviorHints = raw.behaviorHints && typeof raw.behaviorHints === "object"
    ? raw.behaviorHints as Record<string, unknown>
    : undefined;
  const numericFileIdx = Number(raw.fileIdx);
  const sourceTarget = sources?.find((item: string) => /^(magnet:|stremio:|https?:\/\/)/i.test(item));
  const stream = {
    id: [addonId, url ?? infoHash ?? ytId ?? externalUrl ?? sourceTarget ?? "", idx].join("|"),
    addonId,
    addonName,
    name:         typeof raw.name        === "string" ? raw.name        : addonName,
    title:        typeof raw.title       === "string" ? raw.title       : undefined,
    description:  typeof raw.description === "string" ? raw.description : undefined,
    url,
    // `externalUrl` is a web page in the Stremio contract, not media input.
    externalUrl: undefined,
    ytId,
    infoHash,
    fileIdx:      Number.isFinite(numericFileIdx) && numericFileIdx >= 0 ? numericFileIdx : undefined,
    size:         positiveNumber(raw.size ?? behaviorHints?.videoSize ?? behaviorHints?.size),
    folderSize:   positiveNumber(raw.folderSize ?? behaviorHints?.folderSize),
    indexer:      optionalText(raw.indexer ?? behaviorHints?.indexer),
    duration:     positiveNumber(raw.duration ?? behaviorHints?.duration),
    languages:    normalizeStringList(raw.languages ?? raw.language ?? behaviorHints?.languages)
      ?? detectStreamLanguages(raw, behaviorHints),
    sources,
    behaviorHints,
    subtitles:    normalizeSubtitles(raw.subtitles),
  } satisfies MediaStream;
  return isPlayableMediaStream(stream) ? stream : null;
}

export function useStreams(query: StreamQuery | null): UseStreamsResult {
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const [streams, setStreams] = useState<MediaStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);

  const streamId = useMemo(() => (query ? buildStreamId(query) : ""), [query]);

  // Ref para acumular resultados sin stale-closure
  const accRef = useRef<MediaStream[]>([]);

  useEffect(() => {
    if (!query || !streamId) {
      setStreams([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const addons = getEnabledAddons().filter(addonHasStreams);
    const addonsFingerprint = addons
      .map(addon => addon.id || addon.url)
      .sort()
      .join("|");
    const cacheKey = `${query.type}:${streamId}:${addonsFingerprint}`;
    const cached = STREAM_CACHE.get(cacheKey);
    const cachedStreams = cached?.streams.filter(isPlayableMediaStream);
    const cachedIsFresh = cached ? Date.now() - cached.updatedAt < STREAM_CACHE_TTL_MS : false;
    const cachedLooksComplete = Boolean(cachedStreams?.length && hasP2pStream(cachedStreams));

    accRef.current = cachedStreams ? [...cachedStreams] : [];
    setStreams(cachedStreams ? [...cachedStreams] : []);
    setLoading(!cachedStreams?.length);
    setError(null);

    if (!addons.length) {
      setLoading(false);
      return;
    }

    if (cachedStreams && cachedIsFresh && cachedLooksComplete && tick === 0) {
      setLoading(false);
      return;
    }

    // ── Non-blocking: lanzar todos en paralelo, actualizar UI al ir llegando ──
    let pending = addons.length;
    let pendingRequests = 0;

    function onAddonDone() {
      if (cancelled) return;
      pending--;
      if (pending === 0 && pendingRequests === 0) setLoading(false);
    }

    function onRequestDone() {
      if (cancelled) return;
      pendingRequests--;
      if (pending === 0 && pendingRequests === 0) setLoading(false);
    }

    for (const addon of addons) {
      const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
      const types = streamRequestTypes(addon, query.type);
      if (!types.length) {
        onAddonDone();
        continue;
      }

      pendingRequests += types.length;
      for (const type of types) {
        resolveAddonStreamId(addon, query, type, streamId)
          .then(requestStreamId => {
            const url = `${base}/stream/${type}/${encodeURIComponent(requestStreamId)}.json`;
            if (DEBUG_STREAMS) console.info("[AETHERIO:STREAMS] request", { addonId: addon.id, addonName: addon.name, type, streamId: requestStreamId, url });
            return fetchStreamPayload(url, 3);
          })
          .then(({ json, status }) => {
            if (DEBUG_STREAMS) console.info("[AETHERIO:STREAMS] response", { addonId: addon.id, type, status, ok: true });
            if (cancelled) return;
            const rawStreams = Array.isArray(json.streams) ? json.streams : [];
            const fresh = rawStreams
              .map((s: any, i: number) => normalizeStream(s, addon.id, addon.name, i))
              .filter(Boolean) as MediaStream[];
            if (DEBUG_STREAMS) {
              console.info("[AETHERIO:STREAMS] payload", {
                addonId: addon.id,
                addonName: addon.name,
                type,
                rawCount: rawStreams.length,
                acceptedCount: fresh.length,
                p2pCount: fresh.filter(item => item.infoHash || (item.sources ?? []).some(source => /^(magnet:|stremio:)/i.test(source))).length,
                sample: rawStreams.slice(0, 3).map((item: any) => ({
                  name: item?.name,
                  hasUrl: typeof item?.url === "string",
                  hasInfoHash: typeof item?.infoHash === "string",
                  sources: Array.isArray(item?.sources) ? item.sources.slice(0, 3) : undefined,
                })),
              });
            }
            if (!fresh.length) return;
            // Merge + dedup incremental
            accRef.current = sortStreamsForPlayback(dedupeStreams([...accRef.current, ...fresh]));
            STREAM_CACHE.set(cacheKey, { streams: [...accRef.current], updatedAt: Date.now() });
            setStreams([...accRef.current]);
          })
          .catch(error => {
            if (DEBUG_STREAMS) console.info("[AETHERIO:STREAMS] error", { addonId: addon.id, type, error: String(error) });
          })
          .finally(onRequestDone);
      }
      onAddonDone();
    }

    return () => { cancelled = true; };
  }, [getEnabledAddons, query, streamId, tick]);

  return {
    streams,
    loading,
    error,
    streamId,
    reload: () => {
      if (query && streamId) {
        const addonsFingerprint = getEnabledAddons()
          .filter(addonHasStreams)
          .map(addon => addon.id || addon.url)
          .sort()
          .join("|");
        const cacheKey = `${query.type}:${streamId}:${addonsFingerprint}`;
        STREAM_CACHE.delete(cacheKey);
      }
      setTick(v => v + 1);
    },
  };
}
