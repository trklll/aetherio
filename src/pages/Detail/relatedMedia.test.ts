import { describe, expect, it } from "vitest";
import { relatedMediaDetailSeed } from "./relatedMedia";

describe("relatedMediaDetailSeed", () => {
  it("keeps the selected title's poster and backdrop in its detail seed", () => {
    expect(relatedMediaDetailSeed({
      id: 42,
      title: "Selected series",
      media_type: "tv",
      poster_path: "https://image.tmdb.org/t/p/original/poster.jpg",
      backdrop_path: "https://image.tmdb.org/t/p/original/backdrop.jpg",
    })).toEqual({
      id: "tmdb:42",
      type: "series",
      name: "Selected series",
      poster: "https://image.tmdb.org/t/p/original/poster.jpg",
      background: "https://image.tmdb.org/t/p/original/backdrop.jpg",
    });
  });

  it("retains the poster seed when TMDB has no backdrop", () => {
    expect(relatedMediaDetailSeed({
      id: 7,
      title: "Movie",
      media_type: "movie",
      poster_path: "https://image.tmdb.org/t/p/original/poster.jpg",
    })).toEqual({
      id: "tmdb:7",
      type: "movie",
      name: "Movie",
      poster: "https://image.tmdb.org/t/p/original/poster.jpg",
      background: undefined,
    });
  });
});
