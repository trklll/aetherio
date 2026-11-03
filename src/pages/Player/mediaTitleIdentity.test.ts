import { describe, expect, it } from "vitest";
import { buildMediaTitleIdentity, mediaTitleIdentityKey } from "./mediaTitleIdentity";

describe("identidad de títulos del reproductor", () => {
  it("normaliza ids TMDB e IMDb para películas", () => {
    expect(buildMediaTitleIdentity({ type: "movie", id: "tmdb:603" })).toEqual({
      kind: "movie",
      tmdbId: 603,
    });
    expect(buildMediaTitleIdentity({ type: "movie", id: "imdb:tt0133093" })).toEqual({
      kind: "movie",
      imdbId: "tt0133093",
    });
  });

  it("retiene identidad de serie, temporada y episodio para Auto Sync", () => {
    const identity = buildMediaTitleIdentity({ type: "tv", id: "tmdb:1396", season: 1, episode: 2 });
    expect(identity).toEqual({ kind: "episode", showTmdbId: 1396, season: 1, episode: 2 });
    expect(mediaTitleIdentityKey(identity)).toBe("episode:tmdb:1396:1:2");
  });

  it("rechaza ids de catálogo no reconocibles", () => {
    expect(buildMediaTitleIdentity({ type: "movie", id: "local:42" })).toBeNull();
    expect(mediaTitleIdentityKey(null)).toBe("");
  });
});
