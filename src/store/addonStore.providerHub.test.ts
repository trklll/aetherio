import { expect, it, vi } from "vitest";

it("replaces bundled metadata from the Hub while preserving enabled state and custom addons", async () => {
  const values = new Map<string, string>();
  values.set("aetherio-addons", JSON.stringify({ state: { addons: [
    {
      id: "com.stremio.torrentio.addon",
      name: "Old Torrentio",
      url: "https://old.example/manifest.json",
      manifest: { id: "com.stremio.torrentio.addon" },
      enabled: false,
      installedAt: 0,
      version: "0.0.14",
      bundled: true,
      scope: "global",
    },
    {
      id: "custom.sources",
      name: "My source",
      url: "https://custom.example/manifest.json",
      manifest: { id: "custom.sources", resources: ["stream"], types: ["movie"] },
      enabled: true,
      installedAt: 42,
      version: "2.0.0",
      scope: "global",
    },
  ] }, version: 0 }));
  values.set("aetherio-provider-hub-addon-directory", JSON.stringify({
    version: 1,
    addons: [{
      id: "com.stremio.torrentio.addon",
      name: "Torrentio",
      description: "Torrentio Latino",
      logo: "https://hub.example/torrentio.png",
      manifestUrl: "https://torrentio.example/latino/manifest.json",
      enabledByDefault: true,
      catalogPolicy: "empty",
      manifestFallback: {
        id: "com.stremio.torrentio.addon",
        version: "0.0.15",
        resources: [{ name: "stream", types: ["movie", "series"] }],
        catalogs: [{ id: "unused" }],
      },
    }],
  }));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.resetModules();

  try {
    const { useAddonStore } = await import("./addonStore.ts");
    const addons = useAddonStore.getState().addons;
    expect(addons.find(addon => addon.id === "com.stremio.torrentio.addon")).toMatchObject({
      name: "Torrentio",
      url: "https://torrentio.example/latino/manifest.json",
      enabled: false,
      logo: "https://hub.example/torrentio.png",
      manifest: { catalogs: [] },
    });
    expect(addons.find(addon => addon.id === "custom.sources")).toMatchObject({
      url: "https://custom.example/manifest.json",
      installedAt: 42,
      enabled: true,
    });
  } finally {
    vi.unstubAllGlobals();
    vi.resetModules();
  }
});
