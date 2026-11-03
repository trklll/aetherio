import { expect, test, type Page } from "@playwright/test";

test.use({ timezoneId: "UTC" });

async function setup(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let nextId = 1;
    let tick = 1;
    const profile = "highfly-e2e";
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: () => nextId++,
        invoke: async (command: string, args?: Record<string, any>) => {
          if (command === "provider_http_request") {
            const url = args?.request?.url ?? "";
            const body = url.endsWith(".ts") ? "media-bytes" : "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:6,\nsegment.ts";
            return { status: url.includes("dead") ? 404 : 200, url, bodyBase64: btoa(body) };
          }
          if (command === "mpv_status") return { timePos: tick++, duration: 0, pause: false, fileLoaded: true, videoWidth: 1920, videoHeight: 1080, tracks: [] };
          if (command === "playback_capabilities") return { mpvBundled: true, backend: "libmpv" };
          if (command === "open_mpv") return { backend: "libmpv", resolvedTarget: args?.target };
          if (command.startsWith("plugin:event|")) return nextId++;
          return null;
        },
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {},
      },
      __TAURI__: { event: { listen: async () => () => undefined } },
    });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: profile, name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", profile);
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["sports-streams"], nativeProvidersVersion: 1, iptvProvidersVersion: 1, sportsStreamsProvidersVersion: 1, refreshSeconds: 60 }));
    localStorage.setItem("aetherio-stremio-sports-base-urls", JSON.stringify({ "sports-streams": "https://sports.highfly.to/e2e" }));
    localStorage.setItem(`aetherio-profile:${profile}:aetherio-sports-preferences`, JSON.stringify({ version: 1, onboarding: "completed", sports: ["futbol", "baloncesto"], followedCompetitions: [], followedClubs: [], followedNationalTeams: [], followedOrganizations: [], followedFighters: [] }));
  });
  await page.route("https://sports.highfly.to/**", async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const basketball = { id: "streamed:basketball", type: "sport", name: "\u200b", description: "Lakers vs Celtics\nLIVE NOW", genres: ["Basketball", "NBA"], releaseInfo: "LIVE" };
    const football = { id: "streamed:football", type: "sport", name: "Arsenal vs Chelsea", genres: ["Football", "Premier League"], releaseInfo: "LIVE", released: new Date(Date.now() - 600_000).toISOString() };
    const next = { id: "streamed:next", type: "sport", name: "Real Madrid vs Barcelona", genres: ["Football", "La Liga"], releaseInfo: "31 Oct 2099 · 02:30 UTC" };
    if (path.endsWith("manifest.json")) return route.fulfill({ json: { id: "community.sports.fly", types: ["sport"], catalogs: [{ type: "sport", id: "sports_live" }, { type: "sport", id: "league_nba" }, { type: "sport", id: "sports_football" }] } });
    if (path.includes("/catalog/")) return route.fulfill({ json: { metas: path.includes("sports_live") ? [football] : path.includes("league_nba") ? [basketball] : [football, next] } });
    if (path.includes("/meta/")) return route.fulfill({ json: { meta: { ...basketball, name: "Lakers vs Celtics", releaseInfo: "30 Oct 2026 · 18:00 UTC" } } });
    if (path.includes("/stream/")) return route.fulfill({ json: { streams: [
      { name: "English", language: "English", url: "https://cdn.example.com/en.m3u8" },
      ...(path.includes("basketball") ? [{ name: "Highfly", title: "🇵🇪 Español · 1080p", url: "https://cdn.example.com/es.m3u8" }] : []),
    ] } });
    return route.fulfill({ json: {} });
  });
  await page.route(/https?:\/\/[^/]*(?:nuvio|stremverse)[^/]*\//, route => route.fulfill({ json: { metas: [] } }));
  await page.route("http://127.0.0.1:7310/**", route => route.fulfill({ json: { metas: [], sync: { state: "idle" } } }));
  await page.goto("/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.getByRole("button", { name: "Lakers vs Celtics", exact: true })).toBeVisible();
}

test("Highfly integra baloncesto de sus ligas en Sports y elige la narración española", async ({ page }) => {
  await setup(page);
  const now = page.locator('[data-row-key*="sports-now"]');
  await expect(now).toHaveAttribute("data-row-count", "2");
  const spanish = now.getByRole("button", { name: "Lakers vs Celtics", exact: true });
  const english = now.getByRole("button", { name: "Arsenal vs Chelsea", exact: true });
  expect((await spanish.boundingBox())!.x).toBeLessThan((await english.boundingBox())!.x);
  await spanish.click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=sportsstreams/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!).url)).toBe("https://cdn.example.com/es.m3u8");
});

test("la agenda convierte el UTC del addon al día y hora de Perú en un equipo UTC", async ({ page }) => {
  await setup(page);
  await page.locator('[data-row-key*="sports-upcoming"]').getByRole("button", { name: "Real Madrid vs Barcelona", exact: true }).click();
  await expect(page.locator(".bp-hero-copy-stage")).toContainText("30 oct 21:30 · Perú");
  await page.screenshot({ path: "artifacts/sports/highfly-peru.png" });
});

test("elegir una fuente inglesa explícitamente no la sustituye por la preferencia automática", async ({ page }) => {
  await setup(page);
  await page.locator('[data-row-key*="sports-now"]').getByRole("button", { name: "Elegir fuentes para Lakers vs Celtics" }).click();
  const dialog = page.getByRole("dialog", { name: "Elegir fuente" });
  await dialog.getByRole("button", { name: /Sports Streams · English/ }).click();
  await expect(page).toHaveURL(/\/big-picture\/player/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!).url)).toBe("https://cdn.example.com/en.m3u8");
});

test("Personalizar permite elegir baloncesto y NBA sin pasar por preguntas de fútbol", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Personalizar", exact: true }).click();
  const sports = page.locator('[data-onboarding-focus-group="sports"]');
  await sports.getByRole("button", { name: /Fútbol/ }).click();
  const leagues = page.getByRole("group", { name: "Competiciones de baloncesto", exact: true });
  await expect(leagues).toBeVisible();
  await leagues.getByRole("button", { name: /^NBA/ }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Listo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lakers vs Celtics", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aetherio-profile:highfly-e2e:aetherio-sports-preferences")!));
  expect(saved.sports).toEqual(["baloncesto"]);
  expect(saved.followedCompetitions).toContain("comp:basketball-nba");
});
