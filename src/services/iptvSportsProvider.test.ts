import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIptvSportsProvider } from "./iptvSportsProvider.ts";
import { defaultSportsIptvLists, getSportsIptvLists, normalizeSportsIptvLists, saveSportsIptvLists, type SportsIptvList } from "./iptvSportsConfig.ts";
import { getLiveSportsConfig, readCachedLiveSnapshot, registerLiveSportsProvider } from "./liveSportsService.ts";

const NOW = Date.parse("2026-10-30T19:30:00Z");
const m3u = '#EXTM3U x-tvg-url="https://guide.example.com/guide.xml"\n#EXTINF:-1 tvg-id="Football.es" group-title="Fútbol",Football TV\nhttps://cdn.example.com/live.m3u8';
const availabilityM3u = '#EXTM3U\n#EXTINF:-1 tvg-id="canal-es.es" tvg-language="Spanish" group-title="Fútbol",Canal español\nhttps://cdn.example.com/dead.m3u8\n#EXTINF:-1 tvg-id="canal-es.es" tvg-language="Spanish" group-title="Fútbol",Canal español\nhttps://cdn.example.com/working.m3u8\n#EXTINF:-1 tvg-id="canal-en.us" tvg-language="English" group-title="Football",English channel\nhttps://cdn.example.com/offline.m3u8';
const xml = (extra = "<live />") => `<tv><programme channel="Football.es" start="20261030190000 +0000" stop="20261030210000 +0000"><title>Real Madrid vs Barcelona</title><category>Fútbol</category>${extra}</programme></tv>`;
const list: SportsIptvList = { id: "test", name: "Mi lista", content: m3u, enabled: true, epgUrls: [] };
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());

describe("IPTV provider", () => {
  it("shares downloads between events/channels, verifies real media and refreshes at programme boundaries", async () => {
    let now = NOW;
    const text = vi.fn(async () => xml());
    const probe = vi.fn(async () => true);
    const provider = buildIptvSportsProvider({ lists: () => [list], text, probe, now: () => now });
    const [channels, events] = await Promise.all([provider.fetchChannels!(), provider.fetchEvents()]);
    expect(text).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(channels[0].sources[0].verifiedAt).toBe(NOW);
    expect(events[0]).toMatchObject({ title: "Real Madrid vs Barcelona", status: "live", sport: "futbol" });
    await provider.fetchChannels!();
    expect(probe).toHaveBeenCalledTimes(1);
    now = Date.parse("2026-10-30T21:01:00Z");
    expect(await provider.fetchEvents()).toEqual([]);
  });
  it("does not turn an unmarked programme, replay or dead stream into a live match", async () => {
    for (const [guide, online] of [[xml(""), true], [xml("<live/><previously-shown/>"), true], [xml(), false]] as const) {
      const provider = buildIptvSportsProvider({ lists: () => [list], text: async () => guide, probe: async () => online, now: () => NOW });
      expect(await provider.fetchEvents()).toEqual([]);
      expect(await provider.fetchChannels!()).toHaveLength(online ? 1 : 0);
    }
  });
  it("verifies a numbered MMA card even when the guide does not list individual opponents", async () => {
    const content = m3u.replace(/Football\.es/g, "Fight.es").replace(/Fútbol/g, "MMA");
    const guide = xml().replace(/Football\.es/g, "Fight.es").replace("Real Madrid vs Barcelona", "UFC 320: Main Card").replace("Fútbol", "MMA");
    const probe = vi.fn(async () => true);
    const provider = buildIptvSportsProvider({ lists: () => [{ ...list, content }], text: async () => guide, probe, now: () => NOW });
    const channels = await provider.fetchChannels!();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(channels[0].sources[0].verifiedAt).toBe(NOW);
    expect((await provider.fetchEvents())[0]).toMatchObject({ title: "UFC 320: Main Card", sport: "mma", status: "live" });
  });
  it("shows only channels with a currently verified source, including a working fallback, even without a guide", async () => {
    const probe = vi.fn(async (source: { url: string }) => source.url.endsWith("working.m3u8"));
    const provider = buildIptvSportsProvider({ lists: () => [{ ...list, content: availabilityM3u }], text: async () => { throw new Error("no guide"); }, probe, now: () => NOW });

    const channels = await provider.fetchChannels!();

    expect(channels.map(channel => channel.name)).toEqual(["Canal español"]);
    expect(channels[0].sources).toHaveLength(1);
    expect(channels[0].sources[0]).toMatchObject({ url: "https://cdn.example.com/working.m3u8", verifiedAt: NOW });
    expect(probe.mock.calls.map(([source]) => source.url)).toEqual(expect.arrayContaining([
      "https://cdn.example.com/dead.m3u8",
      "https://cdn.example.com/working.m3u8",
      "https://cdn.example.com/offline.m3u8",
    ]));
    expect(probe).toHaveBeenCalledTimes(3);
  });
  it("rechecks channels after the short availability cache expires", async () => {
    let now = NOW;
    let available = true;
    const probe = vi.fn(async () => available);
    const provider = buildIptvSportsProvider({ lists: () => [list], text: async () => { throw new Error("no guide"); }, probe, now: () => now });

    expect(await provider.fetchChannels!()).toHaveLength(1);
    now += 60_000;
    available = false;
    expect(await provider.fetchChannels!()).toEqual([]);
    expect(probe).toHaveBeenCalledTimes(2);
  });
  it("keeps channels without a working guide and isolates a broken list", async () => {
    const provider = buildIptvSportsProvider({ lists: () => [list, { ...list, id: "broken", content: undefined, url: "https://broken.example.com/list" }],
      text: async () => { throw new Error("offline"); }, probe: async () => true, now: () => NOW });
    expect(await provider.fetchEvents()).toEqual([]);
    expect((await provider.fetchChannels!())[0]).toMatchObject({ currentProgramme: undefined, sources: [{ verifiedAt: NOW }] });
  });
  it("respects explicit disables, and configuration changes invalidate the shared catalog", async () => {
    let lists = [list];
    const provider = buildIptvSportsProvider({ lists: () => lists, text: async () => xml(), probe: async () => true, now: () => NOW });
    expect(await provider.fetchChannels!()).toHaveLength(1);
    lists = [{ ...list, enabled: false }];
    expect(await provider.fetchChannels!()).toEqual([]);
    expect(await provider.fetchEvents()).toEqual([]);
  });
});

