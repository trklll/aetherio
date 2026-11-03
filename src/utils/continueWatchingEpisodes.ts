import { classifyContinueWatchingEntryKind, type ContinueWatchingEntryKind } from "./continueWatching";
import type { ContinueWatchingEntry } from "./continueWatching";

const HISTORY_EPISODE_SCAN_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export interface ContinueWatchingSeasonEpisodes {
  season: number;
  episodes: Array<{
    episode: number;
    airDate?: string;
    name?: string;
    stillPath?: string;
    runtime?: number;
  }>;
}

export interface NextAiredEpisodePrompt {
  season: number;
  episode: number;
  releaseAt: number;
  episodeName?: string;
  stillPath?: string;
  runtime?: number;
  entryKind: Exclude<ContinueWatchingEntryKind, "resume">;
}

export function getEpisodeAvailabilityPresentation(
  candidate: Pick<NextAiredEpisodePrompt, "season" | "episode" | "entryKind">,
  currentEpisodeCompleted: boolean,
) {
  if (currentEpisodeCompleted) return { createPrompt: true, badgeLabel: undefined };

  if (candidate.entryKind === "next") {
    return { createPrompt: false, badgeLabel: undefined };
  }

  const label = candidate.entryKind === "new-season"
    ? "Nueva temporada"
    : "Episodio disponible";
  return {
    createPrompt: false,
    badgeLabel: label,
  };
}

export function findNextAiredEpisodePrompt(input: {
  watchedSeason: number;
  watchedEpisode: number;
  watchedAt: number;
  seasons: ContinueWatchingSeasonEpisodes[];
  now?: number;
}): NextAiredEpisodePrompt | null {
  const now = input.now ?? Date.now();
  const seasons = [...input.seasons].sort((a, b) => a.season - b.season);

  for (const season of seasons) {
    if (!Number.isFinite(season.season) || season.season < input.watchedSeason) continue;
    const episodes = [...season.episodes].sort((a, b) => a.episode - b.episode);

    for (const episode of episodes) {
      if (!Number.isFinite(episode.episode) || episode.episode <= 0) continue;
      if (season.season === input.watchedSeason && episode.episode <= input.watchedEpisode) continue;

      const releaseAt = parseAirDate(episode.airDate);
      if (!releaseAt || releaseAt > now) continue;

      return {
        season: season.season,
        episode: episode.episode,
        releaseAt,
        episodeName: episode.name,
        stillPath: episode.stillPath,
        runtime: episode.runtime,
        entryKind: classifyContinueWatchingEntryKind({
          nextSeason: season.season,
          watchedSeason: input.watchedSeason,
          releaseAt,
          watchedAt: input.watchedAt,
          now,
        }),
      };
    }
  }

  return null;
}

export function getRecentEpisodeHistorySources(history: ContinueWatchingEntry[], now = Date.now()) {
  const byMedia = new Map<string, { entry: ContinueWatchingEntry; watchedAt: number }>();
  for (const entry of history) {
    if (!isEpisodeHistoryEntry(entry, now)) continue;
    const current = byMedia.get(entry.mediaKey);
    if (!current) {
      byMedia.set(entry.mediaKey, { entry, watchedAt: entry.updatedAt });
      continue;
    }

    const entryIsLaterEpisode = entry.season! > current.entry.season!
      || (entry.season === current.entry.season && entry.episode! > current.entry.episode!);
    byMedia.set(entry.mediaKey, {
      entry: entryIsLaterEpisode ? entry : current.entry,
      watchedAt: Math.max(current.watchedAt, entry.updatedAt),
    });
  }

  return Array.from(byMedia.values())
    .filter(({ watchedAt }) => now - watchedAt <= HISTORY_EPISODE_SCAN_WINDOW_MS)
    .map(({ entry, watchedAt }) => ({
      ...entry,
      updatedAt: watchedAt,
    }));
}

function isEpisodeHistoryEntry(entry: ContinueWatchingEntry, now: number) {
  return entry.completed
    && entry.type !== "movie"
    && typeof entry.season === "number"
    && entry.season > 0
    && typeof entry.episode === "number"
    && entry.episode > 0
    && entry.updatedAt <= now;
}

function parseAirDate(value: string | undefined) {
  if (!value) return 0;
  const local = Date.parse(`${value}T00:00:00`);
  if (Number.isFinite(local)) return local;
  const utc = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(utc) ? utc : 0;
}
