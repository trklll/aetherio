import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDetailMediaMeta, writeContinueWatchingMediaMeta, writeDetailMediaMeta } from "./mediaMetadata";

vi.mock("../services/posterArtworkCache", () => ({ preloadArtworkImage: vi.fn() }));

const BASE = "https://image.tmdb.org/t/p";
const backdrop = `${BASE}/original/series.jpg`;
const still = `${BASE}/w780/episode.jpg`;
const entry = { id: "tmdb:42", type: "series", name: "Serie", background: still, episodeStill: still };

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("continue watching metadata", () => {
  it("does not promote the episode still to the media background", () => {
    writeContinueWatchingMediaMeta(entry);
    expect(readDetailMediaMeta(entry.type, entry.id)?.background).toBeUndefined();
  });

  it("preserves the cached media background and descriptive metadata", () => {
    writeDetailMediaMeta({ ...entry, background: backdrop, description: "Sinopsis", year: 2020 });
    writeContinueWatchingMediaMeta(entry);
    expect(readDetailMediaMeta(entry.type, entry.id)).toMatchObject({
      background: backdrop, description: "Sinopsis", year: 2020,
    });
  });

  it("recognizes the same episode image at different TMDB sizes and clears a polluted seed", () => {
    writeDetailMediaMeta(entry);
    writeContinueWatchingMediaMeta({ ...entry, background: `${BASE}/original/episode.jpg` });
    expect(readDetailMediaMeta(entry.type, entry.id)?.background).toBeUndefined();
  });

  it("replaces a polluted seed with a real media background", () => {
    writeDetailMediaMeta(entry);
    writeContinueWatchingMediaMeta({ ...entry, background: backdrop });
    expect(readDetailMediaMeta(entry.type, entry.id)?.background).toBe(backdrop);
  });

  it.each(["series", "anime"])("accepts a distinct %s backdrop when there is no cache", type => {
    writeContinueWatchingMediaMeta({ ...entry, type, background: backdrop });
    expect(readDetailMediaMeta(type, entry.id)?.background).toBe(backdrop);
  });

  it("does not change movie background handling", () => {
    writeContinueWatchingMediaMeta({ ...entry, type: "movie" });
    expect(readDetailMediaMeta("movie", entry.id)?.background).toBe(`${BASE}/original/episode.jpg`);
  });

  it("preserves a cached background when progress contains no artwork", () => {
    writeDetailMediaMeta({ ...entry, background: backdrop });
    writeContinueWatchingMediaMeta({ id: entry.id, type: entry.type, name: entry.name });
    expect(readDetailMediaMeta(entry.type, entry.id)?.background).toBe(backdrop);
  });
});
