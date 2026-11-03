import { describe, expect, it } from "vitest";
import type { LiveChannel, LiveEvent } from "../types/liveSports.ts";
import { attachIptvSources, channelMatchesSports, filterFreshIptvChannels, parseSportsM3u, parseXmltv, programmeMatchesEvent, withChannelProgrammes } from "./iptvSports.ts";

const NOW = Date.parse("2026-10-30T19:30:00Z");
const list = { id: "mine", name: "Mi lista" };
const playlist = `#EXTM3U x-tvg-url="https://guide.example.com/tv.xml.gz"
#EXTINF:-1 tvg-id="Football.es@HD" tvg-logo="https://img.example.com/f.png" group-title="Fútbol",Canal Fútbol (1080p)
#EXTVLCOPT:http-referrer=https://watch.example.com/
#EXTVLCOPT:http-user-agent=Aetherio TV
https://cdn.example.com/football.m3u8
#EXTINF:-1 tvg-id="Fight.es" group-title="MMA",Canal Combate
https://cdn.example.com/fight.m3u8
#EXTINF:-1 tvg-id="News.es" group-title="Noticias",Noticias
https://cdn.example.com/news.m3u8`;

function event(patch: Partial<LiveEvent> = {}): LiveEvent {
  return { id: "addon-game", title: "Real Madrid vs Barcelona", sport: "Football", league: "LaLiga", status: "live",
    startsAt: "2026-10-30T19:00:00Z", home: { name: "Real Madrid" }, away: { name: "FC Barcelona" },
    sources: [{ id: "addon-source", label: "Addon", url: "https://addon.example.com/live.m3u8" }], ...patch };
}

function programme(patch: Record<string, unknown> = {}) {
  return { channelId: "Football.es", title: "LaLiga: Real Madrid - FC Barcelona", startsAt: "2026-10-30T19:00:00Z",
    endsAt: "2026-10-30T21:00:00Z", categories: ["Fútbol"], live: true, repeat: false, ...patch };
}

function channel(patch: Partial<LiveChannel> = {}): LiveChannel {
  return { ...parseSportsM3u(playlist, list).channels[0], currentProgramme: programme(),
    sources: [{ id: "iptv-1", label: "IPTV · Mi lista · Canal Fútbol", url: "https://cdn.example.com/football.m3u8", origin: "iptv", verifiedAt: NOW }], ...patch };
}

