import { expect, test, type Page } from "@playwright/test";
import { fotmobTeamFixture } from "../src/services/__fixtures__/fotmobTeam";

async function setup(page: Page, offline = false, liveData = false, multipleStandings = false) {
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
    await page.route("**/api/sports-data/fotmob/**", route => {
      if (offline) return route.fulfill({ status: 503, json: {} });
      const payload = fotmobTeamFixture(10260, "Manchester United", false);
      if (multipleStandings) {
        const table = payload.table[0].data as { tables?: unknown[]; table?: { all?: Record<string, unknown>[] } };
        const row = table.table?.all?.[0];
        if (row) table.tables = ["UEFA Champions League", "FA Cup"].map((leagueName, index) => ({
          leagueName,
          table: { all: [{ ...row, id: 300 + index, name: `Equipo de ${leagueName}` }] },
        }));
      }
      return route.fulfill({ json: payload });
    });
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
  await expect(page.locator(".team-page__own .team-page__standing-mark img")).toBeAttached();
  await expect(page.getByRole("complementary", { name: "Datos del club" })).toContainText("Wikidata");
  await expect(page.getByText(/Fundación registrada/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gestionar mis equipos" })).toHaveCount(0);
  for (const [width, height, name] of [[1920, 1080, "desktop"], [900, 720, "minimum"], [390, 844, "narrow"]] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `.impeccable/review/sports-team-page/${name}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator(".team-page").evaluate(page => {
    const filler = document.createElement("div");
    filler.style.height = "1200px";
    page.append(filler);
  });
  const shell = page.locator("[data-aetherio-scroll-shell]").first();
  await shell.evaluate(element => { element.scrollTop = 300; });
  const tableRegion = page.locator(".team-page__table-scroll").first();
  await tableRegion.focus();
  await tableRegion.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })));
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBe(0);
  await page.getByRole("button", { name: "Alineación", exact: true }).click();
  await expect(page.getByText("Última alineación publicada", { exact: false })).toBeVisible();
  await expect(page.getByText("Jugador de prueba", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plantilla", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("Perú");
  await page.getByRole("button", { name: "Partidos", exact: true }).click();
  await expect(page.getByText("2 – 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Títulos", exact: true }).click();
  await expect(page.locator(".team-page__trophy").filter({ hasText: "Copa de Europa / Champions League" })).toBeVisible();
  await expect(page.locator(".team-page__trophy-win")).not.toHaveCount(0);
  await expect(page.getByRole("button", { name: "Volver a Deportes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reintentar datos" })).toHaveCount(0);
  await expect(page.locator(".team-page")).not.toContainText(/FotMob/i);
  const pressBumper = (id: "lb" | "rb") => page.evaluate(action => {
    window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: action } }));
  }, id);
  await page.getByRole("button", { name: "Clasificación", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Alineación", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Alineación", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Plantilla", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Plantilla", exact: true })).toHaveAttribute("aria-current", "page");
  await pressBumper("lb");
  await expect(page.getByRole("button", { name: "Plantilla", exact: true })).toHaveAttribute("aria-current", "page");
  await pressBumper("rb");
  await expect(page.getByRole("button", { name: "Plantilla", exact: true })).toHaveAttribute("aria-current", "page");
});

test("el perfil y las fichas de equipos permanecen en la app de Deportes", async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await page.getByRole("region", { name: "Mis equipos", exact: true }).getByRole("button", { name: "Manchester United", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Manchester United", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Navegación de Deportes", exact: true });
  await navigation.hover();
  await expect(navigation.getByRole("button", { name: "Volver a Aetherio", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Listas IPTV", exact: true })).toHaveCount(0);
  await navigation.getByRole("button", { name: "Abrir ajustes del perfil", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports\/settings$/);
  await expect(page.locator("[data-bp-settings]")).toBeVisible();
  await expect(navigation).toBeVisible();
});

test("un fallo de carga muestra un mensaje claro", async ({ page }) => {
  await setup(page, true);
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudieron cargar los datos del equipo");
  await expect(page.getByRole("button", { name: "Reintentar datos" })).toHaveCount(0);
  await expect(page.locator(".team-page")).not.toContainText(/FotMob/i);
  await page.getByRole("button", { name: "Títulos", exact: true }).click();
  await expect(page.locator(".team-page__trophy").first()).toBeVisible();
});

test("la cruceta selecciona paneles sin desplazar la página; A expande el mismo panel y deja recorrer los equipos", async ({ page }) => {
  await setup(page, false, false, true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const panel = page.locator(".team-page__group").first();
  const adjacentPanel = page.locator(".team-page__group").nth(1);
  const table = panel.locator(".team-page__table-scroll");
  const shell = page.locator(".big-picture__scroll");
  await table.locator("tbody").evaluate(tbody => {
    const template = tbody.querySelector("tr");
    if (!template) return;
    for (let index = 0; index < 18; index += 1) {
      const row = template.cloneNode(true) as HTMLTableRowElement;
      row.classList.remove("team-page__own");
      row.removeAttribute("aria-current");
      row.dataset.standingRowId = `${template.dataset.standingRowId ?? "fixture-row"}-clone-${index + 1}`;
      row.cells[0].textContent = String(index + 2);
      row.querySelector(".team-page__standing-name")?.replaceChildren(document.createTextNode(`Club de prueba ${index + 1}`));
      tbody.append(row);
    }
  });
  await shell.evaluate(element => { (element as HTMLElement).scrollTop = 120; });
  await page.locator(".team-page__nav button[aria-current='page']").evaluate(element => (element as HTMLElement).focus({ preventScroll: true }));
  const scrollBeforeSelection = await shell.evaluate(element => (element as HTMLElement).scrollTop);
  expect(scrollBeforeSelection).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "open-controls" } })));
  await expect(panel).toHaveAttribute("data-panel-selected", "true");
  await expect(panel).not.toHaveAttribute("data-panel-focused", "true");
  await expect(page.locator(".team-page__focus-backdrop")).toHaveCount(0);
  const selectedStyle = await panel.evaluate(element => {
    const style = getComputedStyle(element);
    return { outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineColor: style.outlineColor, background: style.backgroundColor };
  });
  expect(selectedStyle.outlineWidth).toBe("3px");
  expect(selectedStyle.outlineOffset).toBe("-2px");
  expect(selectedStyle.outlineColor).toContain("255, 255, 255");
  await expect.poll(() => shell.evaluate(element => (element as HTMLElement).scrollTop)).toBe(scrollBeforeSelection);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "dpad-right" } })));
  await expect(adjacentPanel).toHaveAttribute("data-panel-selected", "true");
  await expect(panel).not.toHaveAttribute("data-panel-selected", "true");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "dpad-left" } })));
  await expect(panel).toHaveAttribute("data-panel-selected", "true");

  const originalPanel = await panel.elementHandle();
  const selectedBounds = await panel.boundingBox();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "confirm" } })));
  await expect(panel).toHaveAttribute("data-panel-focused", "true");
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-modal", "true");
  await expect(page.locator(".team-page__focus-backdrop")).toBeVisible();
  await expect(panel).toHaveCSS("outline-style", "none");
  await expect(panel.locator(".team-page__panel-close")).toHaveCount(0);
  await expect.poll(() => panel.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(selectedStyle.background);
  expect(await originalPanel?.evaluate(element => element === document.querySelector('[data-panel-focused="true"]'))).toBe(true);
  await expect.poll(() => table.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe("none");
  expect(selectedBounds).not.toBeNull();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(selectedBounds!.width + 10);
  await expect.poll(async () => {
    const bounds = await panel.boundingBox();
    return !!bounds
      && Math.abs(bounds.x + bounds.width / 2 - 960) < 3
      && Math.abs(bounds.y + bounds.height / 2 - 540) < 3;
  }).toBe(true);
  const desktopBounds = await panel.boundingBox();
  expect(desktopBounds).not.toBeNull();
  expect(Math.abs(desktopBounds!.x + desktopBounds!.width / 2 - 960)).toBeLessThan(3);
  expect(Math.abs(desktopBounds!.y + desktopBounds!.height / 2 - 540)).toBeLessThan(3);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await panel.boundingBox();
  expect(mobileBounds).not.toBeNull();
  expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
  expect(mobileBounds!.y).toBeGreaterThanOrEqual(0);
  expect(mobileBounds!.y + mobileBounds!.height).toBeLessThanOrEqual(844);
  await page.setViewportSize({ width: 1920, height: 1080 });

  await table.evaluate(element => { (element as HTMLElement).scrollTop = 0; });
  const standingRows = table.locator("tbody tr");
  const rowIds = await standingRows.evaluateAll(rows => rows.map(row => row.getAttribute("data-standing-row-id")));
  expect(rowIds.every(Boolean)).toBe(true);
  expect(new Set(rowIds).size).toBe(rowIds.length);
  const ownRow = table.locator("tbody tr.team-page__own");
  await expect(ownRow).toHaveAttribute("data-standing-focused", "true");
  await expect(ownRow).toBeFocused();

  const moveExpandedPanel = (id: "dpad-left" | "dpad-right", source: "stick" | "dpad") => page.evaluate(({ id, source }) => {
    window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id, source } }));
  }, { id, source });
  await moveExpandedPanel("dpad-right", "stick");
  await expect(panel).not.toHaveAttribute("data-panel-focused", "true");
  await expect(adjacentPanel).toHaveAttribute("data-panel-focused", "true");
  await expect(page.locator(".team-page__focus-backdrop")).toBeVisible();
  await moveExpandedPanel("dpad-left", "stick");
  await expect(panel).toHaveAttribute("data-panel-focused", "true");
  await expect(adjacentPanel).not.toHaveAttribute("data-panel-focused", "true");
  await moveExpandedPanel("dpad-right", "dpad");
  await expect(adjacentPanel).toHaveAttribute("data-panel-focused", "true");
  await moveExpandedPanel("dpad-left", "dpad");
  await expect(panel).toHaveAttribute("data-panel-focused", "true");
  await expect(ownRow).toBeFocused();

  const initialFocusIndex = await standingRows.evaluateAll(rows => rows.findIndex(row => row.hasAttribute("data-standing-focused")));
  const focusTweenStyle = await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "dpad-down", source: "dpad" } }));
    const focusedRow = document.querySelector<HTMLTableRowElement>("[data-standing-focused='true']");
    return focusedRow?.cells[0]?.style.backgroundColor ?? "";
  });
  expect(focusTweenStyle).not.toBe("");
  await expect.poll(() => standingRows.evaluateAll(rows => rows.findIndex(row => row.hasAttribute("data-standing-focused")))).toBe(initialFocusIndex + 1);
  await expect(standingRows.nth(initialFocusIndex + 1)).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "dpad-up", source: "dpad" } })));
  await expect.poll(() => standingRows.evaluateAll(rows => rows.findIndex(row => row.hasAttribute("data-standing-focused")))).toBe(initialFocusIndex);
  const lastRowIndex = await standingRows.count() - 1;
  for (let index = initialFocusIndex; index < lastRowIndex; index += 1) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "dpad-down", source: "dpad" } })));
  }
  await expect.poll(() => table.evaluate(element => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => standingRows.evaluateAll(rows => rows.findIndex(row => row.hasAttribute("data-standing-focused")))).toBe(lastRowIndex);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "back" } })));
  await expect(panel).not.toHaveAttribute("data-panel-focused", "true");
  await expect(panel).toHaveAttribute("data-panel-selected", "true");
  await expect(page.locator(".team-page__focus-backdrop")).toHaveCount(0);
  await expect.poll(() => panel.evaluate(element => document.activeElement === element)).toBe(true);
});

test("el palmarés se selecciona con clic, se expande con A y se cierra tocando la capa oscura", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await page.getByRole("button", { name: "Títulos", exact: true }).click();

  const panel = page.locator(".team-page__honours");
  await panel.click();
  await expect(panel).toHaveAttribute("data-panel-selected", "true");
  await expect(panel).not.toHaveAttribute("data-panel-focused", "true");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "confirm" } })));
  await expect(panel).toHaveAttribute("data-panel-focused", "true");
  const trophySections = panel.locator(".team-page__trophy");
  const trophySectionCount = await trophySections.count();
  expect(trophySectionCount).toBeGreaterThan(1);
  await expect(trophySections.first()).toHaveAttribute("data-trophy-focused", "true");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", {
    cancelable: true,
    detail: { id: "dpad-right", source: "dpad" },
  })));
  await expect(trophySections.nth(1)).toHaveAttribute("data-trophy-focused", "true");
  await expect(trophySections.nth(1)).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", {
    cancelable: true,
    detail: { id: "dpad-left", source: "stick" },
  })));
  await expect(trophySections.first()).toHaveAttribute("data-trophy-focused", "true");
  for (let index = 1; index < trophySectionCount; index += 1) {
    await page.evaluate(source => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", {
      cancelable: true,
      detail: { id: "dpad-right", source },
    })), index % 2 ? "stick" : "dpad");
    await expect(trophySections.nth(index)).toHaveAttribute("data-trophy-focused", "true");
  }
  await expect.poll(() => panel.evaluate(element => (element as HTMLElement).scrollTop)).toBeGreaterThan(0);
  await page.locator(".team-page__focus-backdrop").click({ position: { x: 10, y: 10 } });
  await expect(panel).not.toHaveAttribute("data-panel-focused", "true");
});

test("la plantilla es un panel expansible con navegación por jugadores", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Manchester United", exact: true }).click();
  await page.getByRole("button", { name: "Plantilla", exact: true }).click();

  const panel = page.locator(".team-page__squad");
  const rows = panel.locator("tbody tr");
  const tableRegion = panel.getByRole("region", { name: "Jugadores de Manchester United" });
  await expect(panel).toHaveAttribute("role", "region");
  await expect(panel.getByRole("table")).toContainText("Jugador");
  await expect(rows).not.toHaveCount(0);
  await page.screenshot({ path: ".impeccable/review/sports-team-page/roster-desktop.png", animations: "disabled" });

  await panel.click();
  await expect(panel).toHaveAttribute("data-panel-selected", "true");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "confirm" } })));
  await expect(panel).toHaveAttribute("data-panel-focused", "true");
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(rows.first()).toHaveAttribute("data-standing-focused", "true");
  await expect(rows.first()).toBeFocused();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "dpad-down" } })));
  await expect(rows.nth(1)).toHaveAttribute("data-standing-focused", "true");
  await expect(rows.nth(1)).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => tableRegion.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(panel.getByText("Desliza horizontalmente para ver el resto de columnas.")).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/sports-team-page/roster-mobile.png", animations: "disabled" });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "back" } })));
  await expect(panel).not.toHaveAttribute("data-panel-focused", "true");
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
    if (name !== "Manchester United") await expect(page.getByText(/Registro parcial:/)).toBeVisible();
    if (name === "Alianza Lima") await page.screenshot({ path: ".impeccable/review/sports-team-page/live-alianza-honours.png", animations: "disabled" });
  }
});
