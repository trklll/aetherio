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

const PUBLIC_TORRENT_FALLBACK_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
] as const;

const BTIH_RE = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i;
const MAX_TRACKER_URL_LENGTH = 2_048;
const TRACKER_PROTOCOLS = new Set(["http:", "https:", "udp:"]);

function hasPrivateTorrentHint(stream: MediaStream) {
  const value = stream.behaviorHints?.private;
  if (value === true || value === 1) return true;
  return typeof value === "string" && /^(?:1|true|yes)$/i.test(value.trim());
}

function normalizeTrackerUrl(value: string) {
  const candidate = value.trim();
  if (
    !candidate
    || candidate.length > MAX_TRACKER_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (
      !TRACKER_PROTOCOLS.has(parsed.protocol.toLowerCase())
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function stringStreamSources(stream: MediaStream) {
  return Array.isArray(stream.sources)
    ? stream.sources.filter((source): source is string => typeof source === "string")
    : [];
}

function explicitTrackerSources(stream: MediaStream) {
  const trackers = new Set<string>();
  for (const source of stringStreamSources(stream)) {
    const match = /^tracker:(.+)$/i.exec(source.trim());
    if (!match) continue;
    const tracker = normalizeTrackerUrl(match[1]);
    if (tracker) trackers.add(tracker);
  }
  return [...trackers];
}

function validDirectMagnet(stream: MediaStream) {
  for (const value of [stream.url, ...stringStreamSources(stream)]) {
    if (typeof value !== "string" || !/^magnet:/i.test(value.trim())) continue;
    const raw = value.trim();
    try {
      const parsed = new URL(raw);
      const hasValidInfoHash = parsed.protocol.toLowerCase() === "magnet:"
        && parsed.searchParams.getAll("xt").some(xt => {
          const match = /^urn:btih:(.+)$/i.exec(xt.trim());
          return Boolean(match && BTIH_RE.test(match[1]));
        });
      if (hasValidInfoHash) return { raw, parsed };
    } catch {
      // Ignore malformed magnets and continue with another candidate or infoHash.
    }
  }
  return null;
}

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
  const isPrivate = hasPrivateTorrentHint(stream);
  const suppliedTrackers = isPrivate ? [] : explicitTrackerSources(stream);
  const directMagnet = validDirectMagnet(stream);
  if (directMagnet) {
    // A private magnet is already authoritative: never merge or append tracker sources.
    if (isPrivate) return directMagnet.raw;
    const trackers = new Set(
      directMagnet.parsed.searchParams
        .getAll("tr")
        .map(normalizeTrackerUrl)
        .filter((tracker): tracker is string => Boolean(tracker)),
    );
    for (const tracker of suppliedTrackers) trackers.add(tracker);
    directMagnet.parsed.searchParams.delete("tr");
    for (const tracker of trackers) directMagnet.parsed.searchParams.append("tr", tracker);
    return directMagnet.parsed.toString();
  }
  const infoHash = typeof stream.infoHash === "string" ? stream.infoHash.trim() : "";
  if (!BTIH_RE.test(infoHash)) return "";

  const magnet = new URLSearchParams();
  magnet.set("xt", `urn:btih:${infoHash}`);
  for (const tracker of new Set(suppliedTrackers)) magnet.append("tr", tracker);
  // Torrentio publishes public swarms but omits trackers from its stream payload.
  // Keep arbitrary addons and private hashes isolated from public fallbacks.
  const trustedPublicSwarm = stream.addonId === "com.stremio.torrentio.addon";
  if (!isPrivate && suppliedTrackers.length === 0 && trustedPublicSwarm) {
    for (const tracker of PUBLIC_TORRENT_FALLBACK_TRACKERS) magnet.append("tr", tracker);
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
    const providerSessionKey = typeof stream.behaviorHints?.providerHttpSessionKey === "string"
      ? stream.behaviorHints.providerHttpSessionKey.trim()
      : "";
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
      targetKind: getStreamKind(stream),
      targetHost: /^https?:/i.test(target) ? new URL(target).hostname : undefined,
    });
    const result = await openNativePlayback({
      target,
      subtitle,
      headers: Object.keys(headers).length ? headers : undefined,
      fileIdx: stream.fileIdx,
      episode,
      startTime: normalizedStartTime > 0 ? normalizedStartTime : undefined,
      privateTorrent: getStreamKind(stream) === "p2p" && hasPrivateTorrentHint(stream),
      providerSessionKey: providerSessionKey || undefined,
    });
    console.info("[AETHERIO:PLAYER:OPEN_NATIVE] response", {
      requestedBackend,
      streamId: stream.id,
      backend: result?.backend,
      resolvedHost: typeof result?.resolvedTarget === "string" && /^https?:/i.test(result.resolvedTarget)
        ? new URL(result.resolvedTarget).hostname
        : undefined,
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
      targetKind: getStreamKind(stream),
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
