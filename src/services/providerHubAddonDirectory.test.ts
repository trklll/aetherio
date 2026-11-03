import { describe, expect, it } from "vitest";
import { parseProviderHubAddonDirectory, resolveHubAddonManifestUrl } from "./providerHubAddonDirectory.ts";

describe("Provider Hub addon directory client", () => {
  it("validates and normalizes Hub-hosted logos", () => {
    const directory = parseProviderHubAddonDirectory({
      version: 1,
      addons: [{
        id: "example.addon",
        name: "Example",
        description: "Example addon",
        logo: "/addons/logos/example.svg",
        manifestUrl: "https://addon.example/manifest.json",
        enabledByDefault: true,
        catalogPolicy: "empty",
        manifestFallback: { id: "example.addon", types: ["movie"] },
      }],
    });

    expect(directory?.addons[0]).toMatchObject({
      id: "example.addon",
      logo: "https://aetherio-provider-hub.xoolinnbeats.workers.dev/addons/logos/example.svg",
      catalogPolicy: "empty",
    });
  });

  it("rejects duplicate ids and insecure remote manifest or logo URLs", () => {
    const entry = {
      id: "example.addon",
      name: "Example",
      logo: "https://example.org/logo.png",
      manifestUrl: "https://example.org/manifest.json",
      catalogPolicy: "empty",
      manifestFallback: {},
    };
    expect(parseProviderHubAddonDirectory({ version: 1, addons: [entry, entry] })).toBeNull();
    expect(parseProviderHubAddonDirectory({
      version: 1,
      addons: [{ ...entry, manifestUrl: "http://example.org/manifest.json" }],
    })).toBeNull();
    expect(parseProviderHubAddonDirectory({
      version: 1,
      addons: [{ ...entry, logo: "http://example.org/logo.png" }],
    })).toBeNull();
  });

  it("routes relative addon manifests through Aetherio's API origin", () => {
    expect(resolveHubAddonManifestUrl("/api/penguplay/manifest.json"))
      .toBe("https://trkll.aetherio.workers.dev/api/penguplay/manifest.json");
  });

  it("accepts an explicitly empty Hub so removed defaults do not come back", () => {
    expect(parseProviderHubAddonDirectory({ version: 1, addons: [] })).toEqual({ version: 1, addons: [] });
  });

  it("keeps the Hub's logical source identity and stream partition", () => {
    const entry = {
      id: "example.variant", name: "Example variant", logo: "https://hub.example/logo.svg",
      manifestUrl: "https://example.org/manifest.json", catalogPolicy: "empty", manifestFallback: {},
      upstreamAddonId: "example.upstream",
      streamNameFilter: { mode: "include", prefixes: ["Example"] },
    };
    expect(parseProviderHubAddonDirectory({ version: 1, addons: [entry] })?.addons[0]).toMatchObject({
      upstreamAddonId: "example.upstream", streamNameFilter: entry.streamNameFilter,
    });
    expect(parseProviderHubAddonDirectory({ version: 1, addons: [{ ...entry, streamNameFilter: { mode: "execute", prefixes: [] } }] })).toBeNull();
  });

  it("rejects partially malformed directories instead of treating missing entries as deletions", () => {
    const valid = {
      id: "example.addon", name: "Example", logo: "https://hub.example/logo.png",
      manifestUrl: "https://example.org/manifest.json", catalogPolicy: "empty", manifestFallback: {},
    };
    expect(parseProviderHubAddonDirectory({ version: 1, addons: [valid, { id: "broken" }] })).toBeNull();
  });
});
