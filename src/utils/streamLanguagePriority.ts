import type { MediaStream, StreamSubtitle } from "../types/stream";

const SPANISH_WORDS = /(?:^|[^a-z0-9])(es(?:-es|-mx|-419)?|spa|spanish|espanol|castellano|latino|latam)(?:[^a-z0-9]|$)/i;
const SPANISH_AUDIO = /(?:audio|dub(?:bed)?|doblaje|idioma)[\s:._-]*(?:es(?:-es|-mx|-419)?|spa|spanish|espanol|castellano|latino|latam)|(?:latino|castellano)[\s:._-]*(?:audio|dub(?:bed)?|doblaje)/i;

function searchableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(searchableText).join(" ");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /(?:audio|lang|language|title|label|name|filename|dub|subtitle)/i.test(key))
    .map(([, item]) => searchableText(item))
    .join(" ");
}

function subtitleIsSpanish(subtitle: StreamSubtitle): boolean {
  return SPANISH_WORDS.test([
    subtitle.lang,
    subtitle.language,
    subtitle.title,
    subtitle.url,
  ].filter(Boolean).join(" "));
}

export function streamSpanishPriority(stream: MediaStream): number {
  const streamText = [
    stream.name,
    stream.title,
    stream.description,
    searchableText(stream.behaviorHints),
  ].filter(Boolean).join(" ");

  if (SPANISH_AUDIO.test(streamText)) return 3;
  if ((stream.subtitles ?? []).some(subtitleIsSpanish)) return 2;
  if (SPANISH_WORDS.test(streamText)) return 1;
  return 0;
}

export function sortStreamsSpanishFirst(streams: MediaStream[]): MediaStream[] {
  return streams
    .map((stream, index) => ({ stream, index, priority: streamSpanishPriority(stream) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(item => item.stream);
}
