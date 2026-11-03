import { describe, expect, it } from "vitest";
import type { ContinueWatchingEntry } from "./continueWatching";
import {
  findNextAiredEpisodePrompt,
  getEpisodeAvailabilityPresentation,
  getRecentEpisodeHistorySources,
} from "./continueWatchingEpisodes";

describe("continue-watching next aired episode", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");

  it("finds a newly released episode after the episode the user left on", () => {
    const result = findNextAiredEpisodePrompt({
      watchedSeason: 1,
      watchedEpisode: 3,
      watchedAt: now - 8 * 24 * 60 * 60 * 1000,
      now,
      seasons: [{
        season: 1,
        episodes: [
          { episode: 3, airDate: "2026-10-01", name: "Capítulo 3" },
          { episode: 4, airDate: "2026-11-01", name: "Capítulo 4" },
          { episode: 5, airDate: "2026-11-08", name: "Capítulo 5" },
        ],
      }],
    });

    expect(result).toMatchObject({
      season: 1,
      episode: 4,
      episodeName: "Capítulo 4",
      entryKind: "new",
    });
  });

  it("does not offer an episode before its release date", () => {
    const result = findNextAiredEpisodePrompt({
      watchedSeason: 1,
      watchedEpisode: 3,
      watchedAt: now - 8 * 24 * 60 * 60 * 1000,
      now,
      seasons: [{
        season: 1,
        episodes: [{ episode: 4, airDate: "2026-11-03", name: "Capítulo 4" }],
      }],
    });

    expect(result).toBeNull();
  });

  it("marks the first aired episode of a later season as a new season", () => {
    const result = findNextAiredEpisodePrompt({
      watchedSeason: 1,
      watchedEpisode: 12,
      watchedAt: now - 20 * 24 * 60 * 60 * 1000,
      now,
      seasons: [{
        season: 2,
        episodes: [{ episode: 1, airDate: "2026-10-30", name: "Estreno" }],
      }],
    });

    expect(result).toMatchObject({ season: 2, episode: 1, entryKind: "new-season" });
  });

  it("uses the highest watched episode and latest watch time for recent history", () => {
    const makeHistoryEntry = (season: number, episode: number, updatedAt: number): ContinueWatchingEntry => ({
      key: `series:tmdb:123:${season}:${episode}`,
      mediaKey: "series:tmdb:123",
      type: "series",
      id: "tmdb:123",
      name: "Serie de prueba",
      season,
      episode,
      currentTime: 100,
      duration: 100,
      updatedAt,
      completed: true,
      entryKind: "resume",
    });
    const latestWatchAt = now - 24 * 60 * 60 * 1000;

    const [source] = getRecentEpisodeHistorySources([
      makeHistoryEntry(1, 4, now - 90 * 24 * 60 * 60 * 1000),
      makeHistoryEntry(1, 3, latestWatchAt),
      makeHistoryEntry(1, 2, now - 100 * 24 * 60 * 60 * 1000),
    ], now);

    expect(source).toMatchObject({ season: 1, episode: 4, updatedAt: latestWatchAt });
  });

  it("shows availability on the unfinished episode instead of offering the next one", () => {
    const presentation = getEpisodeAvailabilityPresentation({
      season: 1,
      episode: 4,
      entryKind: "new",
    }, false);

    expect(presentation).toEqual({
      createPrompt: false,
      badgeLabel: "Episodio disponible",
    });
  });

  it("keeps Nuvio's existing name for new-season availability", () => {
    expect(getEpisodeAvailabilityPresentation({
      season: 2,
      episode: 1,
      entryKind: "new-season",
    }, false).badgeLabel).toBe("Nueva temporada");
  });

  it("does not badge an unfinished episode just because another episode follows it", () => {
    expect(getEpisodeAvailabilityPresentation({
      season: 1,
      episode: 2,
      entryKind: "next",
    }, false)).toEqual({ createPrompt: false, badgeLabel: undefined });
  });

  it("offers a standalone next episode after the current episode is complete", () => {
    const presentation = getEpisodeAvailabilityPresentation({
      season: 1,
      episode: 4,
      entryKind: "new",
    }, true);

    expect(presentation).toEqual({ createPrompt: true, badgeLabel: undefined });
  });
});
