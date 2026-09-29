import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleJikanRequest } from "./jikan";

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://trkll.aetherio.workers.dev${path}`, init);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy Jikan", () => {
  it("ignores unrelated routes and rejects non-GET methods", async () => {
    await expect(handleJikanRequest(req("/api/tmdb/movie/1"))).resolves.toBeNull();
    await expect(handleJikanRequest(req("/api/jikan/top/anime", { method: "POST" })))
      .resolves.toMatchObject({ status: 405 });
  });

  it("forwards the route and valid query parameters", async () => {
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ data: [{ mal_id: 1 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleJikanRequest(req("/api/jikan/top/anime?filter=favorite&limit=25"));
    expect(response?.status).toBe(200);
    expect(requestedUrl).toBe(
      "https://api.jikan.moe/v4/top/anime?filter=favorite&limit=25",
    );
    await expect(response?.json()).resolves.toEqual({ data: [{ mal_id: 1 }] });
  });

  it("turns an upstream 504 into a controlled fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("timeout", { status: 504 })));

    const response = await handleJikanRequest(req("/api/jikan/recommendations/anime?limit=25"));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("X-Aetherio-Upstream-Error")).toBe("true");
    await expect(response?.json()).resolves.toEqual({ data: [] });
  });
});
