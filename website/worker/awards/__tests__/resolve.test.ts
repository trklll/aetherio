import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOne } from "../resolve";
import { makeEnv } from "./helpers";

describe("resolveOne", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resuelve títulos con artículo invertido del archivo oficial", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/3/search/movie") {
        const query = url.searchParams.get("query");
        return new Response(JSON.stringify({
          results: query === "The Godfather"
            ? [{ id: 238, title: "The Godfather", release_date: "1972-03-14" }]
            : [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/3/movie/238/external_ids") {
        return new Response(JSON.stringify({ imdb_id: "tt0068646" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await resolveOne(
      { ...makeEnv(), TMDB_API_KEY: "test-key" },
      { workKey: "godfather the", workTitle: "Godfather, The", mediaType: "movie" },
    );

    expect(result).toMatchObject({
      status: "resolved",
      tmdbId: 238,
      imdbId: "tt0068646",
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("compara el título original japonés de TMDB", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/3/search/movie") {
        return new Response(JSON.stringify({
          results: [{ id: 129, title: "Spirited Away", original_title: "千と千尋の神隠し", release_date: "2001-07-20" }],
        }), { status: 200 });
      }
      if (url.pathname === "/3/movie/129/external_ids") return new Response(JSON.stringify({ imdb_id: "tt0245429" }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    const result = await resolveOne(
      { ...makeEnv(), TMDB_API_KEY: "test-key" },
      { workKey: "千と千尋の神隠し [2001]", workTitle: "千と千尋の神隠し", workYear: 2001, mediaType: "movie" },
    );
    expect(result).toMatchObject({ status: "resolved", tmdbId: 129, imdbId: "tt0245429" });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("usa el año de ceremonia inferido para títulos numéricos", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === "/3/search/movie") {
        const query = url.searchParams.get("query");
        const result = query === "1917"
          ? { id: 530915, title: "1917", release_date: "2019-12-25" }
          : { id: 578, title: "2001: A Space Odyssey", release_date: "1968-04-02" };
        return new Response(JSON.stringify({ results: [result] }), { status: 200 });
      }
      return new Response(JSON.stringify({ imdb_id: null }), { status: 200 });
    });
    const env = { ...makeEnv(), TMDB_API_KEY: "test-key" };
    await expect(resolveOne(env, { workKey: "1917 [2019]", workTitle: "1917", workYear: 2019, mediaType: "movie" })).resolves.toMatchObject({ tmdbId: 530915, status: "resolved" });
    await expect(resolveOne(env, { workKey: "2001 a space odyssey [1968]", workTitle: "2001: A Space Odyssey", workYear: 1968, mediaType: "movie" })).resolves.toMatchObject({ tmdbId: 578, status: "resolved" });
    expect(fetchMock).toHaveBeenCalled();
  });
});
