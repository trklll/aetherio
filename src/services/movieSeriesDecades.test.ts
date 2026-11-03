import { beforeEach, describe, expect, it, vi } from "vitest";

const { tmdbFetch } = vi.hoisted(() => ({ tmdbFetch: vi.fn() }));

vi.mock("../config/apiKeys", () => ({ tmdbFetch }));

import { fetchMovieSeriesDecadeRows, MOVIE_SERIES_DECADES } from "./movieSeriesDecades";

describe("movie and series decade rails", () => {
  beforeEach(() => tmdbFetch.mockReset());

  it("keeps the four decade pairs from the 1990s through the 2020s", async () => {
    expect(MOVIE_SERIES_DECADES.map(({ startYear, endYear }) => [startYear, endYear])).toEqual([
      [1990, 1999], [2000, 2009], [2010, 2019], [2020, 2029],
    ]);
    tmdbFetch.mockResolvedValue({ results: [{
      id: 19901,
      title: "Película de época",
      name: "Serie de época",
      release_date: "1995-06-01",
      first_air_date: "1995-07-01",
      poster_path: "/poster.jpg",
      genre_ids: [18],
    }] });

    const rows = await fetchMovieSeriesDecadeRows();

    expect(rows).toHaveLength(8);
    expect(rows.map(row => `${row.type}:${row.name}`)).toEqual([
      "movie:Las mejores películas de los 90",
      "series:Las mejores series de los 90",
      "movie:Las mejores películas de los 2000",
      "series:Las mejores series de los 2000",
      "movie:Las mejores películas de los 2010",
      "series:Las mejores series de los 2010",
      "movie:Las mejores películas de los 2020",
      "series:Las mejores series de los 2020",
    ]);
    expect(rows.every(row => row.presentation === "cinematic" && row.items.length === 1)).toBe(true);
    expect(tmdbFetch).toHaveBeenCalledTimes(8);
  });

});
