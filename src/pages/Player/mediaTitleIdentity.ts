import type { StreamQuery } from "../../types/stream";

export type MediaTitleIdentity =
  | { kind: "movie"; tmdbId?: number; imdbId?: string }
  | { kind: "episode"; showTmdbId?: number; showImdbId?: string; season: number; episode: number };

export function buildMediaTitleIdentity(
  query: StreamQuery | null | undefined,
): MediaTitleIdentity | null {
  if (!query) return null;
  const baseId = query.id
    .replace(/^tmdb:/i, "")
    .replace(/^imdb:/i, "")
    .replace(/^(?:movie|series):/i, "")
    .split(":")[0]
    .split("/")[0]
    .trim();
  const imdbId = /^tt\d+$/i.test(baseId) ? baseId : undefined;
  const tmdbId = /^\d+$/.test(baseId) ? Number(baseId) : undefined;
  if (!imdbId && !tmdbId) return null;

  const isSeries = ["series", "tv", "show", "anime"].includes(query.type.toLowerCase());
  if (isSeries && query.season !== undefined && query.episode !== undefined) {
    return {
      kind: "episode",
      showTmdbId: tmdbId,
      showImdbId: imdbId,
      season: query.season,
      episode: query.episode,
    };
  }
  return { kind: "movie", tmdbId, imdbId };
}

export function mediaTitleIdentityKey(identity: MediaTitleIdentity | null): string {
  if (!identity) return "";
  if (identity.kind === "movie") {
    if (identity.tmdbId) return `movie:tmdb:${identity.tmdbId}`;
    if (identity.imdbId) return `movie:${identity.imdbId}`;
    return "";
  }
  if (identity.showTmdbId) return `episode:tmdb:${identity.showTmdbId}:${identity.season}:${identity.episode}`;
  if (identity.showImdbId) return `episode:${identity.showImdbId}:${identity.season}:${identity.episode}`;
  return "";
}
