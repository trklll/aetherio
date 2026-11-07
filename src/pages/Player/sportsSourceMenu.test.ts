import { describe, expect, it } from "vitest";
import type { MediaStream } from "../../types/stream";
import { buildSportsSourceOptions, shouldShowSportsSourceMenu } from "./sportsSourceMenu.ts";

const NOW = Date.parse("2026-11-07T19:30:00Z");

describe("sports live source menu", () => {
  it("lists available providers and hides IPTV sources whose match association expired", () => {
    const streams: MediaStream[] = [
      {
        id: "highfly-es", addonId: "highfly", addonName: "Sports Streams · Highfly", name: "LaLiga UHD",
        behaviorHints: { live: true, quality: "1080p", language: "Español" },
      },
      {
        id: "iptv-current", addonId: "iptv-sports", addonName: "IPTV", name: "Canal de deportes",
        behaviorHints: { live: true, sourceType: "iptv", channelName: "Canal Deportes", liveSourceExpiresAt: new Date(NOW + 60_000).toISOString() },
      },
      {
        id: "iptv-expired", addonId: "iptv-sports", addonName: "IPTV", name: "Canal antiguo",
        behaviorHints: { live: true, sourceType: "iptv", liveSourceExpiresAt: new Date(NOW - 1).toISOString() },
      },
    ];

    expect(buildSportsSourceOptions(streams, NOW)).toEqual([
      { value: "highfly-es", label: "Sports Streams · Highfly", description: "LaLiga UHD · 1080p · Español" },
      { value: "iptv-current", label: "IPTV", description: "Canal Deportes" },
    ]);
  });

  it("shows the compact source control only for sports with multiple available sources", () => {
    const oneSource = [{ value: "one", label: "Addon" }];
    const multipleSources = [...oneSource, { value: "two", label: "IPTV" }];

    expect(shouldShowSportsSourceMenu(true, multipleSources)).toBe(true);
    expect(shouldShowSportsSourceMenu(true, oneSource)).toBe(false);
    expect(shouldShowSportsSourceMenu(false, multipleSources)).toBe(false);
  });
});
