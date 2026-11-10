import type { LiveSource } from "../types/liveSports.ts";

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const SPANISH = /(?:^|[^a-z0-9])(?:es(?:-[a-z]{2}|-419)?|spa|spanish|espanol|castellano|castilian|latino|latam)(?:$|[^a-z0-9])/;

/** Same URL with different request headers is a different playable route. */
export function liveSourceKey(source: Pick<LiveSource, "url" | "headers" | "referrer" | "userAgent">): string {
  const headers = Object.entries(source.headers ?? {})
    .map(([name, value]) => [name.toLowerCase(), value] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue));
  return `${source.url.trim()}\u0000${JSON.stringify([headers, source.referrer ?? "", source.userAgent ?? ""])}`;
}

/** Commentary only: subtitles or a Spanish competition name do not prove Spanish audio. */
export function spanishCommentaryPriority(source: Pick<LiveSource, "language" | "label">): number {
  const language = fold(source.language?.trim() ?? "");
  if (language && language !== "unknown" && language !== "und") return SPANISH.test(language) ? 2 : 0;
  const label = fold(source.label).replace(/(?:spanish|espanol)\s+(?:subtitles|subs)|(?:subtitles|subs)\s*[:=-]?\s*(?:spanish|espanol)/g, "");
  return SPANISH.test(label) || /🇪🇸|🇵🇪|🇲🇽|🇦🇷|🇨🇴|🇨🇱/.test(label) ? 1 : 0;
}

export function sortLiveSources(sources: readonly LiveSource[]): LiveSource[] {
  return [...sources].sort((a, b) => spanishCommentaryPriority(b) - spanishCommentaryPriority(a)
    || Number(b.providerId === "sports-streams") - Number(a.providerId === "sports-streams"));
}

export function eventCommentaryPriority(event: { sources: readonly LiveSource[] }): number {
  return Math.max(0, ...event.sources.map(spanishCommentaryPriority));
}
