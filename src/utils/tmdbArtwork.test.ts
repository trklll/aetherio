import { describe, expect, it } from "vitest";
import { pickPreferredTmdbBackdrop, sortTmdbBackdropsByPreference } from "./tmdbArtwork";

describe("TMDB backdrop selection", () => {
  it("prefers backdrops without a language tag when text-heavy alternatives exist", () => {
    const backdrops = [
      {
        file_path: "/with-title.jpg",
        width: 3840,
        height: 2160,
        iso_639_1: "en",
        vote_average: 10,
      },
      {
        file_path: "/clean.jpg",
        width: 1920,
        height: 1080,
        iso_639_1: null,
        vote_average: 7,
      },
    ];

    expect(pickPreferredTmdbBackdrop(backdrops)).toBe(
      "https://image.tmdb.org/t/p/original/clean.jpg",
    );
    expect(sortTmdbBackdropsByPreference(backdrops)).toEqual([
      "https://image.tmdb.org/t/p/original/clean.jpg",
    ]);
  });

  it("keeps language-tagged backdrops when no language-neutral options exist", () => {
    const backdrops = [
      { file_path: "/with-title.jpg", width: 1920, height: 1080, iso_639_1: "en" },
    ];

    expect(pickPreferredTmdbBackdrop(backdrops)).toBe(
      "https://image.tmdb.org/t/p/original/with-title.jpg",
    );
    expect(sortTmdbBackdropsByPreference(backdrops)).toEqual([
      "https://image.tmdb.org/t/p/original/with-title.jpg",
    ]);
  });
});
