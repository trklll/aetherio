import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, offline = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let id = 1;
    Object.assign(window, { __TAURI_INTERNALS__: { transformCallback: () => id++, invoke: async (command: string) => command.startsWith("plugin:event|") ? id++ : null, convertFileSrc: (value: string) => value, metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {} }, __TAURI__: { event: { listen: async () => () => undefined } } });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: "team-page", name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", "team-page");
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1, iptvProvidersVersion: 1, sportsStreamsProvidersVersion: 1 }));
    localStorage.setItem("aetherio-profile:team-page:aetherio-sports-preferences", JSON.stringify({ version: 1, onboarding: "completed", sports: ["futbol"], followedCompetitions: ["comp:eng-premier"], followedClubs: ["club:man-utd"], followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos" }));
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => /127\.0\.0\.1:7310|nuviosports|highfly|stremverse/.test(String(input)) ? Promise.resolve(new Response(JSON.stringify({ metas: [], sync: { state: "idle" } }))) : original(input, init);
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
  await page.route("https://site.api.espn.com/**", route => {
    if (offline) return route.fulfill({ status: 503, json: {} });
    const url = route.request().url();
    const player = { id: "1", displayName: "Jugador de prueba", jersey: "9", age: 24, citizenship: "Perú", position: { abbreviation: "F" } };
    const event = { id: "10", date: "2026-11-01T15:00Z", name: "United vs City", timeValid: true, competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "home", team: { id: "360", displayName: "Manchester United" }, score: "2" }, { homeAway: "away", team: { id: "382", displayName: "Manchester City" }, score: "0" }] }] };
    let json: unknown = {};
    if (url.includes("/teams?")) json = { sports: [{ leagues: [{ teams: [{ team: { id: "360", displayName: "Manchester United" } }] }] }] };
    else if (url.includes("/standings")) json = { children: [{ name: "Premier League", standings: { seasonDisplayName: "2026-27", entries: [{ team: { id: "360", displayName: "Manchester United" }, stats: [{ name: "rank", value: 2 }, { name: "points", value: 21 }, { name: "gamesPlayed", value: 9 }] }] } }] };
    else if (url.endsWith("/roster")) json = { athletes: [player], season: { displayName: "2026-27" } };
    else if (url.endsWith("/schedule")) json = { events: [event] };
    else if (url.includes("/summary?")) json = { rosters: [{ team: { id: "360" }, formation: "4-3-3", roster: [{ starter: true, athlete: player, jersey: "9" }] }] };
    return route.fulfill({ json });
  });
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
  await expect(page.locator(".team-page__own")).toContainText("21");
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

test("fallo de ESPN muestra recuperación sin inventar datos", async ({ page }) => {
  await setup(page, true);
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No pudimos conectar con ESPN");
  await expect(page.getByRole("button", { name: "Reintentar datos" })).toBeEnabled();
  await page.getByRole("button", { name: "Títulos", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
});
