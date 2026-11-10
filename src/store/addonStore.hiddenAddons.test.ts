import { describe, expect, it, vi } from "vitest";
import { listableAddons, manifestForHubAddon, PENGUPLAY_MANIFEST_URL, useAddonStore, type InstalledAddon } from "./addonStore.ts";

function addon(id: string, extra: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    id,
    name: id,
    url: `https://example.com/${id}/manifest.json`,
    manifest: { id },
    enabled: true,
    installedAt: 0,
    version: "1.0.0",
    ...extra,
  };
}

describe("addons ocultos en la UI", () => {
  it("listableAddons quita los ocultos y deja el resto", () => {
    const list = [
      addon("com.linvo.cinemeta"),
      addon("com.penguplay", { hiddenInUi: true }),
      addon("com.stre.mio.torrentio.addon", { bundled: true }),
    ];
    expect(listableAddons(list).map(item => item.id)).toEqual([
      "com.linvo.cinemeta",
      "com.stre.mio.torrentio.addon",
    ]);
  });

  it("un add-on oculto sigue siendo alcanzable por id", () => {
    // Oculto significa "no se lista", no "no existe": si disappears de la
    // lista pero tampoco esta en `addons`, el stream dejaria de pedirse.
    const list = [addon("com.penguplay", { hiddenInUi: true })];
    expect(listableAddons(list)).toHaveLength(0);
    expect(list.find(item => item.id === "com.penguplay")).toBeDefined();
  });

  it("mantiene CNCVerse TV fuera de la lista normal de add-ons aunque el directorio remoto no lo marque oculto", () => {
    expect(listableAddons([addon("com.cncverse.stremiobridge.p1hym8x62am7m")])).toEqual([]);
  });

  it("normaliza CNCVerse TV a un manifest de stream tv sin catálogos para evitar superficies VOD", () => {
    const manifest = manifestForHubAddon({
      id: "com.cncverse.stremiobridge.p1hym8x62am7m",
      name: "CNCVerse TV",
      description: "Canales IPTV deportivos",
      logo: "https://example.com/cnc.png",
      manifestUrl: "https://example.com/manifest.json",
      enabledByDefault: true,
      catalogPolicy: "keep",
      manifestFallback: { types: ["movie", "series", "other", "tv"], resources: ["catalog", "stream"], catalogs: [] },
    }, {
      types: ["movie", "series", "other", "tv"],
      resources: ["catalog", "stream"],
      catalogs: [{ type: "movie", id: "movies", name: "Movies" }],
    });
    expect(manifest.types).toEqual(["tv"]);
    expect(manifest.catalogs).toEqual([]);
    expect(manifest.resources).toEqual([{ name: "stream", types: ["tv"] }]);
  });
});

describe("PenguPlay", () => {
  it("usa el proxy del Worker y no expone la credencial upstream", () => {
    expect(new URL(PENGUPLAY_MANIFEST_URL).pathname).toBe("/api/penguplay/manifest.json");
    expect(PENGUPLAY_MANIFEST_URL).not.toContain("auth_token");
  });
});

describe("Sports fuera del producto", () => {
  it("no incluye el addon integrado de StremVerse", () => {
    expect(useAddonStore.getState().addons.map(item => item.id)).not.toContain("com.stremverse.org");
  });

  it("elimina de la persistencia el StremVerse que dejó una instalación anterior", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const entries = new Map<string, string>([["aetherio-addons", JSON.stringify({
      state: {
        addons: [{
          id: "com.stremverse.org",
          name: "StremVerse",
          url: "https://example.com/manifest.json",
          manifest: { id: "com.stremverse.org" },
          enabled: true,
          installedAt: 0,
          version: "3.0.0",
          bundled: true,
          scope: "global",
        }],
      },
      version: 0,
    })]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => entries.set(key, value),
        removeItem: (key: string) => entries.delete(key),
      },
    });

    vi.resetModules();
    try {
      const { useAddonStore: isolatedStore } = await import("./addonStore.ts");
      expect(isolatedStore.getState().addons.map(item => item.id)).not.toContain("com.stremverse.org");
      expect(entries.get("aetherio-addons")).not.toContain("com.stremverse.org");
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
      vi.resetModules();
    }
  });
});
