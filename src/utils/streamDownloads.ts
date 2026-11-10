import type { MediaStream } from "../types/stream";
import { isValidMagnetUri, normalizeBtih } from "./playableMedia.ts";

export type DownloadTransport = "http" | "hls" | "dash" | "torrent" | "youtube";

export interface StreamDownloadAvailability {
  supported: boolean;
  transport?: DownloadTransport;
  reason?: string;
}

const KNOWN_MEDIA_EXTENSIONS = /\.(?:mp4|mkv|m4v|avi|mov|webm|ts|m2ts)$/i;

/**
 * Only expose downloads for formats the native downloader can store as a
 * playable file. Unsupported streams stay playable; the reason is shown in
 * the source picker instead of producing a corrupt/offline artifact.
 */
export function getStreamDownloadAvailability(stream: MediaStream): StreamDownloadAvailability {
  const hints = stream.behaviorHints;
  if (hints?.live === true || hints?.sourceType === "iptv") {
    return { supported: false, reason: "Los canales en directo no se pueden descargar." };
  }
  if (hints?.localFile === true) {
    return { supported: false, reason: "Este archivo ya está guardado en el dispositivo." };
  }

  const rawUrl = typeof stream.url === "string" ? stream.url.trim() : "";
  if (/^magnet:/i.test(rawUrl)) {
    return isValidMagnetUri(rawUrl)
      ? { supported: true, transport: "torrent" }
      : { supported: false, reason: "La fuente torrent no contiene un info-hash válido." };
  }
  if (isYouTubeUrl(rawUrl)) {
    return { supported: true, transport: "youtube" };
  }
  const sourceMagnet = stream.sources?.find(source => /^magnet:/i.test(source.trim()));
  if (!rawUrl && sourceMagnet) {
    return isValidMagnetUri(sourceMagnet)
      ? { supported: true, transport: "torrent" }
      : { supported: false, reason: "La fuente torrent no contiene un info-hash válido." };
  }
  if (!rawUrl && stream.infoHash) {
    return normalizeBtih(stream.infoHash)
      ? { supported: true, transport: "torrent" }
      : { supported: false, reason: "La fuente torrent no contiene un info-hash válido." };
  }
  if (!rawUrl) {
    if (stream.ytId?.trim()) {
      return { supported: true, transport: "youtube" };
    }
    return { supported: false, reason: "La fuente no contiene un enlace de medios descargable." };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { supported: false, reason: "La fuente no usa un enlace HTTP descargable." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { supported: false, reason: "Solo se pueden descargar fuentes HTTP o HTTPS." };
  }

  if (/\.mpd$/i.test(url.pathname)) {
    return { supported: true, transport: "dash" };
  }
  if (/\.m3u8$/i.test(url.pathname)) {
    return { supported: true, transport: "hls" };
  }
  return { supported: true, transport: "http" };
}

export function getStreamDownloadTarget(stream: MediaStream): string | undefined {
  const rawUrl = typeof stream.url === "string" ? stream.url.trim() : "";
  if (rawUrl) return rawUrl;

  const magnet = stream.sources?.find(source => isValidMagnetUri(source.trim()));
  if (magnet) return magnet.trim();

  const infoHash = normalizeBtih(stream.infoHash);
  if (infoHash) return `magnet:?xt=urn:btih:${infoHash}`;

  const videoId = stream.ytId?.trim();
  if (videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  return undefined;
}

function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "youtu.be"
      || hostname === "youtube.com"
      || hostname.endsWith(".youtube.com")
      || hostname === "youtube-nocookie.com"
      || hostname.endsWith(".youtube-nocookie.com")
      || hostname === "youtube.googleapis.com"
      || hostname.endsWith(".youtube.googleapis.com")
      || hostname === "youtubei.googleapis.com"
      || hostname.endsWith(".youtubei.googleapis.com");
  } catch {
    return false;
  }
}

export function sanitizeDownloadFilename(title: string, extension: string): string {
  const normalizedExtension = /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : ".mp4";
  const withoutKnownExtension = title.trim().replace(KNOWN_MEDIA_EXTENSIONS, "");
  const safe = withoutKnownExtension
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "")
    .replace(/^_+|[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 150)
    .trim();
  return `${safe || "video"}${normalizedExtension}`;
}
