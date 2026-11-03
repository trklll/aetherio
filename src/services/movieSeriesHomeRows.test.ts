import { beforeEach, describe, expect, it, vi } from "vitest";

const { tmdbFetch } = vi.hoisted(() => ({ tmdbFetch: vi.fn() }));

vi.mock("../config/apiKeys", () => ({ tmdbFetch }));

import { fetchMovieSeriesHomeRows, orderMovieSeriesHomeRows } from "./movieSeriesHomeRows";

describe("additional movie and series Home rows", () => {
  beforeEach(() => {
    tmdbFetch.mockReset();
    tmdbFetch.mockResolvedValue({ results: [{
      id: 101,
      title: "Película de prueba",
      name: "Serie de prueba",
      release_date: "1980-01-01",
      first_air_date: "1980-01-01",
      genre_ids: [27],
    }] });
  });

  it("returns the ten approved rows in the requested order with global genre filters", async () => {
    const rows = await fetchMovieSeriesHomeRows();

    expect(rows.map(row => `${row.type}:${row.name}`)).toEqual([
      "movie:Películas de terror",
      "movie:Películas familiares",
      "series:Series de comedia",
      "series:Series de drama",
      "movie:Películas de ciencia ficción y fantasía",
      "movie:Películas románticas",
      "series:Series documentales",
      "series:Series de acción y aventura",
      "movie:Clásicos del cine anteriores a 1990",
      "series:Series clásicas anteriores a 1990",
    ]);
    expect(new Set(rows.map(row => row.catalogId)).size).toBe(10);
    expect(rows.every(row => row.addonId === "aetherio-starter" && row.items.length === 1)).toBe(true);

    const requests = tmdbFetch.mock.calls as Array<[string, { params: Record<string, string> }]>;
    expect(requests.map(([path]) => path)).toEqual([
      "/discover/movie",
      "/discover/movie",
      "/discover/tv",
      "/discover/tv",
      "/discover/movie",
      "/discover/movie",
      "/discover/tv",
      "/discover/tv",
      "/discover/movie",
      "/discover/tv",
    ]);
    expect(requests.map(([, { params }]) => params.with_genres)).toEqual([
      "27", "10751", "35", "18", "878|14", "10749", "99", "10759", undefined, undefined,
    ]);
    expect(requests.every(([, { params }]) =>
      params.language === "es-ES"
      && params.include_adult === "false"
      && !("region" in params)
      && !("watch_region" in params)
      && !("with_watch_providers" in params),
    )).toBe(true);
    expect(requests[8][1].params).toMatchObject({
      sort_by: "vote_average.desc",
      "vote_count.gte": "100",
      "primary_release_date.lte": "1989-12-31",
    });
    expect(requests[9][1].params).toMatchObject({
      sort_by: "vote_average.desc",
      "vote_count.gte": "50",
      "first_air_date.lte": "1989-12-31",
    });
  });

  it("omits a failed TMDB category without losing the other rows", async () => {
    tmdbFetch.mockImplementation((_path: string, { params }: { params: Record<string, string> }) => {
      if (params.with_genres === "27") return Promise.reject(new Error("TMDB unavailable"));
      return Promise.resolve({ results: [{ id: 101, title: "Película", name: "Serie" }] });
    });

    const rows = await fetchMovieSeriesHomeRows();

    expect(rows).toHaveLength(9);
    expect(rows.some(row => row.name === "Películas de terror")).toBe(false);
  });

  it("interleaves genre rows with decade pairs in ascending order", () => {
    const ids = [
      "tmdb.home.movie.horror",
      "tmdb.home.movie.family",
      "tmdb.home.series.comedy",
      "tmdb.home.series.drama",
      "tmdb.home.movie.science_fiction_fantasy",
      "tmdb.home.movie.romance",
      "tmdb.home.series.documentary",
      "tmdb.home.series.action_adventure",
      "tmdb.home.movie.classics_pre_1990",
      "tmdb.home.series.classics_pre_1990",
      "tmdb.best_movie_90s",
      "tmdb.best_series_90s",
      "tmdb.best_movie_2000s",
      "tmdb.best_series_2000s",
      "tmdb.best_movie_2010s",
      "tmdb.best_series_2010s",
      "tmdb.best_movie_2020s",
      "tmdb.best_series_2020s",
    ];
    const rows = ids.map(catalogId => ({
      addonId: "aetherio-starter",
      addonName: "Aetherio",
      catalogId,
      type: catalogId.includes("series") ? "series" : "movie",
      name: catalogId,
      items: [],
    }));

    expect(orderMovieSeriesHomeRows(rows).map(row => row.catalogId)).toEqual([
      "tmdb.best_movie_90s",
      "tmdb.best_series_90s",
      "tmdb.best_movie_2000s",
      "tmdb.home.movie.horror",
      "tmdb.home.movie.family",
      "tmdb.best_series_2000s",
      "tmdb.home.series.comedy",
      "tmdb.home.series.drama",
      "tmdb.best_movie_2010s",
      "tmdb.home.movie.science_fiction_fantasy",
      "tmdb.home.movie.romance",
      "tmdb.best_series_2010s",
      "tmdb.home.series.documentary",
      "tmdb.home.series.action_adventure",
      "tmdb.best_movie_2020s",
      "tmdb.home.movie.classics_pre_1990",
      "tmdb.home.series.classics_pre_1990",
      "tmdb.best_series_2020s",
    ]);
  });
});
