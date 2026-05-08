import { invoke } from "@tauri-apps/api/core";
import { getTmdbApiKey } from "../../config/apiKeys";
import type { MediaStream, StreamKind, StreamQuery } from "../../types/stream";
import type { MpvLaunchResult } from "./types";

export const SELECTED_STREAM_KEY = "aetherio-selected-stream";
export const SELECTED_ENGINE_KEY = "aetherio-selected-engine";
export const SELECTED_MEDIA_META_KEY = "aetherio-selected-media-meta";
export const AUTO_NEXT_SOURCE_KEY = "aetherio-auto-next-source";
export const TMDB = "https://api.themoviedb.org/3";
export const IMG = "https://image.tmdb.org/t/p";
export const DETAIL_LOGO_KEY = "aetherio-detail-logo";

export function getDetailLogoKey(type?: string | null, id?: string | null) {
  return type && id ? `${DETAIL_LOGO_KEY}:${type}:${id}` : DETAIL_LOGO_KEY;
}

export function getStreamKind(stream: MediaStream | null): StreamKind {
  const url = (stream?.url ?? stream?.externalUrl ?? "").toLowerCase();
  if (stream?.infoHash || url.startsWith("magnet:") || url.startsWith("stremio:")) return "p2p";
  if (url.startsWith("http://") || url.startsWith("https://")) return "https";
  if (url) return "external";
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
  return (
    stream.url ??
    stream.externalUrl ??
    (stream.ytId ? `https://www.youtube.com/watch?v=${stream.ytId}` : undefined) ??
    (stream.infoHash ? `magnet:?xt=urn:btih:${stream.infoHash}` : undefined) ??
    ""
  );
}

function extractHttpHeaders(stream: MediaStream): Record<string, string> {
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

export async function openExternal(stream: MediaStream, subtitle?: string) {
  const target = getPlaybackTarget(stream);
  if (!target) return { result: null, error: "La fuente no tiene URL reproducible." };
  if (stream.infoHash || target.toLowerCase().startsWith("magnet:") || target.toLowerCase().startsWith("stremio:")) {
    return {
      result: null,
      error: "P2P/torrent esta desactivado por ahora. Usa una fuente HTTP directa.",
    };
  }
  try {
    const headers = extractHttpHeaders(stream);
    const result = await invoke<MpvLaunchResult>("open_mpv", {
      target,
      subtitle,
      headers: Object.keys(headers).length ? headers : undefined,
    });
    return { result, error: null };
  } catch (error) {
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
    season: Number.isFinite(season) && season > 0 ? season : undefined,
    episode: Number.isFinite(episode) && episode > 0 ? episode : undefined,
  };
}

export async function resolveTmdbId(type: string, id: string) {
  if (id.startsWith("tmdb:")) return Number(id.slice(5));
  if (!id.startsWith("tt")) return null;
  const tmdbKey = getTmdbApiKey();
  if (!tmdbKey) return null;
  const mediaType = type === "movie" ? "movie_results" : "tv_results";
  const response = await fetch(`${TMDB}/find/${id}?api_key=${tmdbKey}&external_source=imdb_id&language=es-ES`);
  if (!response.ok) return null;
  const json = await response.json();
  return json[mediaType]?.[0]?.id ?? null;
}
