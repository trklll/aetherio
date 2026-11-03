import { describe, expect, it } from "vitest";
import { isEpisodeReleased } from "./nextEpisodeRules";

describe("isEpisodeReleased", () => {
  const now = new Date(2026, 10, 2, 12);

  it("accepts an episode that aired before today", () => {
    expect(isEpisodeReleased("2026-11-01", now)).toBe(true);
  });

  it("accepts an episode airing today", () => {
    expect(isEpisodeReleased("2026-11-02", now)).toBe(true);
  });

  it("keeps a future scheduled episode unavailable", () => {
    expect(isEpisodeReleased("2026-11-03", now)).toBe(false);
  });

  it("treats missing and invalid air dates as unconfirmed", () => {
    expect(isEpisodeReleased(undefined, now)).toBe(false);
    expect(isEpisodeReleased("not-a-date", now)).toBe(false);
    expect(isEpisodeReleased("2026-02-31", now)).toBe(false);
  });
});
