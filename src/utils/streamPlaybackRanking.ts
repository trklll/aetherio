import type { MediaStream } from "../types/stream";
import { getDirectPlaybackUrl, hasP2pPlayback, isPlayableMediaStream } from "./playableMedia";
import { streamSpanishPriority } from "./streamLanguagePriority";
import { getReportedSeeders, torrentHealthScore } from "./torrentHealth";

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

export function sortStreamsForPlayback(streams: MediaStream[]): MediaStream[] {
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((left, right) => {
      const availabilityPriority = Number(isKnownDeadTorrent(left.stream)) - Number(isKnownDeadTorrent(right.stream));
      const languagePriority = streamSpanishPriority(right.stream) - streamSpanishPriority(left.stream);
      const healthPriority = playbackScore(right.stream) - playbackScore(left.stream);
      return availabilityPriority || languagePriority || healthPriority || left.index - right.index;
    })
    .map(item => item.stream);
}
