import { beforeEach, describe, expect, it, vi } from "vitest";

const { tmdbFetch } = vi.hoisted(() => ({ tmdbFetch: vi.fn() }));

vi.mock("../config/apiKeys", () => ({ tmdbFetch }));

import {
  fetchStreamingPlatformCollections,
  fetchStreamingPlatformRows,
  getStreamingPlatformCatalogRequest,
  getStreamingPlatform,
  getStreamingPlatformPath,
  STREAMING_PLATFORMS,
} from "./streamingPlatforms";

describe("streaming platform catalogs", () => {
  beforeEach(() => {
    tmdbFetch.mockReset();
    let id = 0;
    tmdbFetch.mockImplementation((path: string) => Promise.resolve({
      results: [{
        id: ++id,
        title: path === "/discover/movie" ? "Película" : undefined,
        name: path === "/discover/tv" ? "Serie" : undefined,
        release_date: "2024-01-01",
        first_air_date: "2024-01-01",
      }],
    }));
  });

  it("defines seven platforms with their card and optional intro assets", () => {
    expect(STREAMING_PLATFORMS.map(platform => platform.name)).toEqual([
      "Netflix",
      "HBO Max",
      "Crunchyroll",
      "Prime Video",
      "Apple TV+",
      "MUBI",
      "Disney+",
    ]);
    expect(STREAMING_PLATFORMS.every(platform =>
      platform.cardImage.startsWith("/assets/streaming-platforms/")
      && platform.description.length > 0
      && (!platform.intro || platform.intro.startsWith("/assets/streaming-platforms/")),
    )).toBe(true);
    expect(getStreamingPlatform("netflix")?.description).toBe(
      "Disfruta de series, películas, documentales y producciones originales de todo el mundo, con historias para todos los gustos.",
    );
    expect(getStreamingPlatform("mubi")?.description).toBe(
      "Descubre una selección cuidadosamente elegida de cine independiente, clásicos, películas de autor y obras premiadas de todo el mundo.",
    );
    expect(getStreamingPlatform("mubi")?.providerIds).toBe("11");
    expect(getStreamingPlatform("disney-plus")?.cardImage).toBe("/assets/streaming-platforms/disney-plus-card.jpg");
    expect(getStreamingPlatform("hbo-max")?.intro).toBe("/assets/streaming-platforms/hbomax_intro.mp4");
  });

  it("builds popular and best-rated movie and series rows using PE then US, never Spain", async () => {
    const rows = await fetchStreamingPlatformRows("netflix");

    expect(rows.map(row => `${row.type}:${row.name}`)).toEqual([
      "movie:Películas populares",
      "series:Series populares",
      "movie:Top 10 Películas",
      "series:Series mejor valoradas",
    ]);
    expect(rows.every(row => row.addonId === "tmdb" && row.items.length === 1)).toBe(true);

    const calls = (tmdbFetch.mock.calls as Array<[string, { params: Record<string, string> }]>).filter(([, { params }]) => params.with_genres !== "16");
    expect(calls.map(([path]) => path)).toEqual([
      "/discover/movie", "/discover/movie", "/discover/tv", "/discover/tv",
    ]);
    expect(calls.every(([, { params }]) =>
      params.with_watch_providers === "8"
      && params.watch_region === "PE"
      && params.region === "PE"
      && params.language === "es-ES"
      && params.include_adult === "false",
    )).toBe(true);
    expect(calls[1][1].params).toMatchObject({ sort_by: "vote_average.desc", "vote_count.gte": "100" });
    expect(calls[3][1].params).toMatchObject({ sort_by: "vote_average.desc", "vote_count.gte": "50" });
  });

  it("queries MUBI catalogs with TMDB provider 11", async () => {
    const rows = await fetchStreamingPlatformRows("mubi");

    expect(rows).toHaveLength(4);
    expect(tmdbFetch.mock.calls.every(([, { params }]) => params.with_watch_providers === "11")).toBe(true);
  });

  it("uses the original Prime Video title artwork", () => {
    expect(getStreamingPlatform("prime-video")?.titleImage).toBe("/assets/streaming-platforms/primevideo-title.png");
  });

  it("includes Japanese anime and merges paginated PE and US Crunchyroll catalogs", async () => {
    tmdbFetch.mockImplementation((path: string, { params }: { params: Record<string, string> }) => {
      const regionItems = params.watch_region === "PE"
        ? [{ id: 1, title: "Anime Perú", name: "Anime Perú", genre_ids: [16], original_language: "ja" }]
        : params.page === "1"
          ? [
            { id: 1, title: "Anime Perú", name: "Anime Perú", genre_ids: [16], original_language: "ja" },
            { id: 2, title: "Anime EE. UU. 1", name: "Anime EE. UU. 1", genre_ids: [16], original_language: "ja" },
          ]
          : [{ id: 3, title: "Anime EE. UU. 2", name: "Anime EE. UU. 2", genre_ids: [16], original_language: "ja" }];

      return Promise.resolve({
        total_pages: params.watch_region === "US" ? 2 : 1,
        results: regionItems.map(item => ({
          ...item,
          vote_average: item.id === 1 ? 8.6 : item.id === 2 ? 8.4 : 8.2,
          ...(path === "/discover/movie" ? { title: item.title } : { name: item.name }),
        })),
      });
    });

    const rows = await fetchStreamingPlatformRows("crunchyroll");

    expect(rows.map(row => row.name)).toEqual([
      "Top 10 Anime",
      "Películas populares",
      "Series populares",
      "Top 10 Películas",
      "Series mejor valoradas",
    ]);
    const expectedNames = [
      "Anime Perú",
      "Anime EE. UU. 1",
      "Anime EE. UU. 2",
    ];
    expect(rows[0].items.map(item => item.name)).toEqual(["Anime Perú"]);
    expect(rows.slice(1).map(row => row.items.map(item => item.name))).toEqual(
      Array.from({ length: 4 }, () => expectedNames),
    );
    const calls = tmdbFetch.mock.calls as Array<[string, { params: Record<string, string> }]>;
    expect(calls.some(([, { params }]) => params.watch_region === "US" && params.page === "2")).toBe(true);
    expect(calls.every(([, { params }]) => params.with_watch_providers === "283")).toBe(true);
  });

  it("shows only the ten highest-scored TMDB anime, first in the Crunchyroll page", async () => {
    tmdbFetch.mockImplementation((_path: string, { params }: { params: Record<string, string> }) => Promise.resolve({
      results: params.with_genres === "16"
        ? Array.from({ length: 12 }, (_, index) => ({
          id: index + 1,
          name: `Anime ${index + 1}`,
          genre_ids: [16],
          original_language: "ja",
          vote_average: index === 0 ? 7.1 : 9.5 - index / 10,
        }))
        : [],
    }));

    const rows = await fetchStreamingPlatformRows("crunchyroll");

    expect(rows[0].name).toBe("Top 10 Anime");
    expect(rows[0].items).toHaveLength(10);
    expect(rows[0].items[0].name).toBe("Anime 2");
    expect(rows[0].items[9].name).toBe("Anime 11");
  });

  it("caps Crunchyroll pagination at ten TMDB pages per region and rail", async () => {
    tmdbFetch.mockResolvedValue({
      total_pages: 500,
      results: [{ id: 501, title: "Anime", name: "Anime", genre_ids: [16], original_language: "ja" }],
    });

    await fetchStreamingPlatformRows("crunchyroll");

    const calls = tmdbFetch.mock.calls as Array<[string, { params: Record<string, string> }]>;
    expect(calls).toHaveLength(4 * 2 * 10 + 2);
    expect(calls.every(([, { params }]) => Number(params.page) <= 10)).toBe(true);
  });

  it("falls back to US when the primary region has no results", async () => {
    tmdbFetch.mockImplementation((_path: string, { params }: { params: Record<string, string> }) => Promise.resolve({
      results: params.watch_region === "PE" ? [] : [{ id: 401, title: "Fallback" }],
    }));

    const rows = await fetchStreamingPlatformRows("netflix");

    expect(rows).toHaveLength(4);
    expect(tmdbFetch.mock.calls.some(([, { params }]) => params.watch_region === "US")).toBe(true);
    expect(tmdbFetch.mock.calls.every(([, { params }]) => params.watch_region !== "ES")).toBe(true);
  });

  it("returns no rows for an unknown platform", async () => {
    expect(await fetchStreamingPlatformRows("not-a-platform")).toEqual([]);
    expect(tmdbFetch).not.toHaveBeenCalled();
    expect(getStreamingPlatform("not-a-platform")).toBeUndefined();
  });

  it("sorts the Top 10 movie row by TMDB score and keeps the first ten", async () => {
    tmdbFetch.mockImplementation((path: string, { params }: { params: Record<string, string> }) => {
      if (path === "/discover/movie" && params.sort_by === "vote_average.desc") {
        return Promise.resolve({ results: Array.from({ length: 12 }, (_, index) => ({
          id: index + 1,
          title: `Película ${index + 1}`,
          vote_average: index === 0 ? 6.1 : index === 1 ? 9.41 : index === 2 ? 9.46 : 9.3 - index / 100,
        })) });
      }
      return Promise.resolve({ results: [{ id: 100, title: "Popular", name: "Popular" }] });
    });

    const rows = await fetchStreamingPlatformRows("netflix");
    const topTen = rows.find(row => row.name === "Top 10 Películas");

    expect(topTen?.items).toHaveLength(10);
    expect(topTen?.items.map(item => Number(item.rating))).toEqual(
      [...(topTen?.items.map(item => Number(item.rating)) ?? [])].sort((a, b) => b - a),
    );
    expect(topTen?.items[0].name).toBe("Película 3");
  });

  it("exposes TMDB catalog variants for platform rows so Ver más can load them", () => {
    const request = getStreamingPlatformCatalogRequest("streaming.hbo-max.movie.top-10");
    expect(request).toMatchObject({
      path: "/discover/movie",
      type: "movie",
      variants: [
        { params: { with_watch_providers: "1899|384", watch_region: "PE", sort_by: "vote_average.desc" } },
        { params: { with_watch_providers: "1899|384", watch_region: "US", sort_by: "vote_average.desc" } },
      ],
    });
    expect(getStreamingPlatformCatalogRequest("streaming.crunchyroll.anime.top-10")?.variants[0].params)
      .toMatchObject({ with_watch_providers: "283", with_genres: "16", with_original_language: "ja" });
    expect(getStreamingPlatformCatalogRequest("streaming.not-a-platform.movie.top-10")).toBeNull();
  });

  it("discovers unique TMDB collections from platform movies and returns their artwork and count", async () => {
    tmdbFetch.mockImplementation((path: string) => {
      if (path === "/movie/1") return Promise.resolve({
        belongs_to_collection: { id: 70, name: "Saga de prueba", poster_path: "/saga.jpg", backdrop_path: "/saga-bg.jpg" },
        runtime: 105,
      });
      if (path === "/movie/2") return Promise.resolve({
        belongs_to_collection: { id: 70, name: "Saga de prueba", poster_path: "/saga.jpg", backdrop_path: "/saga-bg.jpg" },
        runtime: 98,
      });
      if (path === "/movie/3") return Promise.resolve({ runtime: 112 });
      if (path === "/collection/70") return Promise.resolve({
        poster_path: "/saga.jpg",
        backdrop_path: "/saga-bg.jpg",
        parts: [
          { id: 1, title: "Una", release_date: "2020-01-01" },
          { id: 2, title: "Dos", release_date: "2022-01-01" },
          { id: 3, title: "Tres", release_date: "2024-01-01" },
        ],
      });
      return Promise.resolve({});
    });

    const collections = await fetchStreamingPlatformCollections("netflix", [
      { id: "tmdb:1", type: "movie", name: "Una" },
      { id: "tmdb:2", type: "movie", name: "Dos" },
    ]);

    expect(collections).toEqual([{
      id: 70,
      name: "Saga de prueba",
      poster: "https://image.tmdb.org/t/p/w500/saga.jpg",
      background: "https://image.tmdb.org/t/p/original/saga-bg.jpg",
      itemCount: 3,
    }]);
    expect(tmdbFetch.mock.calls.filter(([path]) => path === "/collection/70")).toHaveLength(1);
  });

  it("builds normal and Big Picture platform routes", () => {
    expect(getStreamingPlatformPath("netflix")).toBe("/platform/netflix");
    expect(getStreamingPlatformPath("crunchyroll", true)).toBe("/big-picture/platform/crunchyroll");
    expect(getStreamingPlatformPath("mubi")).toBe("/platform/mubi");
    expect(getStreamingPlatformPath("mubi", true)).toBe("/big-picture/platform/mubi");
    expect(getStreamingPlatformPath("not a platform")).toBe("/platform/not%20a%20platform");
  });
});
