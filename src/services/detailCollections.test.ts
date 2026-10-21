import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDetailCollection } from "./detailCollections";

afterEach(() => vi.unstubAllGlobals());

describe("fetchDetailCollection", () => {
  it("skips collections for anime requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDetailCollection({
      mediaId: "mal:123456",
      mediaType: "anime",
      tmdbId: 9999999,
      title: "Anime",
      tmdbData: { original_language: "ja", genres: [{ id: 16, name: "Animation" }] },
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips TMDB anime even when the route type is series", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchDetailCollection({
      mediaId: "tmdb:9999999",
      mediaType: "series",
      tmdbId: 9999999,
      title: "Anime",
      tmdbData: { original_language: "ja", genres: [{ id: 16, name: "Animation" }] },
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
