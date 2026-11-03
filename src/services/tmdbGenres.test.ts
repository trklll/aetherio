import { describe, expect, it } from "vitest";
import {
  buildLibraryGenreOptions,
  getMediaGenreKeys,
  TMDB_MOVIE_GENRES,
  TMDB_TV_GENRES,
} from "./tmdbGenres";
import { buildDiscoverCatalogs } from "../pages/Library/libraryLogic";

describe("TMDB genre catalog", () => {
  it("contains every official movie and TV genre", () => {
    expect(Object.keys(TMDB_MOVIE_GENRES)).toHaveLength(19);
    expect(Object.keys(TMDB_TV_GENRES)).toHaveLength(16);
    expect(TMDB_MOVIE_GENRES["Película de TV"]).toBe("10770");
    expect(TMDB_TV_GENRES["Guerra y política"]).toBe("10768");
  });

  it("exposes the complete TMDB genre lists in built-in Discover catalogs", () => {
    const catalogs = buildDiscoverCatalogs([]);
    expect(catalogs.find(catalog => catalog.key === "tmdb:movie:popular")?.genres).toHaveLength(19);
    expect(catalogs.find(catalog => catalog.key === "tmdb:series:popular")?.genres).toHaveLength(16);
  });

  it("canonicalizes localized and English aliases by media type", () => {
    expect(getMediaGenreKeys({ type: "movie", genres: ["Action"] })).toEqual(["tmdb:28"]);
    expect(getMediaGenreKeys({ type: "series", genres: ["Action & Adventure"] })).toEqual(["tmdb:10759"]);
    expect(getMediaGenreKeys({ type: "movie", genres: ["Película de TV"] })).toEqual(["tmdb:10770"]);
  });

  it("lists only genres that are actually present, deduplicates aliases, and sorts them", () => {
    const options = buildLibraryGenreOptions([
      { type: "movie", genres: ["Action", "Comedy"] },
      { type: "movie", genres: ["Acción", "Drama"] },
      { type: "series", genreIds: [10763] },
      { type: "anime", genres: ["Psychological"] },
      { type: "movie", genres: [] },
    ]);

    expect(options.map(option => option.label)).toEqual([
      "Acción",
      "Comedia",
      "Drama",
      "Noticias",
      "Psychological",
    ]);
    expect(options.map(option => option.key)).toEqual([
      "tmdb:28",
      "tmdb:35",
      "tmdb:18",
      "tmdb:10763",
      "custom:psychological",
    ]);
  });
});
