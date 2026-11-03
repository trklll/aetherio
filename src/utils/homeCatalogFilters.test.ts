import { describe, expect, it } from "vitest";
import { isYearBasedMovieSeriesHomeRow } from "./homeCatalogFilters";

describe("isYearBasedMovieSeriesHomeRow", () => {
  it("filters annual movie and series catalog titles", () => {
    expect(isYearBasedMovieSeriesHomeRow("New - 2025", "movie")).toBe(true);
    expect(isYearBasedMovieSeriesHomeRow("New - 2026", "tv")).toBe(true);
    expect(isYearBasedMovieSeriesHomeRow("Películas nuevas de 2025", "movie")).toBe(true);
    expect(isYearBasedMovieSeriesHomeRow("Series nuevas de 2024", "series")).toBe(true);
  });

  it("leaves anime and non-year-based catalogs alone", () => {
    expect(isYearBasedMovieSeriesHomeRow("New - 2025", "anime")).toBe(false);
    expect(isYearBasedMovieSeriesHomeRow("Popular", "movie")).toBe(false);
    expect(isYearBasedMovieSeriesHomeRow("New - 2025", "documentary")).toBe(false);
  });
});
