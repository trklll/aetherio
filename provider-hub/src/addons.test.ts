import { describe, expect, it, vi } from "vitest";
import { addonLogoResponse, buildAddonDirectory, DEFAULT_ADDONS } from "./addons.ts";

describe("Provider Hub Stremio addon directory", () => {
  it("publishes all bundled streaming addons and their logos", () => {
    const directory = buildAddonDirectory("https://hub.example");
    const byId = new Map(directory.addons.map(addon => [addon.id, addon]));

    expect([...byId.keys()]).toEqual([
      "com.animeflv.stremio.addon",
      "com.stremio.torrentio.addon",
      "com.linvo.cinemeta",
      "com.stremio.HdHub",
      "org.portal.free",
      "com.penguplay",
      "community.sports.fly",
    ]);
    expect(directory.addons.every(addon => addon.logo.startsWith("https://"))).toBe(true);
    expect(byId.get("com.linvo.cinemeta")?.logo).toBe("https://hub.example/addons/logos/cinemeta.svg");
    expect(byId.has("nyaasi")).toBe(false);
    expect(byId.get("community.sports.fly")?.manifestUrl).toBe("https://sports.highfly.to/manifest.json");
    expect(byId.get("community.sports.fly")?.manifestUrl).not.toContain("personal-test");
  });

  it("keeps official AnimeAV1 artwork available for its independent script, not an AnimES alias", async () => {
    const directory = buildAddonDirectory("https://hub.example");
    const source = directory.addons.find(addon => addon.id === "aetherio.source.animeav1");
    const animes = directory.addons.find(addon => addon.id === "com.animeflv.stremio.addon");
    expect(source).toBeUndefined();
    expect(animes?.streamNameFilter).toBeUndefined();
    const fetcher = vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>'));
    vi.stubGlobal("fetch", fetcher);
    try {
      const logo = await addonLogoResponse("/addons/logos/animeav1.svg");
      expect(logo?.status).toBe(200);
      expect(logo?.headers.get("content-type")).toContain("image/svg+xml");
      expect(fetcher).toHaveBeenCalledWith("https://animeav1.com/img/logo-dark.svg");
    } finally { vi.unstubAllGlobals(); }
  });

  it("preserves the configured AnimES manifest without using it as the independent AnimeAV1 source", () => {
    const animes = DEFAULT_ADDONS.find(addon => addon.id === "com.animeflv.stremio.addon");
    const torrentio = DEFAULT_ADDONS.find(addon => addon.id === "com.stremio.torrentio.addon");

    expect(animes?.manifestUrl).toContain("onAirCatalogs=animeav1");
    expect(animes?.description).not.toContain("AnimeAV1");
    expect(torrentio?.description).toContain("NyaaSi");
  });

  it("preserves the authenticated PenguPlay proxy route and hidden integration behavior", () => {
    const penguplay = DEFAULT_ADDONS.find(addon => addon.id === "com.penguplay");
    expect(penguplay).toMatchObject({
      manifestUrl: "/api/penguplay/manifest.json",
      hiddenInUi: true,
      streamTimeoutMs: 20_000,
      streamAttempts: 2,
    });
  });

  it("serves the Hub-owned Cinemeta logo as SVG", async () => {
    const response = await addonLogoResponse("/addons/logos/cinemeta.svg");
    expect(response?.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response?.text()).toContain("CINEMETA");
    expect(await addonLogoResponse("/addons/logos/unknown.svg")).toBeNull();
  });

  it("serves upstream addon artwork from the Hub logo route", async () => {
    const fetchMock = vi.fn(async () => new Response("logo-bytes", {
      status: 200,
      headers: { "content-type": "image/png" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await addonLogoResponse("/addons/logos/torrentio.png");
      expect(fetchMock).toHaveBeenCalledWith("https://torrentio.strem.fun/images/logo_v1.png");
      expect(response?.headers.get("content-type")).toBe("image/png");
      expect(await response?.text()).toBe("logo-bytes");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
