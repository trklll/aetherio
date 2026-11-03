import type { LiveSource } from "../types/liveSports.ts";

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const SPANISH = /(?:^|[^a-z0-9])(?:es(?:-[a-z]{2}|-419)?|spa|spanish|espanol|castellano|castilian|latino|latam)(?:$|[^a-z0-9])/;

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
