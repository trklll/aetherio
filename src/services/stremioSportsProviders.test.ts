import { afterEach, expect, it, vi } from "vitest";
import { fetchCatalogMetas, fetchManifest, fetchStreams, probeLiveSource } from "../types/stremioSports.ts";
import { getSportsPreferencesStorageKey } from "../data/sports/preferences.ts";
import { getLiveSportsProvider } from "./liveSportsService.ts";
import { buildCncVerseTvIptvProvider, probeStremioSportsProvider } from "./stremioSportsProviders.ts";

vi.mock("../types/stremioSports.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../types/stremioSports.ts")>(),
  fetchCatalogMetas: vi.fn(),
  fetchManifest: vi.fn(),
  fetchStreams: vi.fn(),
  probeLiveSource: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

it("loads football and MMA agenda lanes together and sorts before applying the cap", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  let finishFootball!: (value: never[]) => void;
  const mma = { id: "ufc", name: "UFC Main Card", genres: ["MMA"], released: "2099-01-01T18:00:00Z" };
  vi.mocked(fetchCatalogMetas).mockImplementation((_base, _type, _catalog, extras) => extras?.genre === "football"
    ? new Promise(resolve => { finishFootball = resolve; })
    : Promise.resolve([mma]));
  const pending = getLiveSportsProvider("nuvio-sports")!.fetchUpcoming!();
  try {
    await vi.waitFor(() => expect(fetchCatalogMetas).toHaveBeenCalledTimes(2));
  } finally {
    finishFootball([]);
  }
  expect((await pending).map(event => event.id)).toContain("nuvio:ufc");
});

it("displays Sports while keeping upstream protocol and provider identifiers", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.mocked(fetchManifest).mockResolvedValueOnce({ id: "community.nuvio.live-sports", name: "🏆 Nuvio Live Sports", version: "3.1.3" });
  expect(getLiveSportsProvider("nuvio-sports")?.label).toBe("Sports");
  expect(await probeStremioSportsProvider("nuvio")).toMatchObject({ name: "Sports", version: "3.1.3", ok: true });
});

it("prioritizes followed matches and publishes each verified addon event before slower candidates finish", async () => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  values.set(getSportsPreferencesStorageKey(), JSON.stringify({
    onboarding: "completed", legacyTeamNames: ["Liverpool"], view: "explorar", scope: "todos",
  }));
  values.set("aetherio-sports-legacy-teams-migrated", "1");
  const metas = [
    { id: "other", name: "Arsenal vs Chelsea", genres: ["Football"], cast: ["Arsenal", "Chelsea"], releaseInfo: "LIVE", released: new Date(Date.now() - 5 * 60_000).toISOString() },
    { id: "followed", name: "Manchester City vs Liverpool", genres: ["Football"], cast: ["Manchester City", "Liverpool"], releaseInfo: "LIVE", released: new Date(Date.now() - 5 * 60_000).toISOString() },
  ];
  vi.mocked(fetchCatalogMetas).mockResolvedValue(metas);
  let finishOther!: (streams: { name: string; url: string }[]) => void;
  vi.mocked(fetchStreams).mockImplementation((_base, _type, id) => id === "other"
    ? new Promise(resolve => { finishOther = resolve; })
    : Promise.resolve([{ name: "Nuvio", url: "https://cdn.example/followed.m3u8" }]));
  vi.mocked(probeLiveSource).mockResolvedValue("live");
  const progress: { id: string; sources: unknown[] }[][] = [];
  const provider = getLiveSportsProvider("nuvio-sports")!;
  let completed = false;
  const pending = provider.fetchEvents(events => {
    progress.push(events.map(event => ({ id: event.id, sources: event.sources })));
  }).then(events => { completed = true; return events; });

  try {
    await vi.waitFor(() => expect(fetchStreams).toHaveBeenCalledTimes(2));
    expect(fetchStreams.mock.calls[0]?.[2]).toBe("followed");
    await vi.waitFor(() => expect(progress.some(events => events.some(event => event.id === "nuvio:followed" && event.sources.length > 0))).toBe(true));
    expect(completed).toBe(false);
  } finally {
    finishOther?.([{ name: "Nuvio", url: "https://cdn.example/other.m3u8" }]);
    await pending;
  }
});

