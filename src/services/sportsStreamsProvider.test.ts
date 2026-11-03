import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSportsStreamsProvider as buildProvider } from "./sportsStreamsProvider.ts";
import type { StremioMeta } from "../types/stremioSports.ts";
import type { LiveSource } from "../types/liveSports.ts";

const NOW = Date.parse("2026-10-30T23:00:00Z");
const buildSportsStreamsProvider = (dependencies: Parameters<typeof buildProvider>[0]) => buildProvider({ meta: async () => null, ...dependencies });
const meta = (id: string, patch: Partial<StremioMeta> = {}): StremioMeta => ({ id, name: "Real Madrid vs Barcelona", genres: ["Football", "La Liga"], releaseInfo: "LIVE", ...patch });
afterEach(() => vi.unstubAllGlobals());

describe("Highfly Sports adapter", () => {
  it("does not turn a day-only meta into an invented midnight kickoff", async () => {
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", manifest: async () => ({ catalogs: [{ type: "sport", id: "sports_live" }] }),
      catalog: async () => [meta("streamed:day", { name: "\u200b", releaseInfo: "31 Oct 2026" })],
      meta: async () => meta("streamed:day", { releaseInfo: "31 Oct 2026" }), now: () => NOW });
    expect((await provider.fetchUpcoming!())[0].startsAtPrecision).toBe("day");
  });

  it("hydrates invisible hideTitles entries from meta and preserves LIVE while recovering the true UTC kickoff", async () => {
    const details = vi.fn(async (_base: string, _type: string, id: string) => meta(id, { name: "Washington Wizards vs Charlotte Hornets", releaseInfo: "30 Oct 2026 · 23:00 UTC", genres: ["Basketball", "NBA"] }));
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", manifest: async () => ({ catalogs: [{ type: "sport", id: "sports_live" }] }),
      catalog: async () => [meta("streamed:hidden", { name: "\u200b", genres: ["Basketball", "NBA"] })], meta: details, streams: async () => [{ name: "English", url: "https://cdn.test/live.m3u8" }], probe: async () => "live", now: () => NOW });
    const events = await provider.fetchEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: "Washington Wizards vs Charlotte Hornets", startsAt: "2026-10-30T23:00:00.000Z", status: "live", home: { name: "Washington Wizards" }, away: { name: "Charlotte Hornets" } });
    expect(details).toHaveBeenCalledWith("https://sports.highfly.to/test", "sport", "streamed:hidden");
  });

  it("rejects an unsafe stream URL before invoking a media probe", async () => {
    const probe = vi.fn(async (_source: LiveSource) => "live" as const);
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", manifest: async () => ({ catalogs: [{ type: "sport", id: "sports_live" }] }), catalog: async () => [meta("streamed:a")], streams: async () => [{ name: "Spanish", url: "https://127.0.0.1/secret" }], probe, now: () => NOW });
    expect(await provider.fetchEvents()).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it("discovers every configured sports/league catalog, deduplicates matches and separates linear channels", async () => {
    const catalog = vi.fn(async (_base: string, _type: string, id: string) => id === "sports_live"
      ? [meta("streamed:football"), meta("leaf:tdp", { name: "Teledeporte" })]
      : id === "league_nba" ? [meta("streamed:nba", { name: "Lakers vs Celtics", genres: ["Basketball", "NBA"] })] : [meta("streamed:football")]);
    const streams = vi.fn(async () => [{ name: "Highfly", language: "Spanish", url: "https://cdn.example.com/live.m3u8" }]);
    const manifest = vi.fn(async () => ({ catalogs: [{ type: "sport", id: "sports_live" }, { type: "sport", id: "league_la-liga", name: "La Liga" }, { type: "sport", id: "league_nba", name: "NBA" }, { type: "movie", id: "unrelated" }] }));
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", catalog, manifest, streams, probe: async () => "live", now: () => NOW });
    const [events, channels] = await Promise.all([provider.fetchEvents(), provider.fetchChannels!()]);
    expect(events.map(event => event.id)).toEqual(["sportsstreams:streamed:football", "sportsstreams:streamed:nba"]);
    expect(events[1]).toMatchObject({ sport: "Basketball", league: "NBA", sources: [{ providerId: "sports-streams", language: "Spanish" }] });
    expect(channels.map(channel => channel.name)).toEqual(["Teledeporte"]);
    expect(catalog.mock.calls.map(call => call[2])).toEqual(["sports_live", "league_la-liga", "league_nba"]);
    expect(manifest).toHaveBeenCalledTimes(1);
    expect(streams).toHaveBeenCalledTimes(3);
  });

  it("tries Spanish commentary before the first two English streams and keeps verified alternatives", async () => {
    const probe = vi.fn(async (_source: LiveSource) => "live" as const);
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", manifest: async () => ({ catalogs: [{ type: "sport", id: "sports_live" }] }), catalog: async () => [meta("streamed:a")], now: () => NOW,
      streams: async () => [
        { name: "English 1", language: "English", url: "https://cdn.example.com/en1.m3u8" },
        { name: "English 2", language: "English", url: "https://cdn.example.com/en2.m3u8" },
        { name: "Highfly", title: "🇵🇪 Español · 1080p", url: "https://cdn.example.com/es.m3u8" },
      ], probe });
    const events = await provider.fetchEvents();
    expect(events[0].sources[0].url).toContain("/es.m3u8");
    expect(probe.mock.calls[0][0].url).toContain("/es.m3u8");
  });

  it("keeps future UTC schedules as absolute instants, omits dead matches and does not reuse UTC poster text", async () => {
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", manifest: async () => ({ catalogs: [{ type: "sport", id: "sports_live" }] }), now: () => NOW,
      catalog: async () => [meta("streamed:next", { releaseInfo: "31 Oct 2026 - 02:30 UTC", poster: "https://cdn.highfly.to/posters/event_UTC.webp", background: "https://cdn.highfly.to/posters/custom/event.webp" }), meta("streamed:dead")],
      streams: async () => [{ name: "Source", url: "https://cdn.example.com/dead.m3u8" }], probe: async () => "dead" });
    expect(await provider.fetchEvents()).toEqual([]);
    const upcoming = await provider.fetchUpcoming!();
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]).toMatchObject({ startsAt: "2026-10-31T02:30:00.000Z", status: "upcoming", sources: [], poster: "https://cdn.highfly.to/posters/custom/event.webp" });
  });

  it("isolates a broken catalog and a broken stream request", async () => {
    const provider = buildSportsStreamsProvider({ base: () => "https://sports.highfly.to/test", manifest: async () => ({ catalogs: [{ type: "sport", id: "sports_live" }, { type: "sport", id: "league_nba" }] }), now: () => NOW,
      catalog: async (_base, _type, id) => { if (id === "league_nba") throw new Error("offline"); return [meta("streamed:a"), meta("streamed:b")]; },
      streams: async (_base, _type, id) => { if (id.endsWith(":a")) throw new Error("offline"); return [{ name: "ES", url: "https://cdn.example.com/b.m3u8" }]; }, probe: async () => "live" });
    expect((await provider.fetchEvents()).map(event => event.id)).toEqual(["sportsstreams:streamed:b"]);
  });
});
