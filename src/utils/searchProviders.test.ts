import { beforeEach, describe, expect, it, vi } from "vitest";

const tmdbFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../config/apiKeys.ts", () => ({ tmdbFetch: tmdbFetchMock }));

import {
  clearSearchCache,
  damerauLevenshtein,
  mergeSearchResults,
  normalizeWithoutStopwords,
  normalizeSearchText,
  searchMediaResponse,
  trigramDice,
  type UnifiedSearchResult,
} from "./searchProviders";
import { parseSemanticSearchIntent } from "./semanticSearch";

function result(overrides: Partial<UnifiedSearchResult>): UnifiedSearchResult {
  return {
    key: `${overrides.type ?? "series"}:${overrides.id ?? "test"}`,
    id: overrides.id ?? "test",
    type: overrides.type ?? "series",
    name: overrides.name ?? "Test title",
    source: overrides.source ?? "tmdb",
    sourceName: overrides.sourceName ?? "TMDB",
    mediaLabel: overrides.type === "movie" ? "Pelicula" : "Serie",
    ...overrides,
  };
}

describe("search ranking", () => {
  beforeEach(() => {
    clearSearchCache();
    tmdbFetchMock.mockReset();
    vi.restoreAllMocks();
  });

  it("preserves stopwords for title identity", () => {
    expect(normalizeSearchText("La La Land")).toBe("la la land");
    expect(normalizeSearchText("Jujutsu-Kaisen")).toBe("jujutsu kaisen");
    expect(normalizeWithoutStopwords("La La Land")).toBe("land");
    expect(normalizeSearchText("Amélie: El espíritu del film")).toBe("amelie el espiritu del film");
  });

  it("detects transpositions and close trigram matches", () => {
    expect(damerauLevenshtein("kaisen", "kaisne")).toBe(1);
    expect(trigramDice("jujutsu kaisen", "jujutsu kaisenk")).toBeGreaterThan(0.8);
  });

  it("places an exact title before a popular partial match", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:1", name: "Jujutsu Kaisen", popularity: 1, voteCount: 5 }),
      result({ id: "tmdb:2", name: "Jujutsu Kaisen 0 Reaction", popularity: 999, voteCount: 50_000 }),
    ], 10, "jujutsu kaisen");
    expect(ranked.map(item => item.name)).toEqual(["Jujutsu Kaisen", "Jujutsu Kaisen 0 Reaction"]);
    expect(ranked[0].relevanceTier).toBeGreaterThan(ranked[1].relevanceTier ?? 0);
  });

  it("keeps a close typo candidate in the fuzzy band", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:1", name: "Jujutsu Kaisen", popularity: 1 }),
      result({ id: "tmdb:2", name: "Kaiju No. 8", popularity: 999 }),
    ], 10, "jujutsu kaisenk");
    expect(ranked[0].name).toBe("Jujutsu Kaisen");
    expect(ranked[0].relevanceTier).toBeGreaterThan(ranked[1].relevanceTier ?? 0);
  });

  it.each(["jujtsu kaisen", "jujutsu kaisne"]) ("ranks transposed typo %s first", query => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:1", name: "Jujutsu Kaisen", popularity: 1 }),
      result({ id: "tmdb:2", name: "Kaiju No. 8", popularity: 999 }),
    ], 10, query);
    expect(ranked[0].name).toBe("Jujutsu Kaisen");
  });

  it("puts the franchise work before sequels and derivatives", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:1", name: "Jujutsu Kaisen", popularity: 10 }),
      result({ id: "tmdb:2", name: "Jujutsu Kaisen 0", popularity: 500 }),
      result({ id: "tmdb:3", name: "If Saitama Was in Jujutsu Kaisen", popularity: 900 }),
    ], 10, "jujutsu");
    expect(ranked[0].name).toBe("Jujutsu Kaisen");
  });

  it("uses aliases and accents for exact matching", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:1", name: "Amelie", aliases: ["Amélie"], popularity: 1 }),
      result({ id: "tmdb:2", name: "Popular unrelated", popularity: 999 }),
    ], 10, "amélie");
    expect(ranked[0].name).toBe("Amelie");
    expect(ranked[0].relevanceTier).toBe(6);
  });

  it("deduplicates a TMDB result hydrated from Cinemeta and preserves provenance", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:95479", type: "series", name: "Jujutsu Kaisen", canonicalKey: "series:tmdb:95479", sourceName: "TMDB" }),
      result({ id: "tt1234567", type: "series", name: "Jujutsu Kaisen", canonicalKey: "series:tmdb:95479", source: "cinemeta", sourceName: "Cinemeta" }),
    ], 10, "jujutsu kaisen");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].sourceName).toContain("TMDB");
    expect(ranked[0].sourceName).toContain("Cinemeta");
  });

  it("deduplicates TMDB and addon results through a shared IMDb identity", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:95479", type: "series", name: "Jujutsu Kaisen", externalIds: { tmdb: "95479", imdb: "tt1234567" } }),
      result({ id: "tt1234567", type: "series", name: "Jujutsu Kaisen", source: "addon", sourceName: "Addon", externalIds: { imdb: "tt1234567" } }),
    ], 10, "jujutsu kaisen");
    expect(ranked).toHaveLength(1);
    expect(ranked[0].sourceName).toContain("Addon");
  });

  it("keeps semantic discovery below textual title matches", () => {
    const ranked = mergeSearchResults([
      result({ id: "tmdb:1", name: "Anime Action", source: "tmdb", popularity: 1 }),
      result({ id: "tmdb:2", name: "Popular Drama", source: "semantic", popularity: 999 }),
    ], 10, "anime action");
    expect(ranked[0].name).toBe("Anime Action");
    expect(ranked[1].relevanceTier).toBe(1);
  });

  it("detects semantic intent without converting it into a title correction", () => {
    expect(parseSemanticSearchIntent("anime de accion de 2020").active).toBe(true);
  });
});

