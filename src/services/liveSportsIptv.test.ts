import { afterEach, describe, expect, it, vi } from "vitest";
import { primeLivePlaybackSession } from "./liveSportsService.ts";
import { AVAILABLE_STREAMS_KEY, availableStreamsMediaKey, buildQuery, SELECTED_STREAM_KEY } from "../pages/Player/utils.ts";
import type { LiveEvent } from "../types/liveSports.ts";

afterEach(() => vi.unstubAllGlobals());

describe("live playback sources", () => {
  it("does not invent season zero for live URLs, but retains an explicitly requested season zero", () => {
    expect(buildQuery(new URLSearchParams("type=live&id=game"))?.season).toBeUndefined();
    expect(buildQuery(new URLSearchParams("type=series&id=game&season=0&ep=1"))?.season).toBe(0);
  });
  it("stores a media-keyed snapshot so the player actually receives IPTV and addon alternatives", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { setItem: (key: string, value: string) => values.set(key, value) });
    const event: LiveEvent = { id: "game", title: "A vs B", league: "League", sport: "futbol", status: "live", startsAt: "2026-10-30T19:00:00Z", sources: [
      { id: "iptv", label: "IPTV · Mi canal", url: "https://cdn.example.com/a.m3u8", origin: "iptv", channelName: "Mi canal", isDefault: true },
      { id: "addon", label: "Addon", url: "https://addon.example.com/a.m3u8" },
    ] };
    primeLivePlaybackSession(event);
    const snapshot = JSON.parse(values.get(AVAILABLE_STREAMS_KEY)!);
    expect(snapshot.key).toBe(availableStreamsMediaKey({ type: "live", id: "game" }));
    expect(snapshot.streams).toHaveLength(2);
    expect(snapshot.streams[0]).toMatchObject({ addonName: "IPTV", behaviorHints: { sourceType: "iptv", live: true } });
    expect(JSON.parse(values.get(SELECTED_STREAM_KEY)!).id).toBe("iptv");
  });
});
