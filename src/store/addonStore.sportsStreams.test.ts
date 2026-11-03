import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

it("installs the configured Highfly addon, keeps its personal URL local and routes catalogs only through Sports", async () => {
  const values = new Map<string, string>();
  values.set("aetherio-provider-hub-addon-directory", JSON.stringify({
    version: 1,
    addons: [{
      id: "community.sports.fly",
      name: "Sports Streams · Highfly",
      description: "Highfly sports integration",
      logo: "https://cdn.highfly.to/logo.ico",
      manifestUrl: "https://sports.highfly.to/manifest.json",
      enabledByDefault: true,
      catalogPolicy: "empty",
      manifestFallback: {
        id: "community.sports.fly",
        version: "1.3.0",
        types: ["sport"],
        resources: ["catalog", "meta", "stream"],
      },
    }],
  }));
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubEnv("VITE_SPORTS_STREAMS_MANIFEST_URL", "https://sports.highfly.to/personal-test/manifest.json");
  vi.resetModules();
  const { useAddonStore, reloadAddonsForActiveProfile } = await import("./addonStore.ts");
  const addon = useAddonStore.getState().addons.find(addon => addon.id === "community.sports.fly");
  expect(addon).toMatchObject({ enabled: true, url: "https://sports.highfly.to/personal-test/manifest.json", manifest: { types: ["sport"], catalogs: [] } });
  useAddonStore.getState().disableAddon("community.sports.fly");
  expect(reloadAddonsForActiveProfile().find(addon => addon.id === "community.sports.fly")?.enabled).toBe(false);
});
