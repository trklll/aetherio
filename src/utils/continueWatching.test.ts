import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaStream } from "../types/stream";
import {
  applyContinueWatchingTombstones,
  classifyContinueWatchingEntryKind,
  CONTINUE_WATCHING_EVENT,
  getContinueWatchingRows,
  mergeContinueWatchingEntries,
  mergeRemotePlaybackState,
  readContinueWatchingEntries,
  readWatchedHistoryEntries,
  removeContinueWatchingEntry,
  saveNextEpisodePrompt,
  saveContinueWatchingProgress,
  tryMarkMediaAsWatched,
  trySaveContinueWatchingProgress,
  tryUpdateContinueWatchingSelection,
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

describe("observable continue-watching persistence", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns a revision for a persisted progress write while keeping the legacy entry result", () => {
    const result = trySaveContinueWatchingProgress(baseInput);
    expect(result).toMatchObject({ ok: true, revision: expect.any(Number) });
    expect(saveContinueWatchingProgress({ ...baseInput, currentTime: 40 })).toMatchObject({ currentTime: 40 });
  });

  it("provides observable results for selection and watched-state writes", () => {
    saveContinueWatchingProgress(baseInput);
    expect(tryUpdateContinueWatchingSelection(baseInput.query, { selectedAudio: "2" }).ok).toBe(true);
    expect(tryMarkMediaAsWatched({ type: "movie", id: "tmdb:900", name: "Película" }).ok).toBe(true);
    expect(readWatchedHistoryEntries().some(entry => entry.id === "tmdb:900")).toBe(true);
  });

  it("journals completion writes across continue-watching and watched-history keys", async () => {
    const values = new Map<string, string>();
    let failHistory = true;
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: key => values.get(key) ?? null,
      key: index => Array.from(values.keys())[index] ?? null,
      removeItem: key => { values.delete(key); },
      setItem: (key, value) => {
        if (failHistory && key === "aetherio-watched-history-v1") {
          failHistory = false;
          throw new DOMException("quota", "QuotaExceededError");
        }
        values.set(key, String(value));
      },
    };
    vi.stubGlobal("localStorage", storage);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    const events = await import("../domain/experienceStorage");
    events.resetExperienceStorageForTests();

    const result = trySaveContinueWatchingProgress({ ...baseInput, currentTime: baseInput.duration });
    expect(result).toMatchObject({ ok: false, code: "storage-unavailable" });
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).not.toContain(CONTINUE_WATCHING_EVENT);

    const recovered = events.recoverExperienceJournal();
    expect(recovered.ok).toBe(true);
    expect(JSON.parse(values.get("aetherio-continue-watching-v1") ?? "[]")).toEqual([]);
    expect(JSON.parse(values.get("aetherio-watched-history-v1") ?? "[]")).toHaveLength(1);
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
    }]);

    expect(getContinueWatchingRows()[0]?.entryKind).toBe("new-season");
  });
});

describe("merge remote playback state", () => {
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

  it("keeps the most recent edit per entry when the remote is older", async () => {
    saveContinueWatchingProgress(baseInput);
    const local = readContinueWatchingEntries()[0];
    if (!local) throw new Error("Expected local entry");

    mergeRemotePlaybackState({ progress: [{ ...local, currentTime: 10, updatedAt: local.updatedAt - 1000 }] });
    expect(readContinueWatchingEntries()[0]?.currentTime).toBe(local.currentTime);

    mergeRemotePlaybackState({ progress: [{ ...local, currentTime: 55, updatedAt: local.updatedAt + 1000 }] });
    expect(readContinueWatchingEntries()[0]?.currentTime).toBe(55);
  });

  it("drops a local progress entry superseded by a completed remote history entry", () => {
    saveContinueWatchingProgress(baseInput);
    const local = readContinueWatchingEntries()[0];
    if (!local) throw new Error("Expected local entry");

    mergeRemotePlaybackState({
      history: [{
        ...local,
        completed: true,
        currentTime: local.duration,
        duration: local.duration,
        updatedAt: local.updatedAt + 500,
      }],
    });

    expect(readContinueWatchingEntries()).toHaveLength(0);
    expect(readWatchedHistoryEntries().some(entry => entry.key === local.key)).toBe(true);
  });
});

describe("continue watching tombstones", () => {
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

  it("keeps a dismissed entry deleted when another device pushes it again", async () => {
    saveContinueWatchingProgress(baseInput);
    const entry = readContinueWatchingEntries()[0];
    if (!entry) throw new Error("Expected entry");

    expect(removeContinueWatchingEntry(entry.key)).toBeTruthy();
    expect(readContinueWatchingEntries()).toHaveLength(0);

    // El otro dispositivo aún no conoce el borrado y empuja la entrada antigua.
    mergeContinueWatchingEntries([{ ...entry, updatedAt: entry.updatedAt }]);
    expect(readContinueWatchingEntries()).toHaveLength(1);

    applyContinueWatchingTombstones([{ key: entry.key, deletedAt: Date.now() }]);
    expect(readContinueWatchingEntries()).toHaveLength(0);
  });

  it("lets an entry recreated after its dismissal survive remote tombstones", async () => {
    saveContinueWatchingProgress(baseInput);
    const entry = readContinueWatchingEntries()[0];
    if (!entry) throw new Error("Expected entry");
    removeContinueWatchingEntry(entry.key);

    // Reproducción posterior al descarte: la entrada vuelve con updatedAt nuevo.
    await new Promise(resolve => setTimeout(resolve, 30));
    saveContinueWatchingProgress(baseInput);
    expect(readContinueWatchingEntries()).toHaveLength(1);

    applyContinueWatchingTombstones([{ key: entry.key, deletedAt: Date.now() - 15 }]);
    expect(readContinueWatchingEntries()).toHaveLength(1);
  });
});
