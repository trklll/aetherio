import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { configureDesktopProfile } = createRequire(import.meta.url)("./nuvio-desktop-profile.cjs");

describe("Sports desktop profile", () => {
  it("keeps every replay provider but prioritizes live schedules before archives", () => {
    const aggregator = {
      providers: ["Ak47Live", "DaddyLive", "vavoo", "replayzone", "soccerfull", "livetv", "fullraces", "nflvideo", "basketballvideo", "hockeyreplays", "mlblive"].map(name => ({ name })),
      _fetchProviderMatches: vi.fn(),
    };
    configureDesktopProfile({ resolve: () => aggregator });
    expect(aggregator.providers.map(provider => provider.name)).toEqual(["Ak47Live", "DaddyLive", "vavoo", "replayzone", "soccerfull", "livetv", "fullraces", "nflvideo", "basketballvideo", "hockeyreplays", "mlblive"]);
  });

  it("bounds catalog provider concurrency and releases slots after errors", async () => {
    let active = 0;
    let peak = 0;
    const aggregator = {
      providers: [],
      async _fetchProviderMatches(provider: { name: string }) {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve));
        active--;
        if (provider.name === "fail") throw new Error("offline");
        return [provider.name];
      },
    };
    const container = { resolve: () => aggregator };
    configureDesktopProfile(container);
    configureDesktopProfile(container);
    const result = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => aggregator._fetchProviderMatches({ name: index === 0 ? "fail" : String(index) })));
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(11);
    expect(result[0].status).toBe("rejected");
  });

  it("publishes the first live-sport schedule on cold boot without replacing a populated cache", async () => {
    let matches: unknown[] = [];
    const cache = { getMatchesReadOnly: () => matches, setMatches: (value: unknown[]) => { matches = value; } };
    const fixture = { id: "fixture", category: "football", sources: [{ source: "ak47" }] };
    const aggregator = { providers: [], _fetchProviderMatches: async () => [fixture, { id: "network", category: "networks" }] };
    configureDesktopProfile({ resolve: (name: string) => name === "matchAggregator" ? aggregator : cache });
    await aggregator._fetchProviderMatches();
    expect(matches).toEqual([fixture]);
    matches = [{ id: "already-populated" }];
    await aggregator._fetchProviderMatches();
    expect(matches).toEqual([{ id: "already-populated" }]);
  });
});
