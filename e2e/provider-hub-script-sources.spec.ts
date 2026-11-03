import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const hub = "https://aetherio-provider-hub.xoolinnbeats.workers.dev";
const scripts = ["animeav1", "animeflv", "jkanime", "subsplease-provider"].map(id => ({ id,
  name: ({ animeav1: "AnimeAV1", animeflv: "AnimeFLV", jkanime: "JkAnime", "subsplease-provider": "SubsPlease" } as Record<string, string>)[id],
  description: id === "animeflv" ? "Averiado en el marketplace; pendiente de reparación." : "Fuente de prueba",
  filename: `/scripts/${id}.js`, supportedTypes: ["movie", "tv"], contentLanguage: [id === "subsplease-provider" ? "ja" : "es"], enabled: id !== "animeflv",
  logo: `${hub}/addons/logos/${id === "animeav1" ? "animeav1.svg" : `seanime/${id}`}`,
}));
const artwork = readFileSync(new URL("../src/assets/logosaddons/animeav1-logo.png", import.meta.url));
const sourceById = Object.fromEntries(scripts.map(script => [script.id, readFileSync(new URL(`../provider-hub/src/assets/seanime/${script.id}.js.txt`, import.meta.url), "utf8")]));
const personal = [
  { id: "my.aiostreams", name: "AIOStreams | ElfHosted", url: "https://personal.example/aiostreams/manifest.json" },
  { id: "community.sports.fly", name: "My Highfly", url: "https://personal.example/highfly/manifest.json" },
].map(addon => ({ ...addon, scope: "profile", origin: "user", enabled: true, installedAt: 42, version: "1.0.0", manifest: { id: addon.id, types: ["series"], resources: ["stream"], catalogs: [] } }));

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:1420" && url.pathname === "/") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script></body></html>` });
    if (url.origin === "http://127.0.0.1:1420") return route.continue();
    if (url.pathname === "/addons.json") return route.fulfill({ json: { version: 1, addons: [] } });
    if (url.href === `${hub}/manifest.json`) return route.fulfill({ json: { name: "Aetherio Provider Hub", version: "1.8.0", scrapers: scripts } });
    if (url.pathname.startsWith("/addons/logos/")) return route.fulfill({ contentType: "image/png", body: artwork });
    const script = url.pathname.match(/^\/scripts\/([a-z0-9-]+)\.js$/)?.[1];
    if (script && sourceById[script]) return route.fulfill({ contentType: "application/javascript", body: sourceById[script] });
    if (url.hostname === "animeav1.com") {
      if (url.pathname === "/catalogo/__data.json") return route.fulfill({ json: { nodes: [{ uses: { search_params: ["search"] }, data: [{ results: 1 }, [2], { title: 3, slug: 4 }, "Sample", "sample"] }] } });
      if (url.pathname === "/media/sample/__data.json") return route.fulfill({ json: { nodes: [{ data: [{ slug: 1, episodes: 2 }, "sample", [3], { number: 4 }, 3] }] } });
      if (url.pathname === "/media/sample/3/__data.json") return route.fulfill({ json: { nodes: [{ data: [{ embeds: 1 }, { SUB: 2 }, [3], { server: 4, url: 5 }, "HLS", "https://player.zilla-networks.com/play/sample"] }] } });
    }
    if (url.hostname === "subsplease.org") return route.fulfill({ json: { release: { show: "Sample", episode: "3", release_date: "2026-11-01", page: "sample",
      downloads: [{ res: "1080", magnet: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01" }] } } });
    return route.abort();
  });
  await page.goto("/");
  await page.evaluate(personal => {
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-profile-space-v2:local:active", "own");
    localStorage.setItem("aetherio-profile:own:aetherio-addons", JSON.stringify({ state: { addons: personal }, version: 0 }));
  }, personal);
});

for (const kind of ["desktop", "big-picture"] as const) {
  test(`independent script source, official Hub logo and toggle in ${kind}`, async ({ page }) => {
    await page.setViewportSize({ width: kind === "desktop" ? 1280 : 1920, height: 1080 });
    await page.evaluate(async kind => {
      const fixture = await import(/* @vite-ignore */ "/e2e/fixtures/HubScriptsProbe.tsx");
      await fixture.mountHubScripts(kind);
    }, kind);
    const group = page.getByRole("region", { name: "Scripts del Provider Hub" });
    await expect(group.getByText("AnimeAV1", { exact: true })).toBeVisible();
    await expect(group.getByRole("switch", { name: "Desactivar AnimeAV1", exact: true })).toHaveAttribute("aria-checked", "true");
    const logo = group.locator(`img[src="${hub}/addons/logos/animeav1.svg"]`);
    await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await group.getByRole("switch", { name: "Desactivar AnimeAV1", exact: true }).click();
    await expect(group.getByRole("switch", { name: "Activar AnimeAV1", exact: true })).toHaveAttribute("aria-checked", "false");
    await expect(group.getByRole("switch", { name: "Desactivar JkAnime", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(group.getByText("AnimeFLV", { exact: true })).toBeVisible();
    await expect(group.getByText("Averiado en el marketplace; pendiente de reparación.", { exact: true })).toBeVisible();
    await expect(group.getByRole("switch", { name: "Activar AnimeFLV", exact: true })).toBeDisabled();
    const state = await page.evaluate(async () => {
      const fixture = await import(/* @vite-ignore */ "/e2e/fixtures/HubScriptsProbe.tsx");
      return { addons: fixture.useAddonStore.getState().addons, preferences: JSON.parse(localStorage.getItem("aetherio-source-preferences")!) };
    });
    expect(state.addons).toEqual(personal);
    expect(state.preferences.providerOverrides["aetherio-hub:animeav1"]).toBe(false);
    expect(state.addons.some((addon: { id: string }) => addon.id === "aetherio.source.animeav1")).toBe(false);
  });
}

test("desktop executes the compiled independent scraper and keeps playback headers and its own identity", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { requests.push(request.url()); });
  const streams = await page.evaluate(async () => {
    const fixture = await import(/* @vite-ignore */ "/e2e/fixtures/HubScriptsProbe.tsx");
    return fixture.runHubScript("animeav1");
  });
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ sourceName: "AnimeAV1", url: "https://player.zilla-networks.com/m3u8/sample", behaviorHints: { headers: { Referer: "https://player.zilla-networks.com/", Origin: "https://player.zilla-networks.com" } } });
  expect(requests.some(url => url.startsWith("https://animeav1.com/catalogo/__data.json"))).toBe(true);
  expect(requests.some(url => /pigamer|alwaysdata/.test(url))).toBe(false);
  await expect(page.getByRole("img", { name: "Logo de AnimeAV1", exact: true })).toBeVisible();
});

test("desktop preserves a compiled torrent's P2P identity instead of discarding it for lacking an HTTP URL", async ({ page }) => {
  const streams = await page.evaluate(async () => {
    const fixture = await import(/* @vite-ignore */ "/e2e/fixtures/HubScriptsProbe.tsx");
    return fixture.runHubScript("subsplease-provider");
  });
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ sourceName: "SubsPlease", infoHash: "abcdef0123456789abcdef0123456789abcdef01", languages: ["ja"] });
  expect(streams[0].url).toBeUndefined();
});
