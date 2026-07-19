import { tmdbFetch } from "../../config/apiKeys";
import { isAndroidRuntime, openNativePlayback } from "../../runtime/platform";
import type { MediaStream, StreamKind, StreamQuery } from "../../types/stream";
import { getDirectPlaybackUrl, hasP2pPlayback } from "../../utils/playableMedia";

export const SELECTED_STREAM_KEY = "aetherio-selected-stream";
export const SELECTED_ENGINE_KEY = "aetherio-selected-engine";
export const SELECTED_MEDIA_META_KEY = "aetherio-selected-media-meta";
export const SELECTED_PLAYBACK_OVERRIDES_KEY = "aetherio-selected-playback-overrides";
export const AUTO_NEXT_SOURCE_KEY = "aetherio-auto-next-source";
export const TMDB = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p";
export const DETAIL_LOGO_KEY = "aetherio-detail-logo";

export function getDetailLogoKey(type?: string | null, id?: string | null) {
  return type && id ? `${DETAIL_LOGO_KEY}:${type}:${id}` : DETAIL_LOGO_KEY;
}

export function getStreamKind(stream: MediaStream | null): StreamKind {
  if (getDirectPlaybackUrl(stream)) return "https";
  if (hasP2pPlayback(stream)) return "p2p";
  return "unknown";
}

export function formatTime(value: number) {
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getPlaybackTarget(stream: MediaStream | null | undefined) {
  if (!stream) return "";
  const directUrl = getDirectPlaybackUrl(stream);
  const magnet = directUrl ? "" : buildMagnetTarget(stream);
  return directUrl
    || magnet
    || (stream.ytId ? `https://www.youtube.com/watch?v=${stream.ytId}` : "")
    || "";
}

function buildMagnetTarget(stream: MediaStream) {
  const directMagnet = [stream.url, ...(stream.sources ?? [])]
    .find(value => typeof value === "string" && /^(?:magnet:|stremio:)/i.test(value));
  if (directMagnet) return directMagnet;
  if (!stream.infoHash) return "";

  const magnet = new URLSearchParams();
  magnet.set("xt", `urn:btih:${stream.infoHash}`);
  for (const source of stream.sources ?? []) {
    const tracker = source.replace(/^tracker:/i, "").trim();
    if (/^https?:\/\//i.test(tracker) || /^udp:\/\//i.test(tracker)) {
      magnet.append("tr", tracker);
    }
  }
  if (stream.title || stream.behaviorHints?.filename) {
    magnet.set("dn", String(stream.behaviorHints?.filename ?? stream.title));
  }
  return `magnet:?${magnet.toString()}`;
}

export function extractHttpHeaders(stream: MediaStream): Record<string, string> {
  const hints = stream.behaviorHints as Record<string, unknown> | undefined;
  if (!hints) return {};

  const headers: Record<string, string> = {};
  const appendFromObject = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof rawValue !== "string") continue;
      const normalizedKey = key.trim();
      const normalizedValue = rawValue.trim();
      if (!normalizedKey || !normalizedValue) continue;
      headers[normalizedKey] = normalizedValue;
    }
  };

  appendFromObject(hints.headers);
  appendFromObject(hints.proxyHeaders);
  const proxyHeaders = hints.proxyHeaders as Record<string, unknown> | undefined;
  appendFromObject(proxyHeaders?.request);

  if (!headers["Referer"] && typeof hints.referrer === "string" && hints.referrer.trim()) {
    headers.Referer = hints.referrer.trim();
  }
  if (!headers["User-Agent"] && typeof hints.userAgent === "string" && hints.userAgent.trim()) {
    headers["User-Agent"] = hints.userAgent.trim();
  }

  return headers;
}

export async function openExternal(stream: MediaStream, subtitle?: string, startTime = 0, episode?: number) {
  const target = getPlaybackTarget(stream);
  if (!target) return { result: null, error: "La fuente no tiene URL reproducible." };
  const normalizedStartTime = Number.isFinite(startTime) ? Math.max(0, startTime) : 0;
  try {
    const headers = extractHttpHeaders(stream);
    const requestedBackend = isAndroidRuntime() ? "android-media3" : "mpv";
    console.info("[AETHERIO:PLAYER:OPEN_NATIVE] request", {
      backend: requestedBackend,
      streamId: stream.id,
      addonId: stream.addonId,
      fileIdx: stream.fileIdx,
      episode,
      startTime: normalizedStartTime,
      hasSubtitle: Boolean(subtitle?.trim()),
      hasHeaders: Object.keys(headers).length > 0,
      targetPrefix: target.slice(0, 240),
    });
    const result = await openNativePlayback({
      target,
      subtitle,
      headers: Object.keys(headers).length ? headers : undefined,
      fileIdx: stream.fileIdx,
      episode,
      startTime: normalizedStartTime > 0 ? normalizedStartTime : undefined,
    });
    console.info("[AETHERIO:PLAYER:OPEN_NATIVE] response", {
      requestedBackend,
      streamId: stream.id,
      backend: result?.backend,
      resolvedTarget: result?.resolvedTarget,
      logPath: result?.logPath,
      bridgeLogPath: result?.bridgeLogPath,
      p2pLogPath: result?.p2pLogPath,
    });
    return { result, error: null };
  } catch (error) {
    console.error("[AETHERIO:PLAYER:OPEN_NATIVE] error", {
      backend: isAndroidRuntime() ? "android-media3" : "mpv",
      streamId: stream.id,
      error: String(error),
      targetPrefix: target.slice(0, 240),
    });
    return { result: null, error: String(error) };
  }
}

export function buildQuery(params: URLSearchParams): StreamQuery | null {
  const type = params.get("type");
  const id = params.get("id");
  if (!type || !id) return null;
  const season = Number(params.get("season"));
  const episode = Number(params.get("ep"));
  return {
    type,
    id,
    season: Number.isFinite(season) && season >= 0 ? season : undefined,
    episode: Number.isFinite(episode) && episode > 0 ? episode : undefined,
  };
}

export function playbackOverrideQueryKey(query: StreamQuery | null | undefined) {
  if (!query?.type || !query.id) return "";
  return [
    query.type,
    query.id,
    query.season ?? "",
    query.episode ?? "",
  ].join(":");
}

export async function resolveTmdbId(type: string, id: string) {
  if (id.startsWith("tmdb:")) return Number(id.slice(5));
  if (!id.startsWith("tt")) return null;
  const mediaType = type === "movie" ? "movie_results" : "tv_results";
  const json = await tmdbFetch(`/find/${id}`, { params: { external_source: "imdb_id", language: "es-ES" } });
  if (!json) return null;
  return json[mediaType]?.[0]?.id ?? null;
}
