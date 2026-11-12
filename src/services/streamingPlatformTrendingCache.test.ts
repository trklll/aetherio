import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRowData } from "../types/ui";
import {
  readStreamingPlatformTrendingCache,
  writeStreamingPlatformTrendingCache,
} from "./streamingPlatformTrendingCache";

const STORAGE_KEY = "aetherio-streaming-platform-trending-cache-v1";
const rows = [{
  addonId: "tmdb",
  addonName: "Netflix",
  catalogId: "streaming.netflix.movie.genre.drama",
  type: "movie",
  name: "Películas",
  subtitle: "Netflix",
  items: [{ id: "tmdb:1", type: "movie", name: "Película" }],
}] as CatalogRowData[];

describe("streaming platform trending cache", () => {
  let values: Map<string, string>;
  let setItem: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T12:00:00.000Z"));
    values = new Map();
    setItem = vi.fn((key: string, value: string) => values.set(key, value));
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => values.get(key) ?? null,
          setItem,
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("persists rows per platform and genre with their update timestamp", () => {
    writeStreamingPlatformTrendingCache("netflix", "drama", rows);

    expect(readStreamingPlatformTrendingCache("netflix", "drama")).toEqual({
      rows,
      updatedAt: Date.now(),
    });
    expect(readStreamingPlatformTrendingCache("netflix", "comedy")).toBeUndefined();
    expect(readStreamingPlatformTrendingCache("disney-plus", "drama")).toBeUndefined();
  });

  it("drops persisted rows after seven days so old results are not shown indefinitely", () => {
    writeStreamingPlatformTrendingCache("netflix", undefined, rows);
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1);

    expect(readStreamingPlatformTrendingCache("netflix")).toBeUndefined();
  });

  it("ignores corrupt storage and tolerates storage quota errors", () => {
    values.set(STORAGE_KEY, "{not-json");
    expect(readStreamingPlatformTrendingCache("netflix")).toBeUndefined();

    setItem.mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeStreamingPlatformTrendingCache("netflix", undefined, rows)).not.toThrow();
  });
});
