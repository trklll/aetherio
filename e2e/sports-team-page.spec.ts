import { expect, test, type Page } from "@playwright/test";
import { fotmobTeamFixture } from "../src/services/__fixtures__/fotmobTeam";

async function setup(page: Page, offline = false, liveData = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let id = 1;
    Object.assign(window, { __TAURI_INTERNALS__: { transformCallback: () => id++, invoke: async (command: string, args?: { request?: { url: string } }) => {
      if (command === "provider_http_request" && args?.request) {
        const url = new URL(args.request.url);
        const prefix = url.hostname === "www.fotmob.com" ? "/api/sports-data/fotmob" : url.hostname === "data.fotmob.com" ? "/api/sports-data/fotmob-stats" : "/api/sports-data/wikidata";
        const path = url.hostname === "www.fotmob.com" ? url.pathname.replace("/api/data", "") : url.pathname;
        const response = await fetch(`${prefix}${path}${url.search}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const binary = bytes.reduce((result, byte) => result + String.fromCharCode(byte), "");
        return { status: response.status, bodyBase64: btoa(binary), url: args.request.url };
      }
      return command.startsWith("plugin:event|") ? id++ : null;
    }, convertFileSrc: (value: string) => value, metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {} }, __TAURI__: { event: { listen: async () => () => undefined } } });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: "team-page", name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", "team-page");
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1, iptvProvidersVersion: 1, sportsStreamsProvidersVersion: 1 }));
    localStorage.setItem("aetherio-profile:team-page:aetherio-sports-preferences", JSON.stringify({ version: 1, onboarding: "completed", sports: ["futbol"], followedCompetitions: ["comp:eng-premier"], followedClubs: ["club:man-utd"], followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos" }));
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => /127\.0\.0\.1:7310|nuviosports|highfly|stremverse/.test(String(input)) ? Promise.resolve(new Response(JSON.stringify({ metas: [], sync: { state: "idle" } }))) : original(input, init);
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
  await page.route(/https:\/\/[^/]*espn[^/]*\//, route => { throw new Error(`ESPN is forbidden in the MVP: ${route.request().url()}`); });
  if (!liveData) {
    await page.route("**/api/sports-data/fotmob/**", route => offline ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: fotmobTeamFixture(10260, "Manchester United", false) }));
    await page.route("**/api/sports-data/fotmob-stats/**", route => route.fulfill({ json: { TopLists: [{ StatList: [{ ParticiantId: 1, TeamId: 10260, StatValue: 12 }] }] } }));
    await page.route("**/api/sports-data/wikidata/**", route => route.fulfill({ json: { entities: { Q18656: { claims: { P571: [{ mainsnak: { datavalue: { value: { time: "+1878-01-01T00:00:00Z", precision: 9 } } } }] } } } } }));
  }
  await page.goto("/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
}

test("el equipo abre una página directa con datos y conserva solo Añadir", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await expect(row.getByRole("button", { name: "Añadir equipos" })).toBeVisible();
  await row.getByRole("button", { name: "Manchester United", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports\/team\/club%3Aman-utd/i);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Manchester United", exact: true })).toBeVisible();
  await expect(page.locator(".team-page__own")).toContainText("68");
  await expect(page.getByRole("complementary", { name: "Datos del club" })).toContainText("Wikidata");
  await expect(page.getByText(/Fundación registrada/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gestionar mis equipos" })).toHaveCount(0);
  for (const [width, height, name] of [[1920, 1080, "desktop"], [900, 720, "minimum"], [390, 844, "narrow"]] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `.impeccable/review/sports-team-page/${name}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Alineación", exact: true }).click();
  await expect(page.getByText("Última alineación publicada", { exact: false })).toBeVisible();
  await expect(page.getByText("Jugador de prueba", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plantilla", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Perú");
  await page.getByRole("button", { name: "Partidos", exact: true }).click();
  await expect(page.getByText("2 – 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Títulos", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Copa de Europa / Champions League");
  await page.getByRole("button", { name: "Volver a Deportes" }).click();
  await expect(row).toBeVisible();
});

test("fallo de FotMob muestra recuperación sin volver a ESPN", async ({ page }) => {
  await setup(page, true);
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos cargar los datos de FotMob");
  await expect(page.getByRole("button", { name: "Reintentar datos" })).toBeEnabled();
  await page.getByRole("button", { name: "Títulos", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("Wikidata puede fallar sin bloquear los datos deportivos", async ({ page }) => {
  await setup(page);
  await page.route("**/api/sports-data/wikidata/**", route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await expect(page.locator(".team-page__own")).toContainText("68");
  await page.getByRole("button", { name: "Plantilla", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("12");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("MVP con datos reales gratuitos de los cuatro equipos", async ({ page }) => {
  test.skip(process.env.AETHERIO_SPORTS_LIVE !== "1", "Live upstream check is opt-in, not a network dependency for CI");
  test.setTimeout(180_000);
  await setup(page, false, true);
  for (const [id, name] of [["club:man-city", "Manchester City"], ["club:man-utd", "Manchester United"], ["club:fl-alianza-lima", "Alianza Lima"], ["club:fl-atletico-grau", "Atlético Grau"]]) {
    await page.goto(`/big-picture/sports/team/${encodeURIComponent(id)}`);
    await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.locator(".team-page__own").first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (name === "Manchester City") await expect(page.getByRole("complementary", { name: "Datos del club" })).toContainText("Wikidata (Q50602)", { timeout: 25_000 });
    if (name === "Alianza Lima") {
      await expect(page.getByRole("heading", { name: "Acumulada · Liga 1" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Clausura", exact: true })).toBeAttached();
      await expect(page.getByRole("heading", { name: "Apertura", exact: true })).toBeAttached();
    }
    await page.screenshot({ path: `.impeccable/review/sports-team-page/live-${id.replace(/:/g, "-")}.png`, animations: "disabled" });
    await page.getByRole("button", { name: "Alineación", exact: true }).click();
    await expect(page.locator(".team-page__players li")).toHaveCount(11);
    if (name === "Alianza Lima") await page.screenshot({ path: ".impeccable/review/sports-team-page/live-alianza-lineup.png", animations: "disabled" });
    await page.getByRole("button", { name: "Plantilla", exact: true }).click();
    expect(await page.getByRole("row").count()).toBeGreaterThan(20);
    await expect.poll(() => page.locator(".team-page__photo img").first().evaluate(element => (element as HTMLImageElement).naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
    if (name === "Alianza Lima") await page.screenshot({ path: ".impeccable/review/sports-team-page/live-alianza-squad.png", animations: "disabled" });
    await page.getByRole("button", { name: "Títulos", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
    if (name !== "Manchester United") await expect(page.getByText(/Registro parcial de FotMob/)).toBeVisible();
    if (name === "Alianza Lima") await page.screenshot({ path: ".impeccable/review/sports-team-page/live-alianza-honours.png", animations: "disabled" });
  }
});