describe("IPTV settings and migration", () => {
  it("provides public defaults and persists an empty list without silently re-enabling defaults", () => {
    expect(getSportsIptvLists()).toEqual(defaultSportsIptvLists());
    saveSportsIptvLists([]);
    expect(getSportsIptvLists()).toEqual([]);
  });
  it("rejects credentials, local URLs, duplicates and oversized imported content", () => {
    expect(normalizeSportsIptvLists([{ ...list, content: undefined, url: "http://127.0.0.1/list.m3u" }])).toEqual([]);
    expect(normalizeSportsIptvLists([list, list])).toHaveLength(1);
    expect(() => saveSportsIptvLists([list, list])).toThrow();
    expect(normalizeSportsIptvLists([{ ...list, content: "#EXTM3U" + " ".repeat(2 * 1024 * 1024) }])).toEqual([]);
  });
  it("enables IPTV once for existing installations, preserving later explicit disables", () => {
    registerLiveSportsProvider(buildIptvSportsProvider({ lists: () => [] }));
    store.set("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], nativeProvidersVersion: 1 }));
    expect(getLiveSportsConfig().enabledProviders).toContain("iptv-sports");
    store.set("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], nativeProvidersVersion: 1, iptvProvidersVersion: 1 }));
    expect(getLiveSportsConfig().enabledProviders).not.toContain("iptv-sports");
  });
  it("does not expose another profile's imported channels or IPTV sources from the shared live cache", () => {
    store.set("aetherio-live-sports-snapshot", JSON.stringify({ events: [{ id: "game", sources: [{ id: "iptv", origin: "iptv", url: "https://cdn.example.com/private.m3u8" }, { id: "addon", url: "https://addon.example.com/a" }] }], channels: [{ id: "secret", sources: [{ origin: "iptv" }] }], iptvProfileKey: "different-profile", fetchedAt: NOW }));
    expect(readCachedLiveSnapshot()?.channels).toEqual([]);
    expect(readCachedLiveSnapshot()?.events[0].sources.map(source => source.id)).toEqual(["addon"]);
  });
});
