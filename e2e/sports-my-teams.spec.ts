import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, teams = ["club:liverpool", "club:ajax", "club:real-madrid"], competitions = ["comp:esp-laliga"]) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ teams, competitions }: { teams: string[]; competitions: string[] }) => {
    let id = 1;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: () => id++,
        invoke: async (command: string) => command === "start_nuvio_sports_server"
          ? { ready: true, running: true, port: 7310, pid: 1 } : command.startsWith("plugin:event|") ? id++ : null,
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {},
      }, __TAURI__: { event: { listen: async () => () => undefined } },
    });
    const profile = "my-teams-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: profile, name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", profile);
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1 }));
    const event = { id: "teams-live", title: "Real Madrid vs Barcelona", sport: "Football", league: "LaLiga", status: "live",
      startsAt: new Date(Date.now() - 600_000).toISOString(), home: { name: "Real Madrid" }, away: { name: "FC Barcelona" },
      sources: [{ id: "one", label: "Local", url: "https://sports.test/live.m3u8" }] };
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify([event]));
    localStorage.setItem("aetherio-live-sports-snapshot", JSON.stringify({ events: [event], upcoming: [], channels: [], fetchedAt: Date.now() }));
    localStorage.setItem(`aetherio-profile:${profile}:aetherio-sports-preferences`, JSON.stringify({
      version: 1, onboarding: "completed", sports: ["futbol"], followedCompetitions: competitions, followedClubs: teams,
      followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos",
    }));
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/127\.0\.0\.1:7310|nuviosports|highfly|stremverse/.test(url)) return Promise.resolve(new Response(JSON.stringify({ metas: [], sync: { state: "idle" } })));
      return fetch(input, init);
    };
  }, { teams, competitions });
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
  await page.goto("/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
}

test("Mis equipos es la segunda fila y usa solo los equipos guardados", async ({ page }) => {
  await setup(page);
  await expect(page.locator("[data-bp-sports] .home-row-title")).toHaveText(["Ahora mismo", "Equipos que sigues", "Competiciones que sigues"]);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await expect(row.locator(".sports-team-card__title")).toHaveText(["Liverpool", "Ajax", "Real Madrid", "Añadir"]);
  await expect(row.locator(".sports-team-card").nth(2).locator(".sports-team-card__metadata")).toContainText("En directo");
  await expect(row.locator(".sports-team-card").nth(0).locator(".sports-team-card__metadata")).toContainText("Sin próximos partidos");
  for (const image of await row.locator("img").all()) {
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const bounds = await image.evaluate(element => {
      const image = element.getBoundingClientRect();
      const crest = element.parentElement!.getBoundingClientRect();
      return { width: image.width, height: image.height, crestWidth: crest.width, crestHeight: crest.height };
    });
    expect(bounds.width).toBeLessThanOrEqual(bounds.crestWidth + 1);
    expect(bounds.height).toBeLessThanOrEqual(bounds.crestHeight + 1);
  }
});

test("Competiciones que sigues muestra las guardadas y permite añadir sin tocar los equipos", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("region", { name: "Competiciones que sigues", exact: true });
  await expect(row.locator(".sports-team-card__title")).toHaveText(["LaLiga", "Añadir"]);
  await row.getByRole("button", { name: "Añadir competiciones" }).click();
  const dialog = page.getByRole("dialog", { name: "Competiciones que sigues" });
  await dialog.getByRole("searchbox", { name: "Buscar competiciones" }).fill("Premier League");
  await dialog.getByRole("button", { name: /Premier League, Fútbol · Inglaterra/ }).click();
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(row.locator(".sports-team-card__title")).toHaveText(["LaLiga", "Premier League", "Añadir"]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aetherio-profile:my-teams-e2e:aetherio-sports-preferences")!));
  expect(saved.followedCompetitions).toEqual(["comp:esp-laliga", "comp:eng-premier"]);
  expect(saved.followedClubs).toEqual(["club:liverpool", "club:ajax", "club:real-madrid"]);
});

