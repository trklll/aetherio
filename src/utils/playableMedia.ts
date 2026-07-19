import type { MediaStream } from "../types/stream";

const HTTP_URL_RE = /^https?:\/\//i;
const DIRECT_PROTOCOL_RE = /^(?:rtmp|rtmps|rtsp|rtsps|srt):\/\//i;
const P2P_TARGET_RE = /^(?:magnet:|stremio:)/i;
const MEDIA_EXTENSION_RE = /\.(?:m3u8|mpd|mp4|m4v|mkv|webm|avi|mov|wmv|flv|ogv|ogg|mpg|mpeg|m2ts|mts|ts|vob)(?:$|[?#])/i;

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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
  if (stream.addonId === "scraper") return isDirectMediaUrl(target);

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
  if (normalized(stream.infoHash)) return true;
  return [stream.url, ...(stream.sources ?? [])]
    .some(value => P2P_TARGET_RE.test(normalized(value)));
}

export function isPlayableMediaStream(stream: MediaStream | null | undefined): stream is MediaStream {
  if (!stream) return false;
  return Boolean(getDirectPlaybackUrl(stream) || hasP2pPlayback(stream) || normalized(stream.ytId));
}
