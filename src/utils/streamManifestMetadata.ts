import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { MediaStream, StreamTechnicalMetadata } from "../types/stream.ts";
import { mergeStreamTechnicalMetadata } from "./streamTechnicalMetadata.ts";

interface ProviderHttpResponse {
  status: number;
  headers?: Record<string, string>;
  bodyBase64?: string;
}

const MANIFEST_CACHE_TTL_MS = 10 * 60 * 1000;
const MANIFEST_ERROR_TTL_MS = 60 * 1000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_CONCURRENT_INSPECTIONS = 3;
const manifestCache = new Map<string, { expiresAt: number; value: StreamTechnicalMetadata | null }>();
const pendingInspections = new Map<string, Promise<StreamTechnicalMetadata | null>>();
let activeInspections = 0;
const inspectionQueue: Array<() => void> = [];

function withInspectionSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeInspections += 1;
      task().then(resolve, reject).finally(() => {
        activeInspections -= 1;
        inspectionQueue.shift()?.();
      });
    };
    if (activeInspections < MAX_CONCURRENT_INSPECTIONS) run();
    else inspectionQueue.push(run);
  });
}

function requestHeaders(stream: MediaStream) {
  const hints = stream.behaviorHints ?? {};
  const proxyHeaders = hints.proxyHeaders && typeof hints.proxyHeaders === "object"
    ? hints.proxyHeaders as Record<string, unknown>
    : {};
  const candidates = [proxyHeaders.request, hints.headers];
  return Object.fromEntries(candidates.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()));
  }));
}

function decodeBase64(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const binary = atob(value);
    if (binary.length > MAX_MANIFEST_BYTES) return null;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function parseAttributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  for (const match of source.matchAll(pattern)) result[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "").trim();
  return result;
}

function codecMetadata(codecs: string | undefined, current?: StreamTechnicalMetadata): StreamTechnicalMetadata | undefined {
  if (!codecs) return current;
  const values = codecs.toLowerCase();
  const videoCodec = /(?:avc1|avc3|h264)/.test(values)
    ? "H.264"
    : /(?:hev1|hvc1|hevc|h265)/.test(values)
      ? "HEVC"
      : /av01/.test(values)
        ? "AV1"
        : /vp09|vp9/.test(values)
          ? "VP9"
          : current?.videoCodec;
  const audioCodec = /(?:ec-3|eac3|ddp)/.test(values)
    ? "E-AC-3"
    : /(?:ac-3|ac3)/.test(values)
      ? "AC-3"
      : /(?:mp4a|aac)/.test(values)
        ? "AAC"
        : /opus/.test(values)
          ? "Opus"
          : current?.audioCodec;
  return mergeStreamTechnicalMetadata(current, { videoCodec, audioCodec });
}

export function parseHlsManifest(manifest: string): StreamTechnicalMetadata | null {
  if (!/#EXTM3U/i.test(manifest)) return null;
  let metadata: StreamTechnicalMetadata | undefined;
  for (const line of manifest.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXT-X-STREAM-INF:")) {
      const attrs = parseAttributes(trimmed.slice(trimmed.indexOf(":") + 1));
      const resolution = attrs.RESOLUTION?.match(/(\d+)x(\d+)/i);
      const height = resolution ? Number(resolution[2]) : undefined;
      const videoRange = attrs["VIDEO-RANGE"]?.toUpperCase();
      metadata = mergeStreamTechnicalMetadata(metadata, {
        resolutionHeight: height,
        dynamicRange: videoRange === "SDR" ? "SDR" : videoRange === "PQ" || videoRange === "HLG" ? "HDR" : attrs["VIDEO-RANGE"],
      });
      metadata = codecMetadata(attrs.CODECS, metadata);
    } else if (trimmed.startsWith("#EXT-X-MEDIA:") && /TYPE=AUDIO/i.test(trimmed)) {
      const attrs = parseAttributes(trimmed.slice(trimmed.indexOf(":") + 1));
      const channelMatch = attrs.CHANNELS?.match(/\d+/);
      const channels = channelMatch ? Number(channelMatch[0]) : undefined;
      metadata = mergeStreamTechnicalMetadata(metadata, {
        audioChannels: channels,
        audioCodec: attrs.CODECS,
      });
      metadata = codecMetadata(attrs.CODECS, metadata);
      if (/joc|atmos/i.test(attrs.CHANNELS ?? "") || /joc|atmos/i.test(attrs.CODECS ?? "") || /joc|atmos/i.test(attrs.NAME ?? "")) {
        metadata = mergeStreamTechnicalMetadata(metadata, { audioCodec: `${metadata?.audioCodec ?? ""} Atmos` });
      }
    }
  }
  return metadata ?? null;
}

function xmlAttribute(element: Element | null, name: string) {
  return element?.getAttribute(name) ?? undefined;
}