describe("sports M3U import", () => {
  it("hides unverified, expired and future-verified IPTV channels but keeps other live providers", () => {
    const expired = channel({ id: "expired", sources: [{ id: "old", label: "IPTV", url: "https://cdn.example.com/old.m3u8", origin: "iptv", verifiedAt: NOW - 55_001 }] });
    const fresh = channel({ id: "fresh", sources: [{ id: "good", label: "IPTV", url: "https://cdn.example.com/good.m3u8", origin: "iptv", verifiedAt: NOW }] });
    const unverified = channel({ id: "unknown", sources: [{ id: "unknown", label: "IPTV", url: "https://cdn.example.com/unknown.m3u8", origin: "iptv" }] });
    const future = channel({ id: "future", sources: [{ id: "future", label: "IPTV", url: "https://cdn.example.com/future.m3u8", origin: "iptv", verifiedAt: NOW + 1 }] });
    const legacy = channel({ id: "iptv:legacy", sources: [{ id: "legacy", label: "IPTV", url: "https://cdn.example.com/legacy.m3u8" }] });
    const expiredHighfly = channel({ id: "highfly:leaf:old", sources: [{ id: "highfly", label: "Sports Streams", providerId: "sports-streams", url: "https://cdn.example.com/highfly.m3u8", verifiedAt: NOW - 55_001 }] });
    const addon = channel({ id: "addon", sources: [{ id: "addon", label: "Addon", url: "https://addon.example.com/live.m3u8" }] });

    expect(filterFreshIptvChannels([expired, fresh, unverified, future, legacy, expiredHighfly, addon], NOW).map(value => value.id)).toEqual(["fresh", "addon"]);
  });

  it("keeps sports, programme URLs, artwork and required playback headers", () => {
    const parsed = parseSportsM3u(`\uFEFF${playlist.replace(/\n/g, "\r\n")}`, list);
    expect(parsed.epgUrls).toEqual(["https://guide.example.com/tv.xml.gz"]);
    expect(parsed.channels.map(c => c.name)).toEqual(["Canal Fútbol", "Canal Combate"]);
    expect(parsed.channels[0]).toMatchObject({ tvgId: "Football.es@HD", sports: ["futbol"], logo: "https://img.example.com/f.png" });
    expect(parsed.channels[0].sources[0]).toMatchObject({ origin: "iptv", quality: "1080p", headers: { Referer: "https://watch.example.com/", "User-Agent": "Aetherio TV" } });
  });

  it("preserves language and country metadata so Spanish channels can be prioritized", () => {
    const parsed = parseSportsM3u('#EXTM3U\n#EXTINF:-1 tvg-id="Canal.es@HD" tvg-language="Spanish" tvg-country="ES" group-title="Sports",Canal\nhttps://cdn.example.com/canal.m3u8', list);
    expect(parsed.channels[0]).toMatchObject({ language: "Spanish", country: "ES" });
    expect(parsed.channels[0].sources[0].language).toBe("Spanish");
  });

  it("merges channel variants, but does not merge different regions or names", () => {
    const variants = `${playlist}\n#EXTINF:-1 tvg-id="Football.es@SD" group-title="Sports",Canal Fútbol (720p)\nhttps://cdn.example.com/alternate.m3u8\n#EXTINF:-1 tvg-id="Football.ar" group-title="Fútbol",Canal Fútbol Argentina\nhttps://cdn.example.com/ar.m3u8`;
    const parsed = parseSportsM3u(variants, list);
    expect(parsed.channels).toHaveLength(3);
    expect(parsed.channels[0].sources).toHaveLength(2);
  });

  it("supports comma-containing titles, EXTPGRP and pipe headers without leaking headers between entries", () => {
    const parsed = parseSportsM3u(`#EXTM3U
#EXTINF:-1 tvg-name="Fútbol, España",Fútbol, España
#EXTGRP:Deportes
https://cdn.example.com/a.m3u8|Referer=https%3A%2F%2Fwatch.example.com%2F&User-Agent=TV
#EXTINF:-1 group-title="MMA",MMA
https://cdn.example.com/b.m3u8`, list);
    expect(parsed.channels[0].name).toBe("Fútbol, España");
    expect(parsed.channels[0].sources[0].headers?.Referer).toBe("https://watch.example.com/");
    expect(parsed.channels[1].sources[0].headers).toBeUndefined();
  });

  it("rejects HLS media playlists, arbitrary files, unsafe URLs and DRM-only entries", () => {
    expect(() => parseSportsM3u("<html>offline</html>", list)).toThrow();
    expect(() => parseSportsM3u("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts", list)).toThrow();
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "http://127.1/a", "https://10.0.0.1/a", "https://user:password@cdn.example.com/a"]) {
      expect(parseSportsM3u(`#EXTM3U\n#EXTINF:-1 group-title="Fútbol",Canal\n${url}`, list).channels).toEqual([]);
    }
    expect(parseSportsM3u('#EXTM3U\n#EXTINF:-1 group-title="MMA",UFC\n#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha\nhttps://cdn.example.com/a.mpd', list).channels).toEqual([]);
  });

  it("filters by the selected disciplines, not the followed club or the generic Sports tag", () => {
    const football = channel();
    const mma = parseSportsM3u(playlist, list).channels[1];
    expect(channelMatchesSports(football, ["futbol"], NOW)).toBe(true);
    expect(channelMatchesSports(mma, ["futbol"], NOW)).toBe(false);
    expect(channelMatchesSports(mma, [], NOW)).toBe(true);
    const unknown = parseSportsM3u('#EXTM3U\n#EXTINF:-1 group-title="Sports",Unknown Sports\nhttps://cdn.example.com/a.m3u8', list).channels[0];
    expect(channelMatchesSports(unknown, ["futbol"], NOW)).toBe(false);
    expect(channelMatchesSports({ ...unknown, currentProgramme: programme() }, ["futbol"], NOW)).toBe(true);
    expect(channelMatchesSports({ ...unknown, currentProgramme: programme({ endsAt: "2026-10-30T19:00:00Z" }) }, ["futbol"], NOW)).toBe(false);
  });
});

