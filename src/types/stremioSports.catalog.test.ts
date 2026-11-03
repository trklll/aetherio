import { afterEach, expect, it, vi } from "vitest";
import { fetchCatalogMetas } from "./stremioSports.ts";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

it("encodes multiple catalog extras in one Stremio path segment, not separate routes", async () => {
  const request = vi.fn(async (_url: string) => json({ metas: [{ id: "replay" }] }));
  vi.stubGlobal("fetch", request);
  await fetchCatalogMetas("https://sports.test", "tv", "nuvio_sports_catalog", { genre: "Formula 1 & MotoGP", skip: "100" });
  const url = new URL(request.mock.calls[0][0]);
  expect(url.pathname).toBe("/catalog/tv/nuvio_sports_catalog/genre=Formula%201%20%26%20MotoGP&skip=100.json");
  const extras = new URLSearchParams(url.pathname.split("/").pop()!.replace(/\.json$/, ""));
  expect(extras.get("genre")).toBe("Formula 1 & MotoGP");
  expect(extras.get("skip")).toBe("100");
});

it("waits briefly for a cold local schedule instead of caching the first empty response", async () => {
  vi.useFakeTimers();
  const meta = { id: "fixture", name: "A vs B" };
  const request = vi.fn()
    .mockResolvedValueOnce(json({ metas: [] }))
    .mockResolvedValueOnce(json({ sync: { state: "running", lastCompletedAt: null } }))
    .mockResolvedValueOnce(json({ metas: [meta] }));
  vi.stubGlobal("fetch", request);
  const pending = fetchCatalogMetas("http://127.0.0.1:7310/config", "tv", "nuvio_sports_upcoming");
  await vi.advanceTimersByTimeAsync(1500);
  expect(await pending).toEqual([meta]);
  expect(request).toHaveBeenCalledTimes(3);
});

it("does not retry legitimately empty or remote catalogs", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockImplementation((url: string) => Promise.resolve(json(url.includes("provider-health")
    ? { sync: { state: "complete" } } : { metas: [] })));
  vi.stubGlobal("fetch", request);
  expect(await fetchCatalogMetas("https://sports.test", "tv", "nuvio_sports_live")).toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(await fetchCatalogMetas("http://127.0.0.1:7310", "tv", "nuvio_sports_live")).toEqual([]);
  expect(request).toHaveBeenCalledTimes(3);
});
