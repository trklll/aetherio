import { describe, expect, it } from "vitest";
import { matchesAddonStreamFilter } from "./addonStreamFilter.ts";

describe("Hub-defined stream partitions", () => {
  const include = { mode: "include" as const, prefixes: ["AnimeAV1"] };
  const exclude = { mode: "exclude" as const, prefixes: ["AnimeAV1"] };

  it.each(["AnimeAV1\nYourUpload", " animeav1\nMP4Upload", "AnimeAV1 - 1080p"])("recognizes the official upstream source name: %s", name => {
    expect(matchesAddonStreamFilter({ name }, include)).toBe(true);
    expect(matchesAddonStreamFilter({ name }, exclude)).toBe(false);
  });

  it.each(["Henaojara\nYourUpload", "TioAnime\nStreamtape", "AnimeAV10", "NotAnimeAV1"])("never labels another provider as AnimeAV1: %s", name => {
    expect(matchesAddonStreamFilter({ name }, include)).toBe(false);
    expect(matchesAddonStreamFilter({ name }, exclude)).toBe(true);
  });

  it("uses source identity, never a movie title mentioning AnimeAV1", () => {
    expect(matchesAddonStreamFilter({ name: "Latanime", title: "AnimeAV1 episode" }, include)).toBe(false);
    expect(matchesAddonStreamFilter({ title: "AnimeAV1" }, include)).toBe(false);
    expect(matchesAddonStreamFilter({ name: "Anything" })).toBe(true);
  });
});