it("does not request streams for unrelated events in the followed-only view", async () => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  values.set(getSportsPreferencesStorageKey(), JSON.stringify({
    onboarding: "completed", legacyTeamNames: ["Liverpool"], view: "para-ti", scope: "todos",
  }));
  values.set("aetherio-sports-legacy-teams-migrated", "1");
  vi.mocked(fetchCatalogMetas).mockResolvedValue([
    { id: "other", name: "Arsenal vs Chelsea", genres: ["Football"], cast: ["Arsenal", "Chelsea"], releaseInfo: "LIVE", released: new Date(Date.now() - 5 * 60_000).toISOString() },
    { id: "followed", name: "Manchester City vs Liverpool", genres: ["Football"], cast: ["Manchester City", "Liverpool"], releaseInfo: "LIVE", released: new Date(Date.now() - 5 * 60_000).toISOString() },
  ]);
  vi.mocked(fetchStreams).mockResolvedValue([{ name: "Nuvio", url: "https://cdn.example/followed.m3u8" }]);
  vi.mocked(probeLiveSource).mockResolvedValue("live");

  const events = await getLiveSportsProvider("nuvio-sports")!.fetchEvents();

  expect(fetchStreams.mock.calls.map(call => call[2])).toEqual(["followed"]);
  expect(events.map(event => event.id)).toEqual(["nuvio:followed"]);
});

it("returns every live stream supplied by an addon, not only the first two", async () => {
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  vi.mocked(fetchCatalogMetas).mockResolvedValue([{
    id: "many-streams", name: "Real Madrid vs Barcelona", genres: ["Football"],
    cast: ["Real Madrid", "Barcelona"], releaseInfo: "LIVE", released: new Date(Date.now() - 60_000).toISOString(),
  }]);
  vi.mocked(fetchStreams).mockResolvedValue(["one", "two", "three"].map(name => ({
    name, url: `https://cdn.example/${name}.m3u8`,
  })));
  vi.mocked(probeLiveSource).mockResolvedValue("live");

  const events = await getLiveSportsProvider("nuvio-sports")!.fetchEvents();

  expect(events[0].sources.map(source => source.url)).toEqual([
    "https://cdn.example/one.m3u8", "https://cdn.example/two.m3u8", "https://cdn.example/three.m3u8",
  ]);
});

it("prioritizes and publishes a followed StremVerse match before other stream checks finish", async () => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  values.set(getSportsPreferencesStorageKey(), JSON.stringify({
    onboarding: "completed", legacyTeamNames: ["Liverpool"], view: "explorar", scope: "todos",
  }));
  values.set("aetherio-sports-legacy-teams-migrated", "1");
  vi.mocked(fetchCatalogMetas).mockImplementation(async (_base, _type, _catalog, extras) => extras?.genre === "Football"
    ? [{ id: "other", name: "Arsenal vs Chelsea" }, { id: "followed", name: "Manchester City vs Liverpool" }]
    : []);
  let finishOther!: (streams: { name: string; url: string }[]) => void;
  vi.mocked(fetchStreams).mockImplementation((_base, _type, id) => id === "other"
    ? new Promise(resolve => { finishOther = resolve; })
    : Promise.resolve([{ name: "StremVerse", url: "https://cdn.example/followed.m3u8" }]));
  vi.mocked(probeLiveSource).mockResolvedValue("live");
  const progress: { id: string; sources: unknown[] }[][] = [];
  let completed = false;
  const pending = getLiveSportsProvider("stremverse")!.fetchEvents(events => {
    progress.push(events.map(event => ({ id: event.id, sources: event.sources })));
  }).then(events => { completed = true; return events; });

  try {
    await vi.waitFor(() => expect(fetchStreams).toHaveBeenCalledTimes(2));
    expect(fetchStreams.mock.calls[0]?.[2]).toBe("followed");
    await vi.waitFor(() => expect(progress.some(events => events.some(event => event.id === "stremverse:followed" && event.sources.length > 0))).toBe(true));
    expect(completed).toBe(false);
  } finally {
    finishOther?.([{ name: "StremVerse", url: "https://cdn.example/other.m3u8" }]);
    await pending;
  }
});

