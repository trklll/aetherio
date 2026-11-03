import { afterEach, expect, it, vi } from "vitest";
import { fetchMeta, parseTextDate } from "./stremioSports.ts";

afterEach(() => vi.unstubAllGlobals());
it("fetches meta with the exact configured base and encoded sport id", async () => {
  const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ meta: { id: "streamed:a/b", name: "A vs B" } })));
  vi.stubGlobal("fetch", fetcher);
  expect(await fetchMeta("https://sports.highfly.to/config", "sport", "streamed:a/b")).toMatchObject({ name: "A vs B" });
  expect(fetcher.mock.calls[0][0]).toBe("https://sports.highfly.to/config/meta/sport/streamed%3Aa%2Fb.json");
});
it("ignores a detail response belonging to another event", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ meta: { id: "other" } })));
  expect(await fetchMeta("https://sports.highfly.to/config", "sport", "streamed:a")).toBeNull();
});
it("parses English UTC month names without accepting overflow dates", () => {
  expect(parseTextDate("31 Jan 2027 - 02:30 UTC")).toBe("2027-01-31T02:30:00.000Z");
  expect(parseTextDate("31 Aug 2027 - 02:30 UTC")).toBe("2027-08-31T02:30:00.000Z");
  expect(parseTextDate("31 Dec 2027 - 02:30 UTC")).toBe("2027-12-31T02:30:00.000Z");
  expect(parseTextDate("31 Feb 2027 - 02:30 UTC")).toBeNull();
  expect(parseTextDate("31 Oct 2027 - 25:30 UTC")).toBeNull();
});
