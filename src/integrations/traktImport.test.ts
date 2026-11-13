import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";

const mocks = vi.hoisted(() => ({
  addMissingContinueWatchingEntries: vi.fn(() => 0),
  addMissingLibraryItems: vi.fn(() => 0),
  setLibraryStatus: vi.fn(() => true),
  getSeriesEpisodeCompletionStatus: vi.fn(() => null),
}));

vi.mock("../utils/continueWatching", async importOriginal => {
  const actual = await importOriginal<typeof import("../utils/continueWatching")>();
  return { ...actual, addMissingContinueWatchingEntries: mocks.addMissingContinueWatchingEntries };
});

vi.mock("../utils/library", () => ({
  addMissingLibraryItems: mocks.addMissingLibraryItems,
  setLibraryStatus: mocks.setLibraryStatus,
}));

vi.mock("../utils/libraryCompletion", () => ({
  getSeriesEpisodeCompletionStatus: mocks.getSeriesEpisodeCompletionStatus,
}));

import { importTraktArchive } from "./traktImport";

function archiveOf(data: Record<string, unknown>) {
  return zipSync(Object.fromEntries(
    Object.entries(data).map(([name, value]) => [name, strToU8(JSON.stringify(value))]),
  ));
}

describe("Trakt export import", () => {
  beforeEach(() => {
    mocks.addMissingContinueWatchingEntries.mockClear();
    mocks.addMissingLibraryItems.mockReset().mockReturnValue(3);
    mocks.setLibraryStatus.mockClear();
    mocks.getSeriesEpisodeCompletionStatus.mockReset().mockReturnValue(null);
  });

  it("maps watched history, playback, ratings, collections and lists into additive Aetherio entries", () => {
    const archive = archiveOf({
      "watched-movies.json": [{
        last_watched_at: "2025-01-01T00:00:00.000Z",
        movie: { title: "Film", year: 2024, ids: { tmdb: 12 } },
      }],
      "watched-shows.json": [{
        last_watched_at: "2025-01-02T00:00:00.000Z",
        show: { title: "Show", year: 2024, aired_episodes: 1, ids: { tmdb: 34 } },
        seasons: [{ number: 1, episodes: [{ number: 1 }] }],
      }],
      "watched-history-1.json": [{
        type: "episode",
        watched_at: "2025-01-03T00:00:00.000Z",
        show: { title: "Show", year: 2024, ids: { tmdb: 34 } },
        episode: { title: "Pilot", season: 1, number: 1 },
      }],
      "watched-playback.json": [{
        type: "episode",
        paused_at: "2025-01-04T00:00:00.000Z",
        progress: 15,
        show: { title: "Other Show", ids: { tmdb: 56 } },
        episode: { title: "Start", season: 1, number: 2 },
      }],
      "lists-watchlist.json": [{
        type: "movie", movie: { title: "Upcoming", ids: { tmdb: 78 } },
      }],
      "lists-favorites.json": [],
      "collection-movies.json": [{
        type: "movie", movie: { title: "Collected", ids: { tmdb: 90 } },
      }],
      "ratings-shows.json": [{
        type: "show", rating: 9, show: { title: "Rated", ids: { tmdb: 99 } },
      }],
    });

    const summary = importTraktArchive(archive);

    expect(summary).toEqual({
      watchedMovies: 1,
      watchedEpisodes: 1,
      inProgress: 1,
      savedItems: 3,
      ratedItems: 1,
      favorites: 0,
      watchlist: 1,
      collection: 1,
    });
    const imported = mocks.addMissingContinueWatchingEntries.mock.calls[0][0];
    expect(imported.map(entry => entry.id)).toContain("tmdb:12");
    expect(imported.map(entry => entry.id)).toContain("tmdb:34");
    expect(imported.find(entry => entry.id === "tmdb:99")).toBeUndefined();
    expect(mocks.addMissingLibraryItems.mock.calls[0][0]).toContainEqual(expect.objectContaining({
      id: "tmdb:99",
      userRating: 9,
    }));
    const savedItems = mocks.addMissingLibraryItems.mock.calls[0][0];
    expect(savedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tmdb:12", libraryStatus: "watched" }),
      expect.objectContaining({ id: "tmdb:34", libraryStatus: "watched" }),
      expect.objectContaining({ id: "tmdb:78", libraryStatus: "to_watch" }),
      expect.objectContaining({ id: "tmdb:90", libraryStatus: "to_watch" }),
      expect.objectContaining({ id: "tmdb:99", libraryStatus: "watched" }),
    ]));
  });

  it("keeps a title watched when it also appears in the watchlist", () => {
    const archive = archiveOf({
      "watched-movies.json": [{ movie: { title: "Ya vista", ids: { tmdb: 321 } } }],
      "lists-watchlist.json": [{
        type: "movie", movie: { title: "Ya vista", ids: { tmdb: 321 } },
      }],
    });

    importTraktArchive(archive);

    expect(mocks.addMissingLibraryItems.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "tmdb:321", libraryStatus: "watched" }),
    ]);
  });

  it("marks a series watched when Trakt history covers every aired episode across seasons", () => {
    const show = { title: "Arcane", ids: { tmdb: 555 }, aired_episodes: 4 };
    const archive = archiveOf({
      "watched-history-1.json": [
        { type: "episode", show, episode: { season: 1, number: 1 } },
        { type: "episode", show, episode: { season: 1, number: 2 } },
        { type: "episode", show, episode: { season: 2, number: 1 } },
        { type: "episode", show, episode: { season: 2, number: 2 } },
      ],
    });

    importTraktArchive(archive);

    expect(mocks.addMissingLibraryItems.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ id: "tmdb:555", type: "series", libraryStatus: "watched" }),
    );
    expect(mocks.addMissingContinueWatchingEntries.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ id: "tmdb:555", type: "series", season: 0, episode: 0, completed: true }),
    );
  });

  it("keeps a series in Por ver when the watched history is incomplete", () => {
    const show = { title: "Arcane", ids: { tmdb: 556 }, aired_episodes: 4 };
    const archive = archiveOf({
      "watched-history-1.json": [
        { type: "episode", show, episode: { season: 1, number: 1 } },
        { type: "episode", show, episode: { season: 1, number: 2 } },
        { type: "episode", show, episode: { season: 2, number: 1 } },
      ],
    });

    importTraktArchive(archive);

    expect(mocks.addMissingLibraryItems.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ id: "tmdb:556", type: "series", libraryStatus: "to_watch" }),
    );
    expect(mocks.addMissingContinueWatchingEntries.mock.calls[0][0]).not.toContainEqual(
      expect.objectContaining({ id: "tmdb:556", type: "series", season: 0, episode: 0 }),
    );
  });

  it("lets Aetherio downgrade a Trakt-watched series when its own seasons are incomplete", () => {
    mocks.getSeriesEpisodeCompletionStatus.mockImplementation((_type: string, id: string) => (
      id === "tmdb:777" ? "to_watch" : null
    ));
    const archive = archiveOf({
      "watched-shows.json": [{
        show: { title: "Saga de Tanya", ids: { tmdb: 777 }, aired_episodes: 2 },
        seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }],
      }],
    });

    importTraktArchive(archive);

    expect(mocks.addMissingLibraryItems.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ id: "tmdb:777", libraryStatus: "to_watch" }),
    );
    expect(mocks.setLibraryStatus).toHaveBeenCalledWith("series", "tmdb:777", "to_watch");
    expect(mocks.addMissingContinueWatchingEntries.mock.calls[0][0]).not.toContainEqual(
      expect.objectContaining({ id: "tmdb:777", season: 0, episode: 0 }),
    );
  });

  it("rejects an archive without JSON export data", () => {
    expect(() => importTraktArchive(new Uint8Array())).toThrow("El ZIP está vacío");
  });

  it("rejects arbitrary ZIP files with JSON that is not a Trakt export", () => {
    const archive = archiveOf({ "metadata.json": [{ title: "not Trakt" }] });
    expect(() => importTraktArchive(archive)).toThrow("no contiene archivos JSON reconocibles");
  });

  it("accepts a partial Trakt export and imports the recognized files present", () => {
    const archive = archiveOf({
      "nested/ratings-movies.json": [{
        type: "movie",
        rating: 8,
        movie: { title: "Partial export film", ids: { tmdb: 123 } },
      }],
      "notes-unrelated.json": [{ content: "ignored" }],
    });

    const summary = importTraktArchive(archive);

    expect(summary.ratedItems).toBe(1);
    expect(summary.savedItems).toBe(3);
    expect(mocks.addMissingLibraryItems).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "tmdb:123",
        name: "Partial export film",
        userRating: 8,
        libraryStatus: "watched",
      }),
    ]);
    expect(mocks.addMissingContinueWatchingEntries).toHaveBeenCalledWith([]);
  });

  it("imports collected episode records as their show", () => {
    const archive = archiveOf({
      "collection-episodes.json": [{
        type: "episode",
        show: { title: "Collected show", ids: { tmdb: 456 } },
        episode: { title: "Pilot", season: 1, number: 1 },
      }],
    });

    importTraktArchive(archive);

    expect(mocks.addMissingLibraryItems).toHaveBeenCalledWith([
      expect.objectContaining({ id: "tmdb:456", type: "series", name: "Collected show" }),
    ]);
  });
});
