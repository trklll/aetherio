import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyHomeCatalogPreferences,
  catalogPreferenceKey,
  getHomePreferences,
  type HomePreferences,
} from "./homePreferences";
import type { CatalogRowData } from "../types/ui";

function row(addonId: string, type: string, order: number, name = addonId, catalogId = `${addonId}-catalog`): CatalogRowData {
  return {
    addonId,
    addonName: addonId,
    catalogId,
    type,
    name,
    items: [],
    order,
  };
}

function preferences(overrides: Partial<HomePreferences> = {}): HomePreferences {
  return {
    contentOrientation: "both",
    bothPreference: "movies-series",
    posterLayout: "horizontal",
    catalogOrder: [],
    hiddenCatalogKeys: [],
    allowTmdbArtworkFallback: false,
    ...overrides,
  };
}

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("applyHomeCatalogPreferences", () => {
  it("respects manual catalog order in Ambos", () => {
    const movies = row("movies", "movie", 1);
    const anime = row("anime", "anime", 2);
    const result = applyHomeCatalogPreferences(
      [movies, anime],
      preferences({ catalogOrder: [catalogPreferenceKey(anime), catalogPreferenceKey(movies)] }),
    );

    expect(result.map(item => item.addonId)).toEqual(["anime", "movies"]);
  });

  it("prioritizes the selected orientation without hiding other catalogs", () => {
    const movies = row("movies", "movie", 1);
    const anime = row("anime", "anime", 2);

    const result = applyHomeCatalogPreferences([movies, anime], preferences({ contentOrientation: "anime" }));

    expect(result.map(item => item.addonId)).toEqual(["anime", "movies"]);
  });

  it("removes only catalogs explicitly hidden by the user", () => {
    const visible = row("visible", "movie", 1);
    const hidden = row("hidden", "anime", 2);

    const result = applyHomeCatalogPreferences(
      [visible, hidden],
      preferences({ hiddenCatalogKeys: [catalogPreferenceKey(hidden)] }),
    );

    expect(result.map(item => item.addonId)).toEqual(["visible"]);
  });

  it("uses orientation priority for catalogs that are not yet in a saved order", () => {
    const orderedMovie = row("ordered", "movie", 1);
    const newAnime = row("new-anime", "anime", 2);
    const newMovie = row("new-movie", "movie", 3);

    const result = applyHomeCatalogPreferences(
      [orderedMovie, newMovie, newAnime],
      preferences({
        contentOrientation: "anime",
        catalogOrder: [catalogPreferenceKey(orderedMovie)],
      }),
    );

    expect(result.map(item => item.addonId)).toEqual(["ordered", "new-anime", "new-movie"]);
  });

  it("shows series/movies first in Ambos by default", () => {
    const movies = row("movies", "movie", 1);
    const anime = row("anime", "anime", 2);

    const result = applyHomeCatalogPreferences(
      [anime, movies],
      preferences({ contentOrientation: "both", bothPreference: "movies-series" }),
    );

    expect(result.map(item => item.addonId)).toEqual(["movies", "anime"]);
  });

  it("shows anime first in Ambos when anime is preferred", () => {
    const movies = row("movies", "movie", 1);
    const anime = row("anime", "anime", 2);

    const result = applyHomeCatalogPreferences(
      [movies, anime],
      preferences({ contentOrientation: "both", bothPreference: "anime" }),
    );

    expect(result.map(item => item.addonId)).toEqual(["anime", "movies"]);
  });

  it("interlaces default movie and series rows and places top rows by year", () => {
    const moviePopular = row("movie-popular", "movie", 1, "Películas populares", "movie-popular");
    const topMovies = row("top-movies", "movie", 2, "Top Películas", "tmdb.trending_movie");
    const movie2026 = row("movie-2026", "movie", 3, "Películas nuevas de 2026", "movie-2026");
    const seriesPopular = row("series-popular", "series", 4, "Series populares", "series-popular");
    const series2026 = row("series-2026", "series", 5, "Series nuevas de 2026", "series-2026");
    const movie2025 = row("movie-2025", "movie", 6, "Películas nuevas de 2025", "movie-2025");
    const series2025 = row("series-2025", "series", 7, "Series nuevas de 2025", "series-2025");
    const movie2024 = row("movie-2024", "movie", 8, "Películas nuevas de 2024", "movie-2024");
    const series2024 = row("series-2024", "series", 9, "Series nuevas de 2024", "series-2024");
    const movie2023 = row("movie-2023", "movie", 10, "Películas nuevas de 2023", "movie-2023");
    const series2023 = row("series-2023", "series", 11, "Series nuevas de 2023", "series-2023");
    const topSeries = row("top-series", "series", 12, "Top Series", "tmdb.trending_series");

    const result = applyHomeCatalogPreferences(
      [moviePopular, topMovies, movie2026, seriesPopular, series2026, movie2025, series2025, movie2024, series2024, movie2023, series2023, topSeries],
      preferences(),
    );

    expect(result.map(item => item.addonId)).toEqual([
      "movie-popular",
      "series-popular",
      "movie-2026",
      "series-2026",
      "top-movies",
      "movie-2025",
      "series-2025",
      "movie-2024",
      "series-2024",
      "movie-2023",
      "series-2023",
      "top-series",
    ]);
  });
});

describe("default catalog order migration", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorage());
    localStorage.setItem("aetherio-active-profile-id", "test-profile");
    localStorage.setItem(
      "aetherio-profile:test-profile:aetherio-home-preferences",
      JSON.stringify({ ...preferences(), catalogOrder: ["legacy-order"] }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the previous saved order once for the active profile", () => {
    expect(getHomePreferences().catalogOrder).toEqual([]);
    expect(localStorage.getItem("aetherio-profile:test-profile:aetherio-home-default-order-migration-v2")).toBe("1");
  });
});
