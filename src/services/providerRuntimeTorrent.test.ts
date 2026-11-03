import { describe, expect, it } from "vitest";
import { normalizeProviderRuntimeTorrent } from "./providerRuntimeTorrent.ts";

const origin = { key: "aetherio-hub:subsplease-provider", name: "SubsPlease", ownerName: "Aetherio", repositoryName: "Provider Hub" };
const hash = "abcdef0123456789abcdef0123456789abcdef01";

describe("Hub torrent scripts reach the existing P2P player", () => {
  it("preserves infohash, magnet trackers, seeders and source identity without inventing an HTTP URL", () => {
    const magnet = `magnet:?xt=urn:btih:${hash}&tr=udp%3A%2F%2Ftracker.example%3A80`;
    const normalized = normalizeProviderRuntimeTorrent({ infoHash: hash.toUpperCase(), title: "[SubsPlease] Sample - 03.mkv", sources: [magnet], seeders: 42, size: 123456, languages: ["ja"] }, origin, 0);
    expect(normalized).toMatchObject({ infoHash: hash, sources: [magnet], seeders: 42, size: 123456, name: "SubsPlease", sourceName: "SubsPlease", languages: ["ja"] });
    expect(normalized?.url).toBeUndefined();
    expect(normalized?.addonId).toBe("providerRuntime-provider:aetherio-hub:subsplease-provider");
  });
  it("rejects malformed hashes and does not turn a torrent web page into a playable source", () => {
    expect(normalizeProviderRuntimeTorrent({ infoHash: "invalid", url: "https://nyaa.si/view/1" }, origin, 0)).toBeNull();
    expect(normalizeProviderRuntimeTorrent({ url: "magnet:?xt=urn:btih:bad" }, origin, 0)).toBeNull();
  });
  it("accepts a valid magnet without a separate hash and keeps unknown seeders unknown", () => {
    const result = normalizeProviderRuntimeTorrent({ url: `magnet:?xt=urn:btih:${hash}`, seeders: -1 }, origin, 1);
    expect(result?.infoHash).toBe(hash);
    expect(result?.seeders).toBeUndefined();
  });
});
