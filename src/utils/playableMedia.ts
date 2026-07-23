import type { MediaStream } from "../types/stream";

const HTTP_URL_RE = /^https?:\/\//i;
const DIRECT_PROTOCOL_RE = /^(?:rtmp|rtmps|rtsp|rtsps|srt):\/\//i;
const MEDIA_EXTENSION_RE = /\.(?:m3u8|mpd|mp4|m4v|mkv|webm|avi|mov|wmv|flv|ogv|ogg|mpg|mpeg|m2ts|mts|ts|vob)(?:$|[?#])/i;
const HEX_BTIH_RE = /^[a-f0-9]{40}$/i;
const BASE32_BTIH_RE = /^[a-z2-7]{32}$/i;

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Returns a canonical BitTorrent v1 info-hash, or undefined when invalid. */
export function normalizeBtih(value: unknown): string | undefined {
  const target = normalized(value);
  if (!HEX_BTIH_RE.test(target) && !BASE32_BTIH_RE.test(target)) return undefined;
  return target.toLowerCase();
}

/** Extracts and validates the btih topic from a magnet URI. */
export function getMagnetBtih(value: unknown): string | undefined {
  const target = normalized(value);
  if (!/^magnet:\?/i.test(target)) return undefined;
  const queryIndex = target.indexOf("?");
  if (queryIndex < 0) return undefined;
  try {
    const params = new URLSearchParams(target.slice(queryIndex + 1));
    for (const [key, topic] of params.entries()) {
      if (key.toLowerCase() !== "xt") continue;
      const match = topic.match(/^urn:btih:(.+)$/i);
      const infoHash = normalizeBtih(match?.[1]);
      if (infoHash) return infoHash;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isValidMagnetUri(value: unknown): boolean {
  return getMagnetBtih(value) !== undefined;
}

export function isLookupPageUrl(value: unknown): boolean {
  const target = normalized(value);
  if (!HTTP_URL_RE.test(target)) return false;
  try {
    const url = new URL(target);
    const hasSearchRoute = url.pathname
      .split("/")
      .some(segment => /^(?:search|buscar|busqueda|query)$/i.test(segment));
    const hasQueryParameter = [...url.searchParams.keys()]
      .some(key => /^(?:query|search)$/i.test(key));
    return hasSearchRoute || hasQueryParameter;
  } catch {
    return true;
  }
}

/** URLs whose path identifies a media file or streaming manifest. */
export function isDirectMediaUrl(value: unknown): value is string {
  const target = normalized(value);
  if (!target) return false;
  if (DIRECT_PROTOCOL_RE.test(target)) return true;
  return HTTP_URL_RE.test(target) && !isLookupPageUrl(target) && MEDIA_EXTENSION_RE.test(target);
}

function isDeclaredDirectUrl(stream: MediaStream): boolean {
  const target = normalized(stream.url);
  if (!target || !HTTP_URL_RE.test(target)) return false;
  if (isLookupPageUrl(target)) return false;

  const hints = stream.behaviorHints as Record<string, unknown> | undefined;
  if (hints?.scraperPlayback === "iframe" || hints?.notWebReady === true) return false;

  // Native scrapers do not have a provider contract: require a concrete media
  // extension so a search/detail page can never be mistaken for a stream.
  if (stream.addonId === "scraper") {
    return hints?.scraperResolvedDirect === true || isDirectMediaUrl(target);
  }

  // Stremio, Nuvio and Seanime expose `url` as their direct playback field.
  // Their external web page belongs in `externalUrl`, which is never accepted.
  return true;
}

export function getDirectPlaybackUrl(stream: MediaStream | null | undefined): string {
  if (!stream) return "";
  const target = normalized(stream.url);
  if (isDirectMediaUrl(target) || isDeclaredDirectUrl(stream)) return target;

  return (stream.sources ?? [])
    .map(normalized)
    .find(isDirectMediaUrl) ?? "";
}

export function hasP2pPlayback(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  if (normalizeBtih(stream.infoHash)) return true;
  return [stream.url, ...(stream.sources ?? [])]
    .some(isValidMagnetUri);
}

export function isPlayableMediaStream(stream: MediaStream | null | undefined): stream is MediaStream {
  if (!stream) return false;
  return Boolean(getDirectPlaybackUrl(stream) || hasP2pPlayback(stream) || normalized(stream.ytId));
}