describe("hybrid retrieval", () => {
  beforeEach(() => {
    clearSearchCache();
    tmdbFetchMock.mockReset();
    vi.restoreAllMocks();
    tmdbFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/find/")) {
        return {
          tv_results: [{
            id: 95479,
            name: "Jujutsu Kaisen",
            original_name: "Jujutsu Kaisen",
            first_air_date: "2020-10-03",
            popularity: 50,
            vote_count: 1000,
          }],
          movie_results: [],
        };
      }
      return { results: [] };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("v3-cinemeta.strem.io/catalog/series")) {
        return new Response(JSON.stringify({ metas: [{ id: "tt1234567", type: "series", name: "Jujutsu Kaisen", releaseInfo: "2020" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ metas: [] }), { status: 200 });
    }));
  });

  it("recovers the canonical title from a one-character typo", async () => {
    const snapshots: string[] = [];
    const response = await searchMediaResponse({
      query: "jujutsu kaisenk",
      mode: "full",
      addons: [],
      limit: 80,
      onSnapshot: snapshot => snapshots.push(snapshot.effectiveQuery),
    });
    expect(response.correction?.correctedQuery).toBe("Jujutsu Kaisen");
    expect(response.results[0]?.name).toBe("Jujutsu Kaisen");
    expect(response.effectiveQuery).toBe("Jujutsu Kaisen");
    expect(snapshots).toContain("Jujutsu Kaisen");
  });

  it("rehydrates Cinemeta candidates by title, type, and year when IMDb is absent", async () => {
    tmdbFetchMock.mockImplementation(async (path: string) => {
      if (path === "/search/tv") {
        return {
          results: [{
            id: 95479,
            name: "Jujutsu Kaisen",
            first_air_date: "2020-10-03",
            popularity: 50,
            vote_count: 1000,
          }],
        };
      }
      return { results: [] };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("catalog/series")) {
        return new Response(JSON.stringify({ metas: [{ id: "kitsu:95479", type: "series", name: "Jujutsu Kaisen", releaseInfo: "2020" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ metas: [] }), { status: 200 });
    }));
    const response = await searchMediaResponse({ query: "jujutsu kaisenk", mode: "suggestions", addons: [] });
    expect(response.results[0]?.id).toBe("tmdb:95479");
  });

  it("can explicitly disable automatic correction", async () => {
    const response = await searchMediaResponse({
      query: "jujutsu kaisenk",
      mode: "full",
      addons: [],
      allowCorrection: false,
    });
    expect(response.correction).toBeUndefined();
    expect(response.effectiveQuery).toBe("jujutsu kaisenk");
  });

  it("reuses the response cache for the same request signature", async () => {
    await searchMediaResponse({ query: "jujutsu kaisenk", mode: "full", addons: [] });
    const callsAfterFirstRequest = tmdbFetchMock.mock.calls.length;
    await searchMediaResponse({ query: "jujutsu kaisenk", mode: "full", addons: [] });
    expect(tmdbFetchMock.mock.calls.length).toBe(callsAfterFirstRequest);
  });

  it("rejects an already-cancelled search before starting providers", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchMediaResponse({
      query: "jujutsu kaisen",
      mode: "full",
      addons: [],
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps TMDB results when Cinemeta fails", async () => {
    tmdbFetchMock.mockImplementation(async (path: string) => {
      if (path === "/search/multi") {
        return { results: [{ id: 95479, media_type: "tv", name: "Jujutsu Kaisen", first_air_date: "2020-10-03" }] };
      }
      return { results: [] };
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("v3-cinemeta.strem.io")) throw new Error("Cinemeta down");
      return new Response(JSON.stringify({ metas: [] }), { status: 200 });
    }));
    const response = await searchMediaResponse({ query: "jujutsu kaisen", mode: "suggestions", addons: [] });
    expect(response.results[0]?.name).toBe("Jujutsu Kaisen");
    expect(response.providerStatus.tmdb.state).toBe("success");
  });
});
