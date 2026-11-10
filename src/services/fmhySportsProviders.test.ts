import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFmhySportsProvider, mapSportsBiteEvents, mapStreamFreeEvents, resolveSportsBiteSource, resolveStreamFreeSource } from "./fmhySportsProviders.ts";

const { probe, invoke, nativeRuntime } = vi.hoisted(() => ({
  probe: vi.fn(), invoke: vi.fn(), nativeRuntime: vi.fn(() => false),
}));
vi.mock("../runtime/platform.ts", () => ({ isTauriRuntime: nativeRuntime, invokeCommand: invoke }));
vi.mock("./fmhyNativeProbe.ts", () => ({ probeFmhyNativeSource: probe }));

const now = Date.parse("2026-10-29T20:00:00Z");
const live = {
  slug: "real-barca", title: "Real Madrid vs. Barcelona", sport: "soccer", start: "2026-10-29T19:00:00Z", live: true,
  teams: { home: { name: "Real Madrid" }, away: { name: "Barcelona" } },
  streams: [{ manifest_url: "https://sportsbite.org/tlive-embed/embed/real-barca?v=high", format: "iframe", language: "Spanish", quality: "1080p" }],
};
const streamFree = {
  id: "real-barca", name: "Real Madrid vs Barcelona", stream_key: "real-barca", category: "soccer", league: "LaLiga",
  match_timestamp: (now - 3_600_000) / 1000, auto_created: true,
  team1: { name: "Real Madrid" }, team2: { name: "Barcelona" },
};

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function mockFetch(routes: Record<string, Response | (() => Response)>) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes[url];
    return typeof route === "function" ? route() : route?.clone() ?? new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => { vi.setSystemTime(now); probe.mockReset().mockResolvedValue(true); invoke.mockReset(); nativeRuntime.mockReturnValue(false); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("FMHY native catalog mapping", () => {
  it("maps SportsBite teams and UTC schedule without calling an embed a playable stream", () => {
    const [candidate] = mapSportsBiteEvents({ days: [{ events: [live] }] }, now);
    expect(candidate.event).toMatchObject({ title: "Real Madrid vs Barcelona", status: "live", startsAt: "2026-10-29T19:00:00.000Z", sources: [] });
    expect(candidate.players[0]).toMatchObject({ language: "Spanish", quality: "1080p" });
  });
  it("finished flags and stale dates win over a stale live flag", () => {
    expect(mapSportsBiteEvents({ days: [{ events: [{ ...live, is_finished: true }, { ...live, start: "2026-10-25T19:00:00Z" }, { ...live, live_status: { state: "ft" } }] }] }, now)).toEqual([]);
  });
  it("keeps future events informational, even when the upstream marks them live", () => {
    expect(mapSportsBiteEvents({ days: [{ events: [{ ...live, start: "2026-10-30T19:00:00Z" }] }] }, now)[0].event.status).toBe("upcoming");
  });
  it("does not invent start dates, participants or playable events from malformed input", () => {
    for (const value of [null, {}, { days: [null, { events: [null, {}, { ...live, start: "bad date" }] }] }]) {
      expect(mapSportsBiteEvents(value, now)).toEqual([]);
    }
    expect(mapStreamFreeEvents({ streams: { soccer: [null, {}, { ...streamFree, match_timestamp: "bad" }] } }, now)).toEqual([]);
  });
  it("maps StreamFree soccer and does not mislabel American football as soccer", () => {
    const [candidate] = mapStreamFreeEvents({ streams: { soccer: [streamFree] } }, now);
    expect(candidate.event).toMatchObject({ title: "Real Madrid vs Barcelona", league: "LaLiga", status: "live", sources: [] });
    expect(mapStreamFreeEvents({ streams: { football: [{ ...streamFree, category: "football" }] } }, now)[0].event.sport).toBe("futbol americano");
  });
  it("excludes 24/7 channels rather than presenting them as live matches", () => {
    expect(mapStreamFreeEvents({ streams: { racing: [{ ...streamFree, name: "Sky Sports F1", auto_created: false, team1: undefined, team2: undefined }] } }, now)).toEqual([]);
    expect(mapSportsBiteEvents({ days: [{ events: [{ ...live, always_live: 1 }] }] }, now)).toEqual([]);
  });
});

describe("native-only source resolution", () => {
  it("decodes only the public SportsBite source literal and verifies its HLS", async () => {
    const url = "https://sportsbite.org/tlive/real-barca?v=high";
    mockFetch({ "https://sportsbite.org/tlive-embed/embed/real-barca?v=high": new Response(`var source = window.atob("${btoa(url)}");`) });
    const [candidate] = mapSportsBiteEvents({ days: [{ events: [live] }] }, now);
    expect(await resolveSportsBiteSource(candidate.players[0])).toMatchObject({ url, language: "Spanish", quality: "1080p", headers: { Referer: "https://sportsbite.org/" } });
    expect(probe).toHaveBeenCalledOnce();
  });
  it("does not offer a source that fails native media validation", async () => {
    probe.mockResolvedValue(false);
    mockFetch({ "https://sportsbite.org/tlive-embed/embed/real-barca?v=high": new Response(`var source = atob("${btoa("https://sportsbite.org/tlive/real-barca")}");`) });
    const [candidate] = mapSportsBiteEvents({ days: [{ events: [live] }] }, now);
    expect(await resolveSportsBiteSource(candidate.players[0])).toBeNull();
  });
  it("rejects HTML without a static source, forged hosts, credentials and local URLs without executing scripts", async () => {
    const fetcher = mockFetch({});
    for (const url of ["http://sportsbite.org/tlive/a", "https://sportsbite.org.evil.test/tlive/a", "https://sportsbite.org@evil.test/tlive/a", "https://127.0.0.1/tlive/a", "file:///a"]) {
      expect(await resolveSportsBiteSource({ url })).toBeNull();
    }
    expect(fetcher).not.toHaveBeenCalled();
    mockFetch({ "https://sportsbite.org/lol-embed/embed/a": new Response("<script>throw Error('never execute me')</script>") });
    expect(await resolveSportsBiteSource({ url: "https://sportsbite.org/lol-embed/embed/a" })).toBeNull();
  });
  it("does not follow an encoded private URL or an arbitrary source path", async () => {
    for (const target of ["https://127.0.0.1/live/a", "https://evil.test/live/a", "https://sportsbite.org/admin", "https://sportsbite.org/tlive/a\r\nX-Injected: yes"]) {
      mockFetch({ "https://sportsbite.org/lol-embed/embed/a": new Response(`var source = atob("${btoa(target)}");`) });
      expect(await resolveSportsBiteSource({ url: "https://sportsbite.org/lol-embed/embed/a" })).toBeNull();
    }
  });
  it("rebuilds a fresh StreamFree HLS URL from public player metadata, not an iframe URL", async () => {
    const player = "https://strmfree.st/embed/soccer/real-barca1080p";
    mockFetch({
      "https://streamfree.top/get-stream-key/real-barca": json({ server_name: "cdn", is_external: false }),
      [player]: new Response(`const QUALITY = '1080p'; const _0x = ${JSON.stringify({ "1080p": { _t: "public-token", _n: "public-nonce", _e: now / 1000 + 300 } })};`),
    });
    const source = await resolveStreamFreeSource("real-barca", player);
    expect(source?.url).toBe(`https://strmfree.st/live-cdn/real-barca1080p/index.m3u8?_t=public-token&_e=${now / 1000 + 300}&_n=public-nonce`);
    expect(source?.headers?.Referer).toBe(player);
    expect(probe).toHaveBeenCalledOnce();
  });
  it("rejects expired player tokens, unknown servers and player redirects outside the audited hosts", async () => {
    const player = "https://strmfree.st/embed/soccer/real-barca1080p";
    for (const metadata of [{ server_name: "cdn", expired: true }, { server_name: "surprise", expired: false }]) {
      mockFetch({
        "https://streamfree.top/get-stream-key/real-barca": json(metadata),
        [player]: new Response(`const _0x = ${JSON.stringify({ "1080p": { _t: "token", _n: "nonce", _e: now / 1000 + (metadata.expired ? -1 : 300) } })};`),
      });
      expect(await resolveStreamFreeSource("real-barca", player)).toBeNull();
    }
    expect(await resolveStreamFreeSource("../admin", player)).toBeNull();
    expect(await resolveStreamFreeSource("real-barca", "https://strmfree.st.evil.test/embed/soccer/real-barca1080p")).toBeNull();
  });
});

describe("FMHY provider registration and HTTP isolation", () => {
  it("shares catalog requests between live and upcoming, isolates failed sites, and does not resolve future matches", async () => {
    const fetcher = mockFetch({
      "https://sportsbite.org/api/forestgump/matches": json({ days: [{ events: [{ ...live, start: "2026-10-30T19:00:00Z" }] }] }),
      "https://streamfree.top/streams": json({ streams: {} }, 503),
    });
    const provider = buildFmhySportsProvider();
    const [events, upcoming] = await Promise.all([provider.fetchEvents(), provider.fetchUpcoming!()]);
    expect(events).toEqual([]);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].sources).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(probe).not.toHaveBeenCalled();
  });
  it("returns a native live event, ignores unavailable StreamFree sources, and refreshes catalogs after the cache expires", async () => {
    const fetcher = mockFetch({
      "https://sportsbite.org/api/forestgump/matches": () => json({ days: [{ events: [live] }] }),
      "https://sportsbite.org/tlive-embed/embed/real-barca?v=high": new Response(`var source = atob("${btoa("https://sportsbite.org/tlive/real-barca")}");`),
      "https://streamfree.top/streams": () => json({ streams: { soccer: [streamFree] } }),
      "https://streamfree.top/api/v1/sources/real-barca": json({ sources: ["https://strmfree.st/embed/soccer/real-barca1080p"], live_sources: [] }),
    });
    const provider = buildFmhySportsProvider();
    expect((await provider.fetchEvents())[0].sources[0].url).toBe("https://sportsbite.org/tlive/real-barca");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("get-stream-key"))).toBe(false);
    vi.setSystemTime(now + 61_000);
    await provider.fetchUpcoming!();
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/streams"))).toHaveLength(2);
  });
  it("keeps every verified SportsBite player for the same match", async () => {
    const streamIds = ["real-barca-a", "real-barca-b", "real-barca-c", "real-barca-d"];
    const multiSourceEvent = { ...live, streams: streamIds.map(id => ({
      manifest_url: `https://sportsbite.org/tlive-embed/embed/${id}`,
      language: "Spanish",
    })) };
    const routes: Record<string, Response> = {
      "https://sportsbite.org/api/forestgump/matches": json({ days: [{ events: [multiSourceEvent] }] }),
      "https://streamfree.top/streams": json({ streams: {} }),
    };
    for (const id of streamIds) {
      routes[`https://sportsbite.org/tlive-embed/embed/${id}`] = new Response(
        `var source = atob("${btoa(`https://sportsbite.org/tlive/${id}.m3u8`)}");`,
      );
    }
    mockFetch(routes);

    const events = await buildFmhySportsProvider().fetchEvents();

    expect(events[0].sources.map(source => source.url)).toEqual(streamIds.map(id => `https://sportsbite.org/tlive/${id}.m3u8`));
    expect(probe).toHaveBeenCalledTimes(4);
  });
  it("publishes each verified live match while slower candidates are still being checked", async () => {
    const second = { ...live, slug: "second-match", title: "Team A vs Team B", start: "2026-10-29T19:10:00Z",
      teams: { home: { name: "Team A" }, away: { name: "Team B" } },
      streams: [{ manifest_url: "https://sportsbite.org/tlive-embed/embed/second-match", language: "Spanish" }] };
    mockFetch({
      "https://sportsbite.org/api/forestgump/matches": json({ days: [{ events: [live, second] }] }),
      "https://sportsbite.org/tlive-embed/embed/real-barca?v=high": new Response(`var source = atob("${btoa("https://sportsbite.org/tlive/real-barca")}");`),
      "https://sportsbite.org/tlive-embed/embed/second-match": new Response(`var source = atob("${btoa("https://sportsbite.org/tlive/second-match")}");`),
      "https://streamfree.top/streams": json({ streams: {} }),
    });
    let releaseSlowProbe!: (valid: boolean) => void;
    probe.mockImplementation(async (source: { url: string }) => source.url.endsWith("/real-barca")
      ? true : new Promise<boolean>(resolve => { releaseSlowProbe = resolve; }));
    const updates: string[][] = [];
    let complete = false;
    const pending = buildFmhySportsProvider().fetchEvents(events => {
      updates.push(events.map(event => event.title));
    }).then(events => { complete = true; return events; });

    await vi.waitFor(() => expect(updates.some(events => events.includes("Real Madrid vs Barcelona"))).toBe(true));
    expect(complete).toBe(false);
    releaseSlowProbe(true);
    await pending;
  });
  it("uses the existing native HTTP bridge in Tauri instead of relying on browser CORS", async () => {
    nativeRuntime.mockReturnValue(true);
    invoke.mockImplementation(async (_command, args) => ({ status: 200, url: args.request.url, bodyBase64: btoa(JSON.stringify({ streams: {}, days: [] })) }));
    const fetcher = mockFetch({});
    expect(await buildFmhySportsProvider().fetchEvents()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][0]).toBe("provider_http_request");
  });
});
