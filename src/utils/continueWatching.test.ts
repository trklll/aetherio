import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaStream } from "../types/stream";
import {
  classifyContinueWatchingEntryKind,
  CONTINUE_WATCHING_EVENT,
  getContinueWatchingRows,
  mergeContinueWatchingEntries,
  readContinueWatchingEntries,
  saveNextEpisodePrompt,
  saveContinueWatchingProgress,
} from "./continueWatching";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const stream: MediaStream = {
  id: "stream-1",
  addonId: "addon-1",
  addonName: "Addon",
  name: "Stream",
};

const baseInput = {
  query: { type: "series", id: "tmdb:123", season: 1, episode: 2 },
  stream,
  name: "Serie de prueba",
  logo: "https://image.test/logo.png",
  background: "https://image.test/background.jpg",
  poster: "https://image.test/poster.jpg",
  episodeStill: "https://image.test/still.jpg",
  episodeName: "Episodio de prueba",
  currentTime: 20,
  duration: 1000,
};

describe("continue watching artwork", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("CustomEvent", class {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves resolved artwork when a later progress save omits it", () => {
    saveContinueWatchingProgress(baseInput);
    saveContinueWatchingProgress({
      ...baseInput,
      logo: undefined,
      background: undefined,
      poster: undefined,
      episodeStill: undefined,
      episodeName: undefined,
      currentTime: 35,
    });

    expect(readContinueWatchingEntries()[0]).toMatchObject({
      logo: baseInput.logo,
      background: baseInput.background,
      poster: baseInput.poster,
      episodeStill: baseInput.episodeStill,
      episodeName: baseInput.episodeName,
      currentTime: 35,
    });
  });

  it("accepts newer artwork when the player provides it", () => {
    saveContinueWatchingProgress(baseInput);
    saveContinueWatchingProgress({
      ...baseInput,
      logo: "https://image.test/new-logo.png",
      background: "https://image.test/new-background.jpg",
      poster: "https://image.test/new-poster.jpg",
      episodeStill: "https://image.test/new-still.jpg",
      currentTime: 40,
    });

    expect(readContinueWatchingEntries()[0]).toMatchObject({
      logo: "https://image.test/new-logo.png",
      background: "https://image.test/new-background.jpg",
      poster: "https://image.test/new-poster.jpg",
      episodeStill: "https://image.test/new-still.jpg",
    });
  });

  it("emits an update event after progress is persisted", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    saveContinueWatchingProgress(baseInput);

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: CONTINUE_WATCHING_EVENT }));
  });

  it("removes a completed episode while keeping the next prompt visible", () => {
    const completed = saveContinueWatchingProgress({
      ...baseInput,
      currentTime: baseInput.duration,
    });
    expect(completed?.completed).toBe(true);
    expect(getContinueWatchingRows()).toHaveLength(0);

    saveNextEpisodePrompt({
      query: { type: "series", id: "tmdb:123", season: 1, episode: 3 },
      name: baseInput.name,
      episodeName: "Siguiente episodio",
      background: baseInput.background,
      episodeStill: baseInput.episodeStill,
    });

    expect(getContinueWatchingRows()).toMatchObject([{
      episode: 3,
      episodeName: "Siguiente episodio",
      entryKind: "next",
    }]);
  });
});

describe("continue watching release badges", () => {
  const now = Date.parse("2026-08-01T00:00:00Z");

  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("CustomEvent", class {
      type: string;

      constructor(type: string) {
        this.type = type;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a recent episode in the current season", () => {
    expect(classifyContinueWatchingEntryKind({
      nextSeason: 2,
      watchedSeason: 2,
      releaseAt: now - 10 * 24 * 60 * 60 * 1000,
      watchedAt: now - 20 * 24 * 60 * 60 * 1000,
      now,
    })).toBe("new");
  });

  it("classifies the first recent episode of a later season", () => {
    expect(classifyContinueWatchingEntryKind({
      nextSeason: 3,
      watchedSeason: 2,
      releaseAt: now - 10 * 24 * 60 * 60 * 1000,
      watchedAt: now - 20 * 24 * 60 * 60 * 1000,
      now,
    })).toBe("new-season");
  });

  it("falls back to the normal next episode for old or already-known releases", () => {
    expect(classifyContinueWatchingEntryKind({
      nextSeason: 2,
      watchedSeason: 2,
      releaseAt: now - 61 * 24 * 60 * 60 * 1000,
      watchedAt: now - 120 * 24 * 60 * 60 * 1000,
      now,
    })).toBe("next");
    expect(classifyContinueWatchingEntryKind({
      nextSeason: 2,
      watchedSeason: 2,
      releaseAt: now - 10 * 24 * 60 * 60 * 1000,
      watchedAt: now - 5 * 24 * 60 * 60 * 1000,
      now,
    })).toBe("next");
  });

  it("keeps a new-season next-up entry visible", () => {
    saveNextEpisodePrompt({
      query: { type: "series", id: "tmdb:123", season: 3, episode: 1 },
      name: "Serie de prueba",
      entryKind: "new-season",
    });

    expect(getContinueWatchingRows()[0]?.entryKind).toBe("new-season");
  });

  it("lets a more specific release badge upgrade an older next-up entry", () => {
    saveNextEpisodePrompt({
      query: { type: "series", id: "tmdb:123", season: 3, episode: 1 },
      name: "Serie de prueba",
      entryKind: "next",
      updatedAt: now,
    });
    const existing = readContinueWatchingEntries()[0];
    if (!existing) throw new Error("Expected next-up entry");

    mergeContinueWatchingEntries([{
      ...existing,
      entryKind: "new-season",
      updatedAt: now - 1,
      source: "trakt",
    }]);

    expect(getContinueWatchingRows()[0]?.entryKind).toBe("new-season");
  });
});
