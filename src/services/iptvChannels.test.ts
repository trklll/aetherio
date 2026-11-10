import { describe, expect, it } from "vitest";
import popularSportsPlaylist from "../assets/iptv/popular-sports-iptv.m3u?raw";
import {
  BUNDLED_IPTV_CHANNELS,
  IPTV_CAT_CHANNELS,
  IPTV_PLAYLISTS,
  getAttachedPlaylistEpgUrls,
  loadPlaylistChannels,
  parseM3U,
  resolveIptvChannelStream,
} from "./iptvChannels";

describe("parseM3U", () => {
  it("keeps channel metadata and supports commas inside quoted attributes and names", () => {
    const channels = parseM3U([
      '#EXTM3U url-tvg="https://guide.example/epg.xml.gz"',
      '#EXTINF:-1 tvg-id="news.es" tvg-logo="https://cdn.example/logo.png" group-title="News, Spanish" tvg-language="Spanish",Noticias, En Vivo',
      "https://stream.example/live/index.m3u8",
    ].join("\n"), { id: "test", name: "Test playlist" });

    expect(channels).toEqual([expect.objectContaining({
      name: "Noticias, En Vivo",
      streamUrl: "https://stream.example/live/index.m3u8",
      group: "News, Spanish",
      tvgId: "news.es",
      logo: "https://cdn.example/logo.png",
      language: "Spanish",
      sourceName: "Test playlist",
    })]);
  });

  it("uses EXTGRP and resolves relative stream URLs against the playlist URL", () => {
    const [channel] = parseM3U([
      "#EXTM3U",
      "#EXTGRP: Local",
      "#EXTINF:-1,Canal local",
      "../hls/local.m3u8",
    ].join("\n"), { id: "local", name: "Local list" }, "https://cdn.example/lists/main.m3u");

    expect(channel).toMatchObject({
      group: "Local",
      streamUrl: "https://cdn.example/hls/local.m3u8",
    });
  });
});

describe("IPTV channel catalog", () => {
  it("includes the attached sports M3U, the EPG metadata, and the IPTV Cat online snapshot", () => {
    expect(typeof popularSportsPlaylist).toBe("string");
    expect(parseM3U(popularSportsPlaylist, { id: "attached-sports", name: "Attached list" })).toHaveLength(322);
    expect(BUNDLED_IPTV_CHANNELS.filter(channel => channel.sourceId === "attached-sports")).toHaveLength(322);
    expect(IPTV_CAT_CHANNELS.length).toBeGreaterThan(1_500);
    expect(getAttachedPlaylistEpgUrls()).toHaveLength(5);
    expect(IPTV_CAT_CHANNELS.some(channel => channel.countryCode === "PE" && channel.regions?.includes("peru"))).toBe(true);
  });

  it("loads every supplied remote playlist and returns partial results when one is unavailable", async () => {
    const requests: string[] = [];
    const result = await loadPlaylistChannels(async url => {
      requests.push(url);
      if (url === IPTV_PLAYLISTS[1].url) throw new Error("offline");
      return ["#EXTM3U", "#EXTINF:-1 group-title=\"Sports\",Canal de prueba", "https://streams.example/live.m3u8"].join("\n");
    });

    expect(requests).toHaveLength(4);
    expect(result.channels).toHaveLength(3);
    expect(result.channels.map(channel => channel.sourceId)).toEqual(expect.arrayContaining([
      "iptv-free-sports", "u-din-sports", "iptv-free-spanish",
    ]));
    expect(result.failedPlaylists).toEqual([IPTV_PLAYLISTS[1].name]);
  });

  it("rejects non-public direct stream URLs before playback", async () => {
    await expect(resolveIptvChannelStream({
      id: "private",
      name: "Private feed",
      streamUrl: "http://127.0.0.1/live.m3u8",
      sourceId: "test",
      sourceName: "Test",
    })).rejects.toThrow(/URL pública/);
  });
});
