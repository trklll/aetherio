import { describe, expect, it } from "vitest";
import {
  applyHomeCatalogPreferences,
  catalogPreferenceKey,
  type HomePreferences,
} from "./homePreferences";
import type { CatalogRowData } from "../types/ui";

function row(addonId: string, type: string, order: number): CatalogRowData {
  return {
    addonId,
    addonName: addonId,
    catalogId: `${addonId}-catalog`,
    type,
    name: addonId,
    items: [],
    order,
  };
}

function preferences(overrides: Partial<HomePreferences> = {}): HomePreferences {
  return {
    contentOrientation: "both",
    posterLayout: "horizontal",
    catalogOrder: [],
    hiddenCatalogKeys: [],
    allowTmdbArtworkFallback: false,
    ...overrides,
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
});
