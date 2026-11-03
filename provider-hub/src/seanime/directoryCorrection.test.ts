import { describe, expect, it } from "vitest";
import { loadAddons } from "../addonRegistry.ts";
import { DEFAULT_ADDONS } from "../addons.ts";
import type { Env } from "../types.ts";

function environment(directory: unknown) {
  return { PROVIDERS: { get: async () => JSON.stringify(directory) } } as unknown as Env;
}

describe("remove the false AnimeAV1 / AnimES connection", () => {
  it("does not publish a filtered AnimES source as AnimeAV1", () => {
    expect(DEFAULT_ADDONS.some(addon => addon.id === "aetherio.source.animeav1")).toBe(false);
    expect(DEFAULT_ADDONS.find(addon => addon.id === "com.animeflv.stremio.addon")?.streamNameFilter).toBeUndefined();
  });

  it.each([1, 2])("corrects the previous v%s directory without changing personal/administrative metadata", async version => {
    const parent = { ...DEFAULT_ADDONS.find(addon => addon.id === "com.animeflv.stremio.addon")!, name: "Mi AnimES", enabledByDefault: false,
      streamNameFilter: { mode: "exclude", prefixes: ["AnimeAV1"] }, updatedAt: 42 };
    const fake = { ...parent, id: "aetherio.source.animeav1", upstreamAddonId: parent.id, streamNameFilter: { mode: "include", prefixes: ["AnimeAV1"] } };
    const personal = { ...parent, id: "personal", manifestUrl: "https://personal.example/manifest.json", name: "AIOStreams | ElfHosted" };
    const corrected = await loadAddons(environment({ version, addons: [fake, parent, personal] }));
    expect(corrected.map(addon => addon.id)).toEqual([parent.id, personal.id]);
    expect(corrected[0]).toMatchObject({ name: "Mi AnimES", enabledByDefault: false, updatedAt: 42 });
    expect(corrected[0].streamNameFilter).toBeUndefined();
    expect(corrected[1]).toEqual(personal);
  });

  it("respects an explicitly empty Hub and independent user-defined sources", async () => {
    expect(await loadAddons(environment({ version: 2, addons: [] }))).toEqual([]);
    const independent = { ...DEFAULT_ADDONS[0], id: "aetherio.source.animeav1", manifestUrl: "https://independent.example/manifest.json" };
    expect(await loadAddons(environment({ version: 2, addons: [independent] }))).toEqual([independent]);
  });
});