it("loads verified sports IPTV channels from CNCVerse TV, never VOD catalogs", async () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const addon = { id: "com.cncverse.stremiobridge.p1hym8x62am7m", url: "https://cncverse.example/u/profile/manifest.json", enabled: true };
  const channelPayload = {
    channelId: "espn.es",
    title: "ESPN Deportes (1080p)",
    groupTitle: "Sports",
    logo: "https://img.example.com/espn.png",
    referer: "https://watch.example.com/",
    userAgent: "CNCVerse test",
  };
  const channelId = `cnc:${btoa(`cnc_IPTVOrgall_tv::${JSON.stringify(channelPayload)}`)}`;
  const catalog = vi.fn().mockResolvedValue([
    { id: channelId, name: "ESPN Deportes (1080p)", type: "tv", genres: ["Soccer"] },
  ]);
  const streams = vi.fn().mockResolvedValue([
    { name: "ESPN Deportes", url: "https://cdn.example.com/live.m3u8", resolution: "1080p" },
    { name: "ESPN Deportes respaldo", url: "https://cdn.example.com/backup.m3u8", resolution: "720p" },
  ]);
  const probe = vi.fn().mockResolvedValue("live");
  const provider = buildCncVerseTvIptvProvider({
    addon: () => addon,
    manifest: async () => ({
      id: addon.id,
      types: ["movie", "series", "other", "tv"],
      catalogs: [
        { type: "movie", id: "cinema", name: "Movies", extra: [{ name: "genre", options: ["Sports"] }] },
        { type: "tv", id: "cnc_IPTVOrgall_tv", name: "IPTV-Org (all)", extra: [{ name: "genre", options: ["Sports", "Movies"] }] },
        { type: "tv", id: "cnc_unrelated_tv", name: "Live Events", extra: [{ name: "genre", options: ["Sports"] }] },
      ],
    }),
    catalog,
    streams,
    probe,
    now: () => now,
  });

  const channels = await provider.fetchChannels!();

  expect(catalog).toHaveBeenCalledTimes(1);
  expect(catalog).toHaveBeenCalledWith("https://cncverse.example/u/profile", "tv", "cnc_IPTVOrgall_tv", { genre: "Sports" });
  expect(streams).toHaveBeenCalledWith("https://cncverse.example/u/profile", "tv", channelId);
  expect(probe).toHaveBeenCalledTimes(2);
  expect(probe).toHaveBeenCalledWith(expect.objectContaining({ headers: {
    Referer: "https://watch.example.com/",
    "User-Agent": "CNCVerse test",
  } }));
  expect(channels).toHaveLength(1);
  expect(channels[0]).toMatchObject({
    name: "ESPN Deportes",
    category: "Deportes",
    sports: ["futbol"],
    sources: [
      expect.objectContaining({ origin: "iptv", providerId: "cncverse-tv", channelName: "ESPN Deportes", verifiedAt: now,
        url: "https://cdn.example.com/live.m3u8", headers: { Referer: "https://watch.example.com/", "User-Agent": "CNCVerse test" } }),
      expect.objectContaining({ origin: "iptv", providerId: "cncverse-tv", channelName: "ESPN Deportes", verifiedAt: now,
        url: "https://cdn.example.com/backup.m3u8" }),
    ],
  });
  expect(probe).toHaveBeenCalledTimes(2);
  expect(await provider.fetchEvents()).toEqual([]);
});

it("does not query CNCVerse TV when the Hub addon is disabled or a channel has no live source", async () => {
  const manifest = vi.fn().mockResolvedValue({
    id: "com.cncverse.stremiobridge.p1hym8x62am7m",
    catalogs: [{ type: "tv", id: "cnc_IPTVOrgall_tv", extra: [{ name: "genre", options: ["Sports"] }] }],
  });
  const disabled = buildCncVerseTvIptvProvider({
    addon: () => ({ id: "com.cncverse.stremiobridge.p1hym8x62am7m", url: "https://cncverse.example/u/profile/manifest.json", enabled: false }),
    manifest,
  });
  await expect(disabled.fetchChannels!()).resolves.toEqual([]);
  expect(manifest).not.toHaveBeenCalled();

  const unavailable = buildCncVerseTvIptvProvider({
    addon: () => ({ id: "com.cncverse.stremiobridge.p1hym8x62am7m", url: "https://cncverse.example/u/profile/manifest.json", enabled: true }),
    manifest,
    catalog: async () => [{ id: "cnc:dead-channel", name: "Canal Deportes", type: "tv", genres: ["Soccer"] }],
    streams: async () => [{ name: "Canal", url: "https://cdn.example.com/dead.m3u8" }],
    probe: async () => "dead",
    now: () => Date.parse("2026-11-06T12:00:00Z"),
  });
  await expect(unavailable.fetchChannels!()).resolves.toEqual([]);
});
