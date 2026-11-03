import { describe, expect, it } from "vitest";
import { sortLiveSources } from "./liveSportsSourceRanking.ts";

describe("sports commentary priority", () => {
  it("puts verified Spanish narration before Highfly English, then prefers Highfly within the same language", () => {
    const sources = [
      { id: "en", label: "Highfly", language: "English", providerId: "sports-streams", url: "https://cdn.test/en" },
      { id: "iptv", label: "Teledeporte", language: "es-ES", origin: "iptv" as const, url: "https://cdn.test/iptv" },
      { id: "es", label: "Highfly", language: "Spanish", providerId: "sports-streams", url: "https://cdn.test/es" },
      { id: "subs", label: "English · Spanish subtitles", language: "English", url: "https://cdn.test/subs" },
    ];
    expect(sortLiveSources(sources).map(source => source.id)).toEqual(["es", "iptv", "en", "subs"]);
    expect(sources[0].id).toBe("en");
  });
});
