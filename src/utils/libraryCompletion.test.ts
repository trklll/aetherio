import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLibraryItems } from "../pages/Library/libraryLogic";
import {
  getCompletedSeriesEpisodeManifests,
  hasCompletedSeriesEpisodes,
  saveSeriesEpisodeManifest,
} from "./libraryCompletion";
import type { ContinueWatchingEntry } from "./continueWatching";

const episode = (season: number, episodeNumber: number): ContinueWatchingEntry => ({
  key: `series:tmdb:42:${season}:${episodeNumber}`,
  mediaKey: "series:tmdb:42",
  type: "series",
  id: "tmdb:42",
  name: "Serie de prueba",
  season,
  episode: episodeNumber,
  currentTime: 1,
  duration: 1,
  updatedAt: 1,
  completed: true,
});

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe("hasCompletedSeriesEpisodes", () => {
  beforeEach(() => vi.stubGlobal("localStorage", createStorage()));
  afterEach(() => vi.unstubAllGlobals());

  const episodes = [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 },
    { season: 2, episode: 1 },
  ];

  it("requires every episode across every season to be completed", () => {
    expect(hasCompletedSeriesEpisodes("series", "tmdb:42", episodes, [
      episode(1, 1),
      episode(1, 2),
      episode(2, 1),
    ])).toBe(true);

    expect(hasCompletedSeriesEpisodes("series", "tmdb:42", episodes, [
      episode(1, 1),
      episode(1, 2),
    ])).toBe(false);
  });

  it("ignores duplicate watches and does not treat an empty series as complete", () => {
    expect(hasCompletedSeriesEpisodes("series", "tmdb:42", episodes, [
      episode(1, 1),
      episode(1, 1),
      episode(1, 2),
    ])).toBe(false);
    expect(hasCompletedSeriesEpisodes("series", "tmdb:42", [], [])).toBe(false);
  });

  it("persists the episode manifest so the library can classify completion after leaving detail", () => {
    expect(saveSeriesEpisodeManifest("series", "tmdb:42", episodes)).toBe(true);
    expect(getCompletedSeriesEpisodeManifests([
      episode(1, 1),
      episode(1, 2),
      episode(2, 1),
    ])).toMatchObject([{ type: "series", id: "tmdb:42", episodes }]);
    expect(getCompletedSeriesEpisodeManifests([
      episode(1, 1),
      episode(1, 2),
    ])).toHaveLength(0);
    expect(buildLibraryItems([], [episode(1, 1), episode(1, 2), episode(2, 1)], [])[0]).toMatchObject({
      listKey: "watched",
      listLabel: "Vistas",
    });
  });

  it("lets Aetherio's unseen episodes override a watched status imported from Trakt", () => {
    const currentEpisodes = [
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
      { season: 2, episode: 2 },
    ];
    saveSeriesEpisodeManifest("series", "tmdb:42", currentEpisodes);

    const [item] = buildLibraryItems(
      [{
        type: "series",
        id: "tmdb:42",
        name: "Serie de prueba",
        addedAt: 1,
        libraryStatus: "watched",
      }],
      [episode(1, 1), episode(1, 2), episode(2, 1)],
      [],
    );

    expect(item.listKey).toBe("to_watch");
    expect(item.listLabel).toBe("Por ver");
  });
});
