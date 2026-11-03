import { describe, expect, it } from "vitest";
import {
  getMovieSeriesGenre,
  interleaveMovieSeriesGenreItems,
  mapMovieSeriesGenreItem,
  MOVIE_SERIES_GENRES,
} from "./movieSeriesGenres";

describe("movie/series genre showcase data", () => {
  it("defines unique, non-anime genre choices for both formats", () => {
    const keys = MOVIE_SERIES_GENRES.map(genre => genre.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(MOVIE_SERIES_GENRES.every(genre => genre.movieGenreIds && genre.tvGenreIds)).toBe(true);
    expect(keys).not.toContain("animation");
  });

  it("maps TMDB movies and series to the app media shape", () => {
    const movie = mapMovieSeriesGenreItem({
      id: 42,
      title: "Película",
      poster_path: "/poster.jpg",
      backdrop_path: "/backdrop.jpg",
      release_date: "2024-02-03",
      vote_average: 8.26,
      genre_ids: [18],
    }, "movie");
    const series = mapMovieSeriesGenreItem({
      id: 73,
      name: "Serie",
      first_air_date: "2021-10-01",
      genre_ids: [18],
    }, "series");

    expect(movie).toMatchObject({
      id: "tmdb:42",
      type: "movie",
      name: "Película",
      poster: "https://image.tmdb.org/t/p/w500/poster.jpg",
      background: "https://image.tmdb.org/t/p/original/backdrop.jpg",
      year: 2024,
      rating: "8.3",
      genres: ["Drama"],
    });
    expect(series).toMatchObject({ id: "tmdb:73", type: "series", name: "Serie", year: 2021 });
  });

  it("omits Japanese animation from the general movie and series genres", () => {
    expect(mapMovieSeriesGenreItem({
      id: 99,
      name: "Anime",
      genre_ids: [16, 18],
      original_language: "ja",
    }, "series")).toBeNull();
  });

  it("allows Japanese anime when a platform explicitly opts in", () => {
    expect(mapMovieSeriesGenreItem({
      id: 100,
      name: "Anime de Crunchyroll",
      genre_ids: [16, 18],
      original_language: "ja",
    }, "series", true)).toMatchObject({
      id: "tmdb:100",
      type: "series",
      name: "Anime de Crunchyroll",
    });
  });

  it("interleaves movie and series posters, with a graceful fallback for a short side", () => {
    const movies = ["m1", "m2"].map(id => ({ id, type: "movie", name: id }));
    const series = ["s1"].map(id => ({ id, type: "series", name: id }));
    expect(interleaveMovieSeriesGenreItems(movies, series).map(item => item.id)).toEqual(["m1", "s1", "m2"]);
  });

  it("rejects unknown genre keys", () => {
    expect(getMovieSeriesGenre("not-a-genre")).toBeUndefined();
  });
});