export function parseDashManifest(manifest: string): StreamTechnicalMetadata | null {
  if (!/<MPD\b/i.test(manifest)) return null;
  let metadata: StreamTechnicalMetadata | undefined;
  try {
    if (typeof DOMParser !== "undefined") {
      const document = new DOMParser().parseFromString(manifest, "application/xml");
      for (const representation of Array.from(document.querySelectorAll("Representation"))) {
        const adaptation = representation.parentElement;
        const mimeType = xmlAttribute(representation, "mimeType") ?? xmlAttribute(adaptation, "mimeType") ?? "";
        const codecs = xmlAttribute(representation, "codecs") ?? xmlAttribute(adaptation, "codecs");
        const height = Number(xmlAttribute(representation, "height") ?? xmlAttribute(adaptation, "height"));
        if (/video/i.test(mimeType) || height > 0) {
          metadata = mergeStreamTechnicalMetadata(metadata, { resolutionHeight: height || undefined });
          metadata = codecMetadata(codecs, metadata);
        }
        if (/audio/i.test(mimeType) || /audio/i.test(xmlAttribute(adaptation, "contentType") ?? "")) {
          const channelElement = adaptation?.querySelector("AudioChannelConfiguration") ?? representation.querySelector("AudioChannelConfiguration");
          const channels = Number(xmlAttribute(channelElement, "value")?.match(/\d+/)?.[0]);
          metadata = mergeStreamTechnicalMetadata(metadata, { audioChannels: channels || undefined });
          metadata = codecMetadata(codecs, metadata);
        }
      }
      for (const adaptation of Array.from(document.querySelectorAll("AdaptationSet"))) {
        const mimeType = xmlAttribute(adaptation, "mimeType") ?? "";
        const channelsElement = adaptation.querySelector("AudioChannelConfiguration");
        if (channelsElement && (/audio/i.test(mimeType) || /audio/i.test(xmlAttribute(adaptation, "contentType") ?? ""))) {
          const channels = Number(xmlAttribute(channelsElement, "value")?.match(/\d+/)?.[0]);
          metadata = mergeStreamTechnicalMetadata(metadata, { audioChannels: channels || undefined });
          metadata = codecMetadata(xmlAttribute(adaptation, "codecs"), metadata);
        }
        const adaptationHeight = Number(xmlAttribute(adaptation, "height"));
        if (adaptationHeight > 0) metadata = mergeStreamTechnicalMetadata(metadata, { resolutionHeight: adaptationHeight });
        metadata = codecMetadata(xmlAttribute(adaptation, "codecs"), metadata);
      }
      if (/dolby[ ._-]?vision|dvhe/i.test(manifest)) metadata = mergeStreamTechnicalMetadata(metadata, { dynamicRange: "Dolby Vision" });
      else if (/hdr10\+|smpte2094-40/i.test(manifest)) metadata = mergeStreamTechnicalMetadata(metadata, { dynamicRange: "HDR10+" });
      else if (/hdr10|st2084|smpte2084/i.test(manifest)) metadata = mergeStreamTechnicalMetadata(metadata, { dynamicRange: "HDR10" });
    }
  } catch {
    // Fall through to the conservative attribute scan below.
  }
  if (!metadata) {
    const dimensions = [...manifest.matchAll(/(?:width=["']\d+["'][^>]*height|height=["'])(?:["']?)(\d{3,5})/gi)]
      .map(match => Number(match[1])).filter(Number.isFinite);
    metadata = mergeStreamTechnicalMetadata(metadata, { resolutionHeight: Math.max(...dimensions) || undefined });
    metadata = codecMetadata(manifest, metadata);
    const channelMatch = manifest.match(/(?:AudioChannelConfiguration[^>]*value|audioChannels)=["'](\d+)/i);
    metadata = mergeStreamTechnicalMetadata(metadata, { audioChannels: channelMatch ? Number(channelMatch[1]) : undefined });
  }
  return metadata ?? null;
}

function manifestKind(url: string, contentType?: string) {
  if (/\.m3u8(?:$|[?#])/i.test(url)) return "hls";
  if (/\.mpd(?:$|[?#])/i.test(url)) return "dash";
  if (/mpegurl|vnd\.apple\.mpegurl/i.test(contentType ?? "")) return "hls";
  if (/dash\+xml/i.test(contentType ?? "")) return "dash";
  return null;
}

export function shouldInspectStreamManifest(stream: MediaStream) {
  const url = stream.url?.trim();
  return Boolean(url && /^https?:\/\//i.test(url) && !/\.(?:mp4|mkv|webm|avi)(?:$|[?#])/i.test(url));
}

async function request(url: string, method: "HEAD" | "GET", headers: Record<string, string>) {
  return invokeCommand<ProviderHttpResponse>("provider_http_request", { request: { url, method, headers } });
}

async function inspect(url: string, headers: Record<string, string>): Promise<StreamTechnicalMetadata | null> {
  let response: ProviderHttpResponse;
  const knownKind = manifestKind(url);
  if (knownKind) response = await request(url, "GET", headers);
  else {
    response = await request(url, "HEAD", headers);
    const contentType = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1];
    const kind = manifestKind(url, contentType);
    if (!kind) return null;
    response = await request(url, "GET", headers);
  }
  if (response.status < 200 || response.status >= 300) return null;
  const body = decodeBase64(response.bodyBase64);
  if (!body) return null;
  const kind = manifestKind(url, Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1]);
  return kind === "hls" ? parseHlsManifest(body) : kind === "dash" ? parseDashManifest(body) : null;
}

export function inspectStreamManifest(stream: MediaStream): Promise<StreamTechnicalMetadata | null> {
  if (!isTauriRuntime() || !shouldInspectStreamManifest(stream) || !stream.url) return Promise.resolve(null);
  const key = stream.url;
  const cached = manifestCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  const pending = pendingInspections.get(key);
  if (pending) return pending;
  const promise = withInspectionSlot(() => inspect(stream.url!, requestHeaders(stream)))
    .catch(() => null)
    .then(value => {
      manifestCache.set(key, { value, expiresAt: Date.now() + (value ? MANIFEST_CACHE_TTL_MS : MANIFEST_ERROR_TTL_MS) });
      return value;
    })
    .finally(() => pendingInspections.delete(key));
  pendingInspections.set(key, promise);
  return promise;
}
