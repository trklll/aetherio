import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../runtime/platform.ts", () => ({
  invokeCommand: vi.fn(),
  isTauriRuntime: vi.fn(() => true),
}));

vi.mock("../config/apiKeys.ts", () => ({
  tmdbFetch: vi.fn(async () => ({ results: [] })),
}));

import { invokeCommand } from "../runtime/platform.ts";
import { tmdbFetch } from "../config/apiKeys.ts";
import {
  fetchYouTubeClip,
  normalizeYouTubeText,
  rankYouTubeCandidates,
} from "./youtubeClips.ts";

const invokeMock = vi.mocked(invokeCommand);
const tmdbMock = vi.mocked(tmdbFetch);
const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

function result(videoId: string, title: string, duration = 90) {
  return { videoId, title, duration, uploader: "Netflix", uploaderId: "@NetflixLATAM" };
}

describe("youtube hero search ranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
  });

  it("normalizes accents and punctuation while requiring a contiguous title", () => {
    expect(normalizeYouTubeText("Tráiler: Pokémon — La película!")).toBe("trailer pokemon la pelicula");

    const ranked = rankYouTubeCandidates([
      result("good", "Pokémon: La película - escena oficial"),
      result("scattered", "Pokémon y la gran película de aventuras"),
    ], ["Pokémon: La película"], "primary", 2025);

    expect(ranked.map(candidate => candidate.videoId)).toEqual(["good"]);
  });

  it("rejects trailer/editorial content in the primary phase and accepts it in the trailer phase", () => {
    const candidates = [
      result("trailer", "Dune - tráiler oficial"),
      result("review", "Dune review y análisis"),
      result("clip", "Dune - official clip"),
    ];

    expect(rankYouTubeCandidates(candidates, ["Dune"], "primary").map(item => item.videoId)).toEqual(["clip"]);
    expect(rankYouTubeCandidates(candidates, ["Dune"], "trailer").map(item => item.videoId)).toEqual(["trailer"]);
  });

  it("uses aliases only when they match and rejects ambiguous short titles without context", () => {
    expect(rankYouTubeCandidates([
      result("wrong", "It was a wonderful day"),
      result("right", "It - official movie clip 2017"),
    ], ["It"], "primary", 2017).map(item => item.videoId)).toEqual(["right"]);

    expect(rankYouTubeCandidates([
      result("alias", "Shingeki no Kyojin - escena"),
    ], ["Attack on Titan", "Shingeki no Kyojin"], "scene").map(item => item.videoId)).toEqual(["alias"]);
  });

  it("deduplicates IDs and rejects unusable durations", () => {
    const ranked = rankYouTubeCandidates([
      result("same", "Dune clip", 90),
      result("same", "Dune clip", 90),
      result("short", "Dune clip", 10),
      result("long", "Dune clip", 900),
    ], ["Dune"], "scene");
    expect(ranked.map(item => item.videoId)).toEqual(["same"]);
  });
});

