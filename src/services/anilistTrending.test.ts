import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const anime = {
  id: 21,
  idMal: 21,
  title: { romaji: "ONE PIECE", english: "One Piece" },
  coverImage: { large: "https://example.com/cover.jpg", extraLarge: "https://example.com/cover-hq.jpg" },
  bannerImage: "https://example.com/banner.jpg",
  description: "<p>Pirate adventure</p>",
  averageScore: 88,
  genres: ["Action", "Adventure"],
  season: "FALL",
  seasonYear: 1999,
  startDate: { year: 1999 },
  status: "RELEASING",
};

describe("AniList trending discovery", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { Page: { media: [anime] } } })));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests twenty non-adult trending anime, not popularity or score rankings", async () => {
    const { fetchAnilistTrendingAnime } = await import("./anilist");
    await fetchAnilistTrendingAnime();

    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(url).toBe("https://graphql.anilist.co");
    expect(body.query).toContain("perPage: 20");
    expect(body.query).toContain("sort: TRENDING_DESC");
    expect(body.query).toContain("isAdult: false");
    expect(body.variables).toEqual({ genre: null });
  });

  it("passes genre as a GraphQL variable and preserves the source order", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { Page: { media: [
      { ...anime, id: 100, averageScore: 40 },
      { ...anime, id: 200, averageScore: 99 },
    ] } } })));
    const { fetchAnilistTrendingAnime } = await import("./anilist");
    const items = await fetchAnilistTrendingAnime("Drama");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables).toEqual({ genre: "Drama" });
    expect(items.map(item => item.id)).toEqual(["anilist:100", "anilist:200"]);
  });

  it("keeps high-resolution covers, seasons, airing status and detail identity", async () => {
    const { fetchAnilistTrendingAnime } = await import("./anilist");
    expect(await fetchAnilistTrendingAnime()).toEqual([expect.objectContaining({
      id: "anilist:21",
      type: "anime",
      name: "One Piece",
      poster: anime.coverImage.extraLarge,
      background: anime.bannerImage,
      description: "Pirate adventure",
      season: "FALL",
      seasonYear: 1999,
      isAiring: true,
    })]);
  });

  it("does not fabricate an airing badge or a season when metadata is missing", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { Page: { media: [
      { ...anime, status: "NOT_YET_RELEASED", season: null, seasonYear: null, coverImage: null, bannerImage: null },
    ] } } })));
    const { fetchAnilistTrendingAnime } = await import("./anilist");
    const [item] = await fetchAnilistTrendingAnime();
    expect(item.isAiring).toBe(false);
    expect(item.season).toBeUndefined();
    expect(item.seasonYear).toBeUndefined();
    expect(item.poster).toBeUndefined();
  });

  it("distinguishes an empty genre from a failed service", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { Page: { media: [] } } })));
    const { fetchAnilistTrendingAnime } = await import("./anilist");
    expect(await fetchAnilistTrendingAnime("Horror")).toEqual([]);
  });

  it.each(["http", "network", "graphql"])("reports %s failures so the UI can offer retry", async failure => {
    if (failure === "network") fetchMock.mockRejectedValue(new Error("offline"));
    if (failure === "http") fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    if (failure === "graphql") fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "Unavailable" }] })));
    const { fetchAnilistTrendingAnime } = await import("./anilist");
    await expect(fetchAnilistTrendingAnime()).rejects.toThrow("AniList");
  });
});