describe("XMLTV programmes and identity", () => {
  it("reads XML entities, CDATA, explicit offsets, live markers and repetitions", () => {
    const guide = parseXmltv(`<?xml version="1.0"?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv>
      <channel id="Football.es"><display-name>Fútbol &amp; TV</display-name></channel>
      <programme channel="Football.es" start="20261030200000 +0100" stop="20261030220000 +0100"><title><![CDATA[Real Madrid - FC Barcelona]]></title><sub-title>En directo</sub-title><category>Fútbol</category><live /></programme>
      <programme channel="Fight.es" start="20261030200000 +0100" stop="20261030220000 +0100"><title>UFC 300</title><previously-shown /></programme>
      <programme channel="bad" start="20260230200000 +0100" stop="20261030220000 +0100"><title>Bad date</title></programme>
    </tv>`, NOW);
    expect(guide.programmes).toHaveLength(2);
    expect(guide.programmes[0]).toMatchObject({ title: "Real Madrid - FC Barcelona", startsAt: "2026-10-30T19:00:00.000Z", live: true });
    expect(guide.programmes[1].repeat).toBe(true);
    expect(guide.channels.get("Football.es")).toEqual(["Fútbol & TV"]);
  });

  it("joins tvg-id variants and the documented TDTChannels IDs, not arbitrary similar channel names", () => {
    const channels = parseSportsM3u(`${playlist}\n#EXTINF:-1 tvg-id="Teledeporte.es@SD" group-title="Sports",Teledeporte\nhttps://cdn.example.com/tdp.m3u8`, list).channels;
    const xml = `<tv><channel id="TDP.TV"><display-name>TDP.TV</display-name></channel><programme channel="TDP.TV" start="20261030190000 +0000" stop="20261030210000 +0000"><title>Fútbol: Real Madrid - Barcelona</title></programme></tv>`;
    const joined = withChannelProgrammes(channels, [parseXmltv(xml, NOW)], NOW);
    expect(joined.find(c => c.name === "Teledeporte")?.currentProgramme?.title).toContain("Real Madrid");
    expect(joined[0].currentProgramme).toBeUndefined();
  });

  it("matches both opponents and the live time window, including known club aliases", () => {
    expect(programmeMatchesEvent(programme(), event(), NOW)).toBe(true);
    expect(programmeMatchesEvent(programme({ title: "Real Madrid vs Barcelona" }), event(), NOW)).toBe(true);
    expect(programmeMatchesEvent(programme({ title: "LaLiga", description: "Real Madrid - Barcelona. Cobertura del encuentro." }), event(), NOW)).toBe(true);
    expect(programmeMatchesEvent(programme({ title: "LaLiga", description: "Real Madrid vs. Barcelona. Cobertura del encuentro." }), event(), NOW)).toBe(true);
    expect(programmeMatchesEvent(programme({ title: "Real Madrid vs Barcelona (EN VIVO)" }), event(), NOW)).toBe(true);
  });

  it.each([
    { title: "Real Madrid - Atlético de Madrid" },
    { title: "Real Madrid Femenino - Barcelona Femenino" },
    { title: "Real Madrid U21 - Barcelona U21" },
    { title: "Resumen: Real Madrid - Barcelona" },
    { repeat: true },
    { title: "Previa: Real Madrid - Barcelona" },
    { startsAt: "2026-10-30T16:00:00Z" },
    { endsAt: "2026-10-30T19:30:00Z" },
    { startsAt: "2026-10-30T20:00:00Z" },
    { categories: ["Baloncesto"] },
    { title: "Basketball: Real Madrid - FC Barcelona", categories: ["SPORTS"] },
  ])("does not suggest a different match, replay, discipline or time: %j", patch => {
    expect(programmeMatchesEvent(programme(patch), event(), NOW)).toBe(false);
  });

  it("requires a specific MMA event, not merely the UFC channel or organization", () => {
    const mma = event({ title: "UFC 320", sport: "MMA", league: "UFC", home: undefined, away: undefined });
    expect(programmeMatchesEvent(programme({ title: "UFC 320: Main Card", categories: ["MMA"] }), mma, NOW)).toBe(true);
    expect(programmeMatchesEvent(programme({ title: "UFC 321", categories: ["MMA"] }), mma, NOW)).toBe(false);
    expect(programmeMatchesEvent(programme({ title: "UFC", categories: ["MMA"] }), mma, NOW)).toBe(false);
  });

  it("only prioritizes recently verified matching IPTV, preserves addons and expires old associations", () => {
    const original = event();
    const [enriched] = attachIptvSources([original], [channel()], NOW);
    expect(enriched.sources.map(s => s.id)).toEqual(["iptv-1", "addon-source"]);
    expect(enriched.sources[0]).toMatchObject({ origin: "iptv", isDefault: true, validUntil: "2026-10-30T21:00:00Z" });
    expect(original.sources).toHaveLength(1);
    expect(attachIptvSources([original], [channel({ sources: channel().sources.map(s => ({ ...s, verifiedAt: undefined })) })], NOW)[0].sources).toEqual(original.sources);
    expect(attachIptvSources([enriched], [channel()], Date.parse("2026-10-30T21:01:00Z"))[0].sources).toEqual(original.sources);
    expect(attachIptvSources([event({ status: "upcoming" })], [channel()], NOW)[0].sources).toHaveLength(1);
    expect(attachIptvSources([enriched], [channel({ sources: [] })], NOW)[0].sources).toEqual(original.sources);
  });
});