describe("youtube hero search phases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    invokeMock.mockResolvedValue([]);
    tmdbMock.mockResolvedValue({ results: [] });
  });

  it("stops after a primary candidate and never searches trailers or scenes", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const query = String((args as { query?: string }).query ?? "");
      const channel = (args as { channel?: string | null }).channel;
      if (channel === "@NetflixLATAM" && query.includes("Dune") && !query.includes("trailer")) {
        return [result("primary", "Dune - official clip")];
      }
      return [];
    });

    const entry = await fetchYouTubeClip({ id: "tmdb:1", type: "movie", name: "Dune", year: 2021 });
    expect(entry?.videoId).toBe("primary");
    const queries = invokeMock.mock.calls.map(([, args]) => String((args as { query?: string }).query ?? ""));
    expect(queries.some(query => query.includes("trailer") || query.includes("scene") || query.includes("escena"))).toBe(false);
  });

  it("uses a trailer before falling back to scene searches", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const query = String((args as { query?: string }).query ?? "");
      if (query.includes("trailer") && query.includes("Dune")) return [result("trailer", "Dune - official trailer", 150)];
      return [];
    });

    const entry = await fetchYouTubeClip({ id: "tmdb:2", type: "movie", name: "Dune", year: 2021 });
    expect(entry?.videoId).toBe("trailer");
    const queries = invokeMock.mock.calls.map(([, args]) => String((args as { query?: string }).query ?? ""));
    expect(queries.some(query => query.includes("scene") || query.includes("escena"))).toBe(false);
  });

  it("uses an official TMDB trailer when selected channels have none", async () => {
    tmdbMock.mockResolvedValue({
      results: [{ key: "tmdb-trailer", site: "YouTube", type: "Trailer", official: true }],
    });

    const entry = await fetchYouTubeClip({ id: "tmdb:5", type: "movie", name: "Dune", year: 2021 });
    expect(entry?.videoId).toBe("tmdb-trailer");
    expect(invokeMock.mock.calls.some(([, args]) => String((args as { query?: string }).query ?? "").includes("scene"))).toBe(false);
  });

  it("reaches global scenes only after official channels and TMDB have no result", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const query = String((args as { query?: string }).query ?? "");
      const channel = (args as { channel?: string | null }).channel;
      if (!channel && query.includes("scene") && query.includes("Dune")) return [result("global-scene", "Dune scene clip")];
      return [];
    });

    const entry = await fetchYouTubeClip({ id: "tmdb:3", type: "movie", name: "Dune", year: 2021 });
    expect(entry?.videoId).toBe("global-scene");
    expect(invokeMock.mock.calls.some(([, args]) => (args as { channel?: string | null }).channel == null)).toBe(true);
  });

  it("continues through a failed official channel", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const channel = (args as { channel?: string | null }).channel;
      const query = String((args as { query?: string }).query ?? "");
      if (channel === "@NetflixLATAM") throw new Error("channel unavailable");
      if (channel === "@HBOMaxLa" && query.includes("Dune") && !query.includes("trailer")) {
        return [result("hbo-primary", "Dune - official clip")];
      }
      return [];
    });

    const entry = await fetchYouTubeClip({ id: "tmdb:4", type: "movie", name: "Dune", year: 2021 });
    expect(entry?.videoId).toBe("hbo-primary");
  });

  it("deduplicates concurrent foreground and prefetch requests for the same item", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const query = String((args as { query?: string }).query ?? "");
      if (query.includes("Dune")) return [result("shared", "Dune - official clip")];
      return [];
    });

    const item = { id: "tmdb:6", type: "movie", name: "Dune", year: 2021 } as const;
    const first = fetchYouTubeClip(item, { priority: "background" });
    const second = fetchYouTubeClip(item);
    const [left, right] = await Promise.all([first, second]);
    expect(left?.videoId).toBe("shared");
    expect(right?.videoId).toBe("shared");
    expect(invokeMock).toHaveBeenCalledTimes(8);
  });

  it("limits yt-dlp waves to four processes while foreground work is queued", async () => {
    let active = 0;
    let maxActive = 0;
    invokeMock.mockImplementation(async (_command, args) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 8));
      active -= 1;
      const query = String((args as { query?: string }).query ?? "");
      const title = query.includes("Foreground") ? "Foreground" : "Background";
      return [result(`${title.toLowerCase()}-candidate`, `${title} - official clip`)];
    });

    const background = fetchYouTubeClip({ id: "tmdb:8", type: "movie", name: "Background", year: 2021 }, { priority: "background" });
    const foreground = fetchYouTubeClip({ id: "tmdb:9", type: "movie", name: "Foreground", year: 2022 });
    const [backgroundEntry, foregroundEntry] = await Promise.all([background, foreground]);

    expect(backgroundEntry?.videoId).toBe("background-candidate");
    expect(foregroundEntry?.videoId).toBe("foreground-candidate");
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("stores a negative result and avoids repeating an exhaustive miss", async () => {
    const item = { id: "tmdb:7", type: "movie", name: "No Such Movie", year: 1901 } as const;
    await fetchYouTubeClip(item);
    const callsAfterFirstSearch = invokeMock.mock.calls.length;
    expect(callsAfterFirstSearch).toBeGreaterThan(0);
    await fetchYouTubeClip(item);
    expect(invokeMock).toHaveBeenCalledTimes(callsAfterFirstSearch);
  });
});
