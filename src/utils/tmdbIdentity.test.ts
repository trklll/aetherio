import { describe, expect, it } from "vitest";
import { pickTmdbSearchCandidate } from "./tmdbIdentity";

describe("pickTmdbSearchCandidate", () => {
  it("prefers the anime movie over an ambiguous TV news title", () => {
    const selected = pickTmdbSearchCandidate([
      {
        kind: "tv",
        item: {
          id: 149,
          name: "Akira",
          first_air_date: "1988-01-01",
          original_language: "en",
          genre_ids: [10763, 10767],
        },
      },
      {
        kind: "movie",
        item: {
          id: 149,
          title: "Akira",
          release_date: "1988-07-16",
          original_language: "ja",
          genre_ids: [16, 878],
        },
      },
    ], "Akira", 1988, true);

    expect(selected?.kind).toBe("movie");
    expect(selected?.item.id).toBe(149);
  });

  it("prefers the matching anime series when the same numeric id also exists as a movie", () => {
    const selected = pickTmdbSearchCandidate([
      {
        kind: "movie",
        item: {
          id: 229858,
          title: "Three Mothers",
          release_date: "2008-09-17",
          original_language: "en",
          genres: [{ id: 18, name: "Drama" }],
        },
      },
      {
        kind: "tv",
        item: {
          id: 229858,
          name: "Fate/strange Fake",
          first_air_date: "2024-12-31",
          original_language: "ja",
          genres: [{ id: 16, name: "Animation" }],
        },
      },
    ], "Fate/strange Fake", 2024, true);

    expect(selected?.kind).toBe("tv");
    expect(selected?.item.id).toBe(229858);
  });

  it("does not turn an unrelated popular result into an identity", () => {
    const selected = pickTmdbSearchCandidate([
      {
        kind: "movie",
        item: { id: 229858, title: "Three Mothers", release_date: "2008-09-17", popularity: 999 },
      },
    ], "Fate/strange Fake", 2024, true);

    expect(selected).toBeUndefined();
  });

  it("uses anime signals when a direct route has no cached title", () => {
    const selected = pickTmdbSearchCandidate([
      {
        kind: "tv",
        item: {
          id: 149,
          name: "Journal Editorial Report",
          first_air_date: "2004-09-18",
          original_language: "en",
          genres: [{ id: 10763, name: "News" }],
          popularity: 10,
        },
      },
      {
        kind: "movie",
        item: {
          id: 149,
          title: "Akira",
          release_date: "1988-06-10",
          original_language: "ja",
          genres: [{ id: 16, name: "Animation" }],
          popularity: 1,
        },
      },
    ], "", undefined, true);

    expect(selected?.kind).toBe("movie");
    expect(selected?.item.title).toBe("Akira");
  });
});
