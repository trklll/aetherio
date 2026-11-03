import { describe, expect, it } from "vitest";
import { createSeanimeAdapter, rankLocalAnimeAv1Results } from "./adapter.ts";

describe("rankLocalAnimeAv1Results", () => {
  it("prefers the requested season over the site's first result", () => {
    const ranked = rankLocalAnimeAv1Results([
      { id: "base", title: "Sousou no Frieren" },
      { id: "season-2", title: "Sousou no Frieren 2nd Season" },
    ], "Frieren", 2);

    expect(ranked[0].id).toBe("season-2");
  });

  it("prefers the base series over a movie when the query is for a series", () => {
    const ranked = rankLocalAnimeAv1Results([
      { id: "movie", title: "Naruto: The Last Movie" },
      { id: "series", title: "Naruto" },
    ], "Naruto", 1);

    expect(ranked[0].id).toBe("series");
  });

  it("avoids a final-season arc for a season-one query", () => {
    const ranked = rankLocalAnimeAv1Results([
      { id: "final", title: "Shingeki no Kyojin: The Final Season" },
      { id: "base", title: "Shingeki no Kyojin" },
    ], "Attack on Titan", 1);

    expect(ranked[0].id).toBe("base");
  });

  it("re-searches an English alias and resolves the base-series episode", async () => {
    const searches: string[] = [];
    const provider = {
      getSettings: () => ({ supportsDub: false, episodeServers: ["HLS"] }),
      search: async ({ query }: { query: string }) => {
        searches.push(query);
        if (query === "Attack on Titan") return [
          { id: "final", title: "Shingeki no Kyojin: The Final Season", subOrDub: "sub" },
          { id: "base", title: "Shingeki no Kyojin", subOrDub: "sub" },
        ];
        return [
          { id: "final", title: "Shingeki no Kyojin: The Final Season", subOrDub: "sub" },
          { id: "base", title: "Shingeki no Kyojin", subOrDub: "sub" },
        ];
      },
      findEpisodes: async (id: string) => [{ id, number: 1 }],
      findEpisodeServer: async (episode: { id: string }) => ({
        server: "HLS",
        videoSources: [{ url: `https://cdn.example/${episode.id}.m3u8`, type: "m3u8" }],
      }),
    };
    const adapter = createSeanimeAdapter(() => provider as any, {
      id: "animeav1", name: "AnimeAV1", lang: "es", type: "onlinestream-provider", policy: "spanish",
    });

    const streams = await adapter.getStreams([null, "tv", 1, 1, "Attack on Titan"]);

    expect(searches).toEqual(["Attack on Titan", "Shingeki no Kyojin: The Final Season"]);
    expect(streams[0].url).toBe("https://cdn.example/base.m3u8");
  });
});
