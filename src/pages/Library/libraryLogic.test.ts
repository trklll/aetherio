import { describe, expect, it } from "vitest";
import { buildLibraryItems, sortLibraryItems, type LibraryItem } from "./libraryLogic";

const entry = (name: string, userRating?: number, addedAt = 0): LibraryItem => ({
  key: name,
  media: { id: name, type: "movie", name, userRating },
  addedAt,
  listKey: "saved",
  listLabel: "Mi lista",
});

describe("sortLibraryItems", () => {
  it("sorts by personal score descending and leaves unrated entries last", () => {
    const sorted = sortLibraryItems([
      entry("Sin puntuación", undefined, 100),
      entry("Puntuación media", 6),
      entry("Puntuación máxima", 10),
      entry("Puntuación baja", 2),
    ], "rating_desc");

    expect(sorted.map(item => item.media.name)).toEqual([
      "Puntuación máxima",
      "Puntuación media",
      "Puntuación baja",
      "Sin puntuación",
    ]);
  });

  it("uses most recently added as a stable tie-break for equal scores", () => {
    const sorted = sortLibraryItems([
      entry("Anterior", 8, 10),
      entry("Más reciente", 8, 20),
    ], "rating_desc");

    expect(sorted.map(item => item.media.name)).toEqual(["Más reciente", "Anterior"]);
  });

  it("formats imported Trakt scores on the same five-star scale", () => {
    const sorted = sortLibraryItems([
      entry("4,5 estrellas", 9),
      entry("4 estrellas", 8),
    ], "rating_desc");

    expect(sorted.map(item => item.media.name)).toEqual(["4,5 estrellas", "4 estrellas"]);
  });
});

describe("buildLibraryItems", () => {
  it("keeps AniList entries identified as anime when opened from the library", () => {
    const [item] = buildLibraryItems([], [], [{
      aniListId: 123,
      mediaId: "anilist:123",
      title: "Anime de prueba",
      originalTitle: "Test Anime",
      status: "watching",
      score: 0,
      watchedEpisodes: 2,
      totalEpisodes: 12,
    }]);

    expect(item.media.type).toBe("anime");
    expect(item.key).toBe("series:anilist:123");
  });

  it("uses only Por ver and Vistas, with watched taking priority for duplicates", () => {
    const items = buildLibraryItems(
      [{
        id: "tmdb:42",
        type: "movie",
        name: "Una película",
        addedAt: 10,
        libraryStatus: "to_watch",
      }],
      [{
        key: "movie:tmdb:42",
        mediaKey: "movie:tmdb:42",
        type: "movie",
        id: "tmdb:42",
        name: "Una película",
        currentTime: 1,
        duration: 1,
        updatedAt: 20,
        completed: true,
      }],
      [],
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      listKey: "watched",
      listLabel: "Vistas",
      media: { libraryStatus: "watched" },
    });
  });
});
