import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetPlaybackStateCacheForTests } from "../utils/continueWatching";
import {
  LAST_AIRED_TTL_MS,
  readHiddenMediaKeys,
  refreshWatchedSeriesCache,
  shouldHideMedia,
} from "./watchedVisibility";

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

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-09-01T12:00:00Z");

function entry(overrides: Record<string, unknown>) {
  return {
    key: "k",
    mediaKey: "series:tmdb:1",
    type: "series",
    id: "tmdb:1",
    name: "Serie",
    currentTime: 1,
    duration: 1,
    updatedAt: T0,
    completed: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.stubGlobal("localStorage", createStorage());
  resetPlaybackStateCacheForTests();
});

describe("shouldHideMedia", () => {
  it("sin completados nunca oculta", () => {
    expect(shouldHideMedia({ type: "movie", completed: [] })).toBe(false);
    expect(shouldHideMedia({ type: "series", completed: [] })).toBe(false);
  });

  it("película completada se oculta; a medias no", () => {
    expect(shouldHideMedia({ type: "movie", completed: [{ updatedAt: T0 }] })).toBe(true);
    expect(shouldHideMedia({ type: "Movie", completed: [{ updatedAt: T0 }] })).toBe(true);
  });

  it("serie al día se oculta; atrasada se muestra", () => {
    const last = { season: 1, episode: 10, airDate: "2026-08-01", checkedAt: T0 };
    expect(shouldHideMedia({
      type: "series",
      completed: [{ season: 1, episode: 10, updatedAt: T0 }],
      lastAired: last,
    })).toBe(true);
    expect(shouldHideMedia({
      type: "series",
      completed: [{ season: 1, episode: 9, updatedAt: T0 }],
      lastAired: last,
    })).toBe(false);
    expect(shouldHideMedia({
      type: "series",
      completed: [{ season: 1, episode: 10, updatedAt: T0 }, { season: 2, episode: 3, updatedAt: T0 }],
      lastAired: last,
    })).toBe(true);
  });

  it("serie sin dato de emisión se muestra (ante la duda, no ocultar)", () => {
    expect(shouldHideMedia({
      type: "series",
      completed: [{ season: 1, episode: 10, updatedAt: T0 }],
      lastAired: null,
    })).toBe(false);
    expect(shouldHideMedia({
      type: "tv",
      completed: [{ season: 1, episode: 10, updatedAt: T0 }],
    })).toBe(false);
  });

  it("marca manual oculta; reaparece si hay episodios nuevos desde la marca", () => {
    const manual = { season: 0, episode: 0, updatedAt: T0 };
    expect(shouldHideMedia({
      type: "series",
      completed: [manual],
      lastAired: { season: 2, episode: 1, airDate: "2026-08-01", checkedAt: T0 },
    })).toBe(true);
    expect(shouldHideMedia({
      type: "series",
      completed: [manual],
      lastAired: { season: 3, episode: 1, airDate: "2026-09-05", checkedAt: T0 },
    })).toBe(false);
    // Si después se puso al día con lo nuevo, vuelve a ocultarse.
    expect(shouldHideMedia({
      type: "series",
      completed: [manual, { season: 3, episode: 1, updatedAt: T0 + DAY }],
      lastAired: { season: 3, episode: 1, airDate: "2026-09-05", checkedAt: T0 },
    })).toBe(true);
    // Marca manual sin TMDB: intención explícita → oculta.
    expect(shouldHideMedia({ type: "series", completed: [manual] })).toBe(true);
  });
});

describe("readHiddenMediaKeys", () => {
  it("oculta peli vista, serie al día y marca manual; muestra atrasada", () => {
    const storage = globalThis.localStorage as Storage;
    storage.setItem("aetherio-watched-history-v1", JSON.stringify([
      entry({ key: "movie:tt1", mediaKey: "movie:tt1", type: "movie", id: "tt1", name: "Peli" }),
      entry({ key: "series:tmdb:100:1:10", mediaKey: "series:tmdb:100", id: "tmdb:100", name: "Al día", season: 1, episode: 10 }),
      entry({ key: "series:tmdb:200:1:1", mediaKey: "series:tmdb:200", id: "tmdb:200", name: "Atrasada", season: 1, episode: 1 }),
      entry({ key: "series:tt2:0:0", mediaKey: "series:tt2", type: "series", id: "tt2", name: "Manual", season: 0, episode: 0 }),
    ]));
    storage.setItem("aetherio-watched-visibility-v1", JSON.stringify({
      "tmdb:100": { season: 1, episode: 10, airDate: "2026-08-01", checkedAt: T0 },
      "tmdb:200": { season: 2, episode: 1, airDate: "2026-08-20", checkedAt: T0 },
    }));
    const hidden = readHiddenMediaKeys();
    expect(hidden.has("movie:tt1")).toBe(true);
    expect(hidden.has("series:tmdb:100")).toBe(true);
    expect(hidden.has("series:tmdb:200")).toBe(false);
    expect(hidden.has("series:tt2")).toBe(true);
  });

  it("storage corrupto no oculta nada", () => {
    const storage = globalThis.localStorage as Storage;
    storage.setItem("aetherio-watched-history-v1", "no-json{{{");
    expect(readHiddenMediaKeys().size).toBe(0);
  });
});

describe("refreshWatchedSeriesCache", () => {
  it("cachea el último emitido y no repite en fresco; respeta TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const storage = globalThis.localStorage as Storage;
    storage.setItem("aetherio-api-keys", JSON.stringify({
      tmdbApiKey: "test-key", introDbApiKey: "", animeSkipClientId: "", omdbApiKey: "",
    }));
    storage.setItem("aetherio-watched-history-v1", JSON.stringify([
      entry({ key: "series:tmdb:100:2:5", mediaKey: "series:tmdb:100", id: "tmdb:100", name: "S", season: 2, episode: 5 }),
      entry({ key: "movie:tt1", mediaKey: "movie:tt1", type: "movie", id: "tt1", name: "Peli" }),
    ]));
    const fetchMock = vi.fn(async (_url: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        last_episode_to_air: { season_number: 2, episode_number: 8, air_date: "2026-08-20" },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await refreshWatchedSeriesCache();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/tv/100");
    const cached = JSON.parse(storage.getItem("aetherio-watched-visibility-v1") ?? "{}");
    expect(cached["tmdb:100"]).toMatchObject({ season: 2, episode: 8, airDate: "2026-08-20" });

    // En fresco no refetchea.
    await refreshWatchedSeriesCache();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Tras el TTL reintenta.
    vi.setSystemTime(T0 + LAST_AIRED_TTL_MS + 1000);
    await refreshWatchedSeriesCache();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
