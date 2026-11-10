import { describe, expect, it } from "vitest";
import { getEpisodeNavigationTarget, isEpisodeReleased } from "./nextEpisodeRules";

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

describe("getEpisodeNavigationTarget", () => {
  const episodes = [
    { season: 1, episode: 1 },
    { season: 1, episode: 2 },
  ];

  it("uses the resolved next episode even when the current episode is missing from the loaded list", () => {
    const nextEpisode = { season: 2, episode: 1 };

    expect(getEpisodeNavigationTarget("next", -1, episodes, nextEpisode)).toBe(nextEpisode);
  });

  it("moves to the previous loaded episode only when one exists", () => {
    expect(getEpisodeNavigationTarget("prev", 1, episodes, null)).toBe(episodes[0]);
    expect(getEpisodeNavigationTarget("prev", -1, episodes, null)).toBeNull();
  });

  it("returns no next episode when none is resolved", () => {
    expect(getEpisodeNavigationTarget("next", 1, episodes, null)).toBeNull();
  });
});
