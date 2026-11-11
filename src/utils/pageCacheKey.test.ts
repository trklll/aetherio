import { describe, expect, it } from "vitest";
import { pageCacheKey } from "./pageCacheKey";

describe("pageCacheKey", () => {
  it("keeps library tabs in one cached page", () => {
    expect(pageCacheKey("/library", "?tab=downloads")).toBe("/library");
    expect(pageCacheKey("/library", "?tab=discover&filter=anime")).toBe("/library?filter=anime");
  });

  it("keeps settings tabs in one cached page", () => {
    expect(pageCacheKey("/settings", "?tab=playback")).toBe("/settings");
  });

  it("preserves search state for other routes", () => {
    expect(pageCacheKey("/detail/anime/one-piece", "?season=2")).toBe("/detail/anime/one-piece?season=2");
  });
});
