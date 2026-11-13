import { describe, expect, it } from "vitest";
import { getEpisodeVirtualCenterIndex, getEpisodeVirtualRange } from "./episodeRowVirtualization";

describe("getEpisodeVirtualRange", () => {
  it("keeps the rendered window bounded for a long series", () => {
    expect(getEpisodeVirtualRange(0, 1200, 900, 369)).toEqual({ start: 0, end: 7 });
    expect(getEpisodeVirtualRange(369 * 400, 1200, 900, 369)).toEqual({ start: 397, end: 407 });
  });

  it("clamps the window at both ends and handles an empty series", () => {
    expect(getEpisodeVirtualRange(0, 1000, 4, 369)).toEqual({ start: 0, end: 4 });
    expect(getEpisodeVirtualRange(369 * 20, 1000, 4, 369)).toEqual({ start: 0, end: 4 });
    expect(getEpisodeVirtualRange(0, 1000, 0, 369)).toEqual({ start: 0, end: 0 });
  });

  it("normalizes invalid measurements without returning an invalid range", () => {
    expect(getEpisodeVirtualRange(Number.NaN, Number.NaN, 10, 0, -2))
      .toEqual({ start: 0, end: 1 });
  });
});

describe("getEpisodeVirtualCenterIndex", () => {
  it("tracks the item at the horizontal viewport center", () => {
    expect(getEpisodeVirtualCenterIndex(0, 900, 20, 369, 32)).toBe(1);
    expect(getEpisodeVirtualCenterIndex(369 * 4, 900, 20, 369, 32)).toBe(5);
  });

  it("clamps the center index and handles empty rows", () => {
    expect(getEpisodeVirtualCenterIndex(-100, 900, 4, 369, 32)).toBe(1);
    expect(getEpisodeVirtualCenterIndex(100_000, 900, 4, 369, 32)).toBe(3);
    expect(getEpisodeVirtualCenterIndex(0, 900, 0, 369, 32)).toBe(-1);
  });
});
