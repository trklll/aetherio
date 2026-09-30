import type { MediaStream } from "../types/stream.ts";
import { getEstimatedConnectionSpeedBps } from "./connectionSpeed";
import { getDirectPlaybackUrl, hasP2pPlayback, isPlayableMediaStream } from "./playableMedia";
import { streamSpanishPriority } from "./streamLanguagePriority";
import { getReportedSeeders, torrentHealthScore } from "./torrentHealth";

export interface StreamPlaybackRankingOptions {
  preferAnimeAv1?: boolean;
  connectionSpeedBps?: number;
}

const ANIME_SOURCE_ORDER = [
  "animes",
  "animeav1",
  "animeflv",
  "gojowtf",
  "animekai",
  "torrentio",
  "nyaasi",
  "seadex",
  "animetosho",
  "thepiratebay",
  "animesaturn",
  "animesaturnmirror",
  "animeunity",
  "animeunitymirror",
  "animeworld",
] as const;

function hasTorrentSignals(stream: MediaStream): boolean {
  return hasP2pPlayback(stream);
}

function isKnownDeadTorrent(stream: MediaStream): boolean {
  return hasTorrentSignals(stream)
    && !getDirectPlaybackUrl(stream)
    && getReportedSeeders(stream) === 0;
}

function playbackScore(stream: MediaStream): number {
  const hints = stream.behaviorHints ?? {};
  const notWebReady = Boolean(hints.notWebReady);
  const lowerName = (stream.name ?? "").toLowerCase();
  const hasDirectUrl = typeof stream.url === "string" && /^https?:\/\//i.test(stream.url);
  const hasHttpSource = (stream.sources ?? []).some(item => /^https?:\/\//i.test(item));
  const torrentSignals = hasTorrentSignals(stream);

  let score = 0;
  if (hasDirectUrl) score += 50;
  if (torrentSignals) score += 38 + torrentHealthScore(stream);
  if (hasHttpSource) score += 20;
  if (stream.subtitles?.length) score += 8;
  if (typeof hints.videoSize === "number" && hints.videoSize > 0) score += 4;
  if (notWebReady || !isPlayableMediaStream(stream)) score -= 100;
  if (lowerName.includes("cam")) score -= 12;
  return score;
}

function normalizeSourceToken(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

export function animeSourcePriority(sourceName: string): number {
  const token = normalizeSourceToken(sourceName);
  const exactIndex = ANIME_SOURCE_ORDER.findIndex(source => token === source);
  if (exactIndex !== -1) return exactIndex;
  const index = ANIME_SOURCE_ORDER.findIndex(source => source !== "animes" && token.includes(source));
  return index === -1 ? ANIME_SOURCE_ORDER.length : index;
}

function streamAnimeSourcePriority(stream: MediaStream): number {
  const sourceText = [
    stream.addonId,
    stream.addonName,
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
  ].filter(Boolean).join(" ");
  return animeSourcePriority(sourceText);
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function streamBitrateBps(stream: MediaStream): number | null {
  const hints = stream.behaviorHints ?? {};
  const explicit = positiveNumber(hints.bitrate ?? hints.bandwidth ?? hints.videoBitrate);
  if (explicit) return explicit;
  const sizeBytes = positiveNumber(hints.videoSize) ?? positiveNumber(stream.size);
  const durationSeconds = positiveNumber(stream.duration);
  if (!sizeBytes || !durationSeconds || durationSeconds < 600 || durationSeconds > 21_600) return null;
  return (sizeBytes * 8) / durationSeconds;
}

function connectionFitPriority(stream: MediaStream, connectionSpeedBps: number): number {
  if (connectionSpeedBps <= 0 || hasP2pPlayback(stream)) return -1;
  const bitrate = streamBitrateBps(stream);
  if (!bitrate) return 1;
  return bitrate * 1.5 <= connectionSpeedBps ? 0 : 2;
}

export function sortStreamsForPlayback(
  streams: MediaStream[],
  options: StreamPlaybackRankingOptions = {},
): MediaStream[] {
  const connectionSpeedBps = options.connectionSpeedBps ?? getEstimatedConnectionSpeedBps();
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      const availabilityPriority = Number(isKnownDeadTorrent(left.stream)) - Number(isKnownDeadTorrent(right.stream));
      const animeSourceOrder = options.preferAnimeAv1
        ? streamAnimeSourcePriority(left.stream) - streamAnimeSourcePriority(right.stream)
        : 0;
      const languagePriority = streamSpanishPriority(right.stream) - streamSpanishPriority(left.stream);
      const fitPriority = connectionFitPriority(left.stream, connectionSpeedBps) - connectionFitPriority(right.stream, connectionSpeedBps);
      const bitratePriority = fitPriority === 0
        ? (streamBitrateBps(right.stream) ?? 0) - (streamBitrateBps(left.stream) ?? 0)
        : 0;
      const healthPriority = playbackScore(right.stream) - playbackScore(left.stream);
      return availabilityPriority
        || animeSourceOrder
        || languagePriority
        || fitPriority
        || bitratePriority
        || healthPriority
        || left.index - right.index;
    })
    .map(item => item.stream);
}
