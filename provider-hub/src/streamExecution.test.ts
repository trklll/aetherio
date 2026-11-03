import { describe, expect, it } from "vitest";
import type { MediaStream, ProviderRecord } from "./types.ts";
import { mapWithConcurrency, selectEnabledStreamProviders, selectProvidersToWarmup, streamDedupeKey, streamsForStremio } from "./streamExecution.ts";

function provider(id: string, overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id,
    name: id,
    enabled: true,
    supportedTypes: ["movie", "tv"],
    mobileHeaders: "drop",
    origin: "default",
    updatedAt: 0,
    ...overrides,
  };
}

describe("stream provider selection", () => {
  it("does not starve enabled providers later in the registry", () => {
    const providers = Array.from({ length: 58 }, (_, index) => provider(`provider-${index + 1}`));
    providers[52] = provider("torrentio");

    const selected = selectEnabledStreamProviders(providers, "tv");

    expect(selected).toHaveLength(58);
    expect(selected.findIndex(item => item.id === "torrentio")).toBeGreaterThan(5);
    expect(selected.some(item => item.id === "torrentio")).toBe(true);
  });

  it("warms all enabled providers and retains explicit compileAlways bundles", () => {
    const providers = [provider("first"), provider("torrentio"), provider("paused", { enabled: false })];

    expect(selectProvidersToWarmup(providers, ["paused"]).map(item => item.id)).toEqual(["first", "torrentio", "paused"]);
  });

  it("filters disabled and unsupported providers without reordering the rest", () => {
    const providers = [
      provider("first"),
      provider("disabled", { enabled: false }),
      provider("movie-only", { supportedTypes: ["movie"] }),
      provider("last"),
    ];

    expect(selectEnabledStreamProviders(providers, "tv").map(item => item.id)).toEqual(["first", "last"]);
  });
});

describe("bounded provider execution", () => {
  it("respects the concurrency limit and preserves result order", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency(Array.from({ length: 17 }, (_, index) => index), 4, async value => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      return value * 2;
    });

    expect(maxActive).toBe(4);
    expect(results).toEqual(Array.from({ length: 17 }, (_, index) => index * 2));
  });
});

describe("stream deduplication identity", () => {
  it("keeps Torrentio hash/magnet streams identifiable without a direct URL", () => {
    const byHash = { infoHash: "ABC123" } as MediaStream;
    const byMagnet = { sources: ["magnet:?xt=urn:btih:abc123"] } as MediaStream;

    expect(streamDedupeKey(byHash)).toBe("hash:abc123");
    expect(streamDedupeKey(byMagnet)).toBe("magnet:magnet:?xt=urn:btih:abc123");
  });

  it("preserves Torrentio infohash streams in the Stremio endpoint payload", () => {
    const torrent = { infoHash: "abc123", sources: ["magnet:?xt=urn:btih:abc123"] } as MediaStream;

    expect(streamsForStremio(provider("torrentio"), [torrent])).toEqual([torrent]);
  });
});