test("la sidebar muestra las competiciones seguidas y lleva a su tarjeta", async ({ page }) => {
  await setup(page, undefined, ["comp:esp-laliga", "comp:uefa-conference"]);
  const rail = page.locator(".bp-rail");
  await rail.hover();
  await expect(rail.locator(".bp-rail__section-title")).toHaveText("Competiciones");
  const laLiga = rail.getByRole("button", { name: "LaLiga", exact: true });
  await expect(laLiga).toBeVisible();
  await expect(laLiga.locator(".bp-rail__item-label")).toBeVisible();
  await expect(laLiga.locator(".bp-rail__item-label")).toHaveText("LaLiga");
  await expect(laLiga.locator("img")).toBeVisible();
  await expect(laLiga.locator("img")).toHaveAttribute("src", /la-liga--no-text\.dfa1dfcb\.png$/);
  await expect.poll(() => laLiga.locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const conferenceLabel = rail.getByRole("button", { name: "UEFA Conference League", exact: true }).locator(".bp-rail__item-label");
  await expect(conferenceLabel).toBeVisible();
  await expect(conferenceLabel).toHaveText("UEFA Conference League");
  const conferenceLabelBounds = await conferenceLabel.evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(conferenceLabelBounds.scrollWidth).toBeLessThanOrEqual(conferenceLabelBounds.clientWidth + 1);
  expect(conferenceLabelBounds.scrollHeight).toBeLessThanOrEqual(conferenceLabelBounds.clientHeight + 1);
  await expect(rail.getByText("Plataformas", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Listas IPTV", { exact: true })).toHaveCount(0);

  await rail.getByRole("button", { name: "LaLiga", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports#competicion=comp%3Aesp-laliga$/);
  await expect(page.getByRole("region", { name: "Competiciones que sigues", exact: true })
    .getByRole("button", { name: /LaLiga/ })).toBeFocused();
});

test("Añadir guarda los elegidos sin alterar competiciones y permite cancelar", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  const dialog = page.getByRole("dialog", { name: "Mis equipos" });
  await dialog.getByRole("searchbox", { name: "Buscar equipos" }).fill("Arsenal");
  await dialog.getByRole("button", { name: "Arsenal", exact: true }).click();
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Arsenal", exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("aetherio-profile:my-teams-e2e:aetherio-sports-preferences")!));
  expect(saved.followedClubs).toEqual(["club:liverpool", "club:ajax", "club:real-madrid", "club:arsenal"]);
  expect(saved.followedCompetitions).toEqual(["comp:esp-laliga"]);
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  await dialog.getByRole("searchbox", { name: "Buscar equipos" }).fill("Ajax");
  await dialog.getByRole("button", { name: "Ajax", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(row.getByRole("button", { name: "Ajax", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Añadir equipos" })).toBeFocused();
});

test("sin favoritos ofrece Añadir sin inventar equipos; el escudo fallido usa iniciales", async ({ page }) => {
  await page.route("**/assets/football-logos/clubs/**", route => route.fulfill({ status: 503, body: "offline" }));
  await setup(page, []);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await expect(row.locator(".sports-team-card")).toHaveCount(1);
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  const dialog = page.getByRole("dialog", { name: "Mis equipos" });
  await dialog.getByRole("searchbox", { name: "Buscar equipos" }).fill("Ajax");
  await dialog.getByRole("button", { name: "Ajax", exact: true }).click();
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(row.locator(".sports-team-card__initials")).toHaveText("AJA");
  await expect(row.locator("img")).toHaveCount(0);
});

test("teclado recorre los equipos y un partido en directo conserva el reproductor", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  const first = page.locator('[data-row-key*="sports-now"] button').first();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(row.getByRole("button", { name: "Liverpool", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(row.getByRole("button", { name: "Ajax", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const teamPage = page.getByRole("main", { name: "Equipo Real Madrid", exact: true });
  await expect(teamPage).toContainText("Real Madrid vs Barcelona");
  await teamPage.getByRole("button", { name: /Ver en directo/ }).click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=teams-live/);
  await page.goBack();
  await expect(page).toHaveURL(/\/big-picture\/sports\/team\//);
  await page.goBack();
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  const liveCard = page.locator('[data-row-key*="sports-now"] .sports-match-card__frame').first();
  await expect(row.getByRole("button", { name: "Real Madrid", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(liveCard).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row.getByRole("button", { name: "Real Madrid", exact: true })).toBeFocused();
});

test("volver de un equipo lejano permite bajar a su posición virtualizada", async ({ page }) => {
  await setup(page);
  const target = await page.evaluate(async () => {
    const catalogUrl = "/src/data/sports/catalog.ts";
    const preferencesUrl = "/src/data/sports/preferences.ts";
    const { SPORTS_ENTITY_BY_ID } = await import(catalogUrl);
    const { patchSportsPreferences } = await import(preferencesUrl);
    const teams = [...SPORTS_ENTITY_BY_ID.values()].filter((entity: { kind: string }) => entity.kind === "club").slice(0, 100);
    patchSportsPreferences({ followedClubs: teams.map((entity: { id: string }) => entity.id) });
    return teams[60].name as string;
  });
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await expect(row).toHaveAttribute("data-row-count", "101");
  await row.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 60 * 451; });
  const team = row.getByRole("button", { name: target, exact: true });
  await expect(team).toBeVisible();
  await team.focus();
  const savedHorizontal = await row.locator("[data-row-scroller]").evaluate(element => element.scrollLeft);
  const shell = page.locator("[data-aetherio-scroll-shell]").first();
  const savedVertical = await shell.evaluate(element => element.scrollTop);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/sports\/team\//);
  await page.goBack();
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  const first = page.locator('[data-row-key*="sports-now"] .sports-match-card__frame').first();
  await expect(team).toBeFocused();
  await expect.poll(() => row.locator("[data-row-scroller]").evaluate(element => element.scrollLeft)).toBe(savedHorizontal);
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBe(savedVertical);
  await page.keyboard.press("ArrowUp");
  await expect(first).toBeFocused();
  // Even if an inactive rail is moved back to its origin, the engine must
  // still be able to reveal its remembered item using unscaled coordinates.
  await row.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 0; });
  await expect(team).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(team).toBeFocused();
});

test("selecciones y cambios de perfil reutilizan las preferencias aisladas", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  const dialog = page.getByRole("dialog", { name: "Mis equipos" });
  await dialog.getByRole("searchbox", { name: "Buscar equipos" }).fill("España");
  await dialog.getByRole("button", { name: "España", exact: true }).click();
  await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(row.getByRole("button", { name: "España", exact: true })).toBeVisible();
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  await page.evaluate(async () => {
    const prefs = JSON.parse(localStorage.getItem("aetherio-profile:my-teams-e2e:aetherio-sports-preferences")!);
    const profilesUrl = "/src/utils/localProfiles.ts";
    const preferencesUrl = "/src/data/sports/preferences.ts";
    const { getLocalProfiles, setActiveProfile, writeLocalProfilesForTest } = await import(profilesUrl);
    const { saveSportsPreferences } = await import(preferencesUrl);
    writeLocalProfilesForTest([...getLocalProfiles(), { id: "other", name: "Other", createdAt: 2, updatedAt: 2 }]);
    setActiveProfile("other");
    saveSportsPreferences({ ...prefs, followedClubs: ["club:arsenal"], followedNationalTeams: [] });
  });
  await expect(dialog).toHaveCount(0);
  await expect(row.locator(".sports-team-card__title")).toHaveText(["Arsenal", "Añadir"]);
  const firstProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("aetherio-profile:my-teams-e2e:aetherio-sports-preferences")!));
  expect(firstProfile.followedNationalTeams).toEqual(["nt:espana"]);
});

test("más de 200 equipos mantienen Añadir al final sin montar toda la colección", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const catalogUrl = "/src/data/sports/catalog.ts";
    const prefsUrl = "/src/data/sports/preferences.ts";
    const { SPORTS_ENTITY_BY_ID } = await import(catalogUrl);
    const { patchSportsPreferences } = await import(prefsUrl);
    const teams = [...SPORTS_ENTITY_BY_ID.values()].filter((entity: { kind: string }) => entity.kind === "club").slice(0, 205);
    patchSportsPreferences({ followedClubs: teams.map((entity: { id: string }) => entity.id) });
  });
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await expect(row).toHaveAttribute("data-row-count", "206");
  expect(await row.locator(".sports-team-card").count()).toBeLessThan(20);
  await row.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(row.getByRole("button", { name: "Añadir equipos" })).toBeVisible();
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  await expect(page.getByRole("dialog", { name: "Mis equipos" })).toBeVisible();
});

test("capturas de Mis equipos en los tamaños de ventana existentes", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("region", { name: "Mis equipos", exact: true });
  await expect(row).toBeVisible();
  for (const [width, height, name] of [[1920, 1080, "desktop"], [1280, 720, "user-1280"], [900, 600, "minimum-900"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.mouse.move(0, 0);
    await page.evaluate(() => { document.querySelector<HTMLElement>(".big-picture__scroll")!.scrollTop = 0; });
    await page.screenshot({ path: `.impeccable/review/sports-my-teams/${name}.png`, fullPage: true, animations: "disabled" });
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(".sports-teams-row")!;
      const shell = document.querySelector<HTMLElement>(".big-picture__scroll")!;
      shell.scrollTop += row.getBoundingClientRect().top - shell.getBoundingClientRect().top - 130;
    });
    await page.screenshot({ path: `.impeccable/review/sports-my-teams/row-${name}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await row.getByRole("button", { name: "Añadir equipos" }).click();
  await page.getByRole("searchbox", { name: "Buscar equipos" }).fill("Madrid");
  await page.screenshot({ path: ".impeccable/review/sports-my-teams/selection.png", animations: "disabled" });
});
