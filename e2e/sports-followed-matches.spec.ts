import { expect, test, type Page } from "@playwright/test";
import { fotmobTeamFixture } from "../src/services/__fixtures__/fotmobTeam";

// The cold Vite graph includes the shared desktop shell and the Sports providers.
test.setTimeout(60_000);

const teams = ["club:real-madrid", "club:barcelona", "club:fl-alianza-lima", "club:fl-atletico-grau"];
const names: Record<string, string> = { "8633": "Real Madrid", "8634": "FC Barcelona", "6398": "Alianza Lima", "920789": "Atlético Grau" };
const game = (id: number, homeId: number, home: string, awayId: number, away: string, day: number, league = "LaLiga", finished = false) => ({
  id, home: { id: homeId, name: home }, away: { id: awayId, name: away }, league: { id: league === "LaLiga" ? 87 : 131, name: league },
  status: { utcTime: `2026-11-${String(day).padStart(2, "0")}T20:00:00Z`, started: finished, finished, ...(finished ? { scoreStr: "2 - 1" } : {}) },
});
const fixtures = [game(1, 10267, "Valencia", 8633, "Real Madrid", 7), game(2, 8633, "Real Madrid", 8634, "FC Barcelona", 8),
  game(3, 920789, "Atlético Grau", 6398, "Alianza Lima", 8, "Liga 1"), game(4, 6398, "Alianza Lima", 200, "Rival", 6, "Liga 1", true),
  game(5, 8634, "FC Barcelona", 10267, "Valencia", 9)];

async function setup(page: Page, options: { empty?: boolean; offline?: boolean; partial?: boolean; playable?: boolean; reference?: boolean; freezeTime?: boolean } = {}) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (options.freezeTime !== false) await page.clock.setFixedTime(new Date("2026-11-07T18:00:00Z"));
  await page.addInitScript(({ teams, empty, playable }) => {
    let id = 1;
    Object.assign(window, { __TAURI_INTERNALS__: { transformCallback: () => id++, invoke: async (command: string, args?: { request?: { url: string } }) => {
      if (command === "provider_http_request" && args?.request) {
        const url = new URL(args.request.url);
        const response = await fetch(`/api/sports-data/fotmob${url.pathname.replace("/api/data", "")}${url.search}`);
        const binary = [...new Uint8Array(await response.arrayBuffer())].map(byte => String.fromCharCode(byte)).join("");
        return { status: response.status, bodyBase64: btoa(binary), url: args.request.url };
      }
      if (command === "start_nuvio_sports_server") return { ready: true, running: true, port: 7310, pid: 1 };
      return command.startsWith("plugin:event|") ? id++ : null;
    }, convertFileSrc: (value: string) => value, metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {} }, __TAURI__: { event: { listen: async () => () => undefined } } });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: "followed-matches", name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", "followed-matches");
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1, iptvProvidersVersion: 1, sportsStreamsProvidersVersion: 1 }));
    const events = playable ? [{ id: "preview-live", title: "Real Madrid vs FC Barcelona", sport: "Football", league: "LaLiga", status: "live", startsAt: "2026-11-08T20:00:00Z", startsAtPrecision: "exact", home: { name: "Real Madrid" }, away: { name: "FC Barcelona" }, sources: [{ id: "match-source", label: "Local", url: "https://sports.test/live.m3u8" }] }] : [];
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify(events));
    localStorage.setItem("aetherio-live-sports-snapshot", JSON.stringify({ events, upcoming: [], channels: [], fetchedAt: Date.now() }));
    localStorage.setItem("aetherio-profile:followed-matches:aetherio-sports-preferences", JSON.stringify({ version: 1, onboarding: "completed", sports: ["futbol"], followedCompetitions: ["comp:esp-laliga"], followedClubs: empty ? [] : teams, followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos" }));
    const original = window.fetch.bind(window);
    window.fetch = (input, init) => /127\.0\.0\.1:7310|nuviosports|highfly|stremverse/.test(String(input)) ? Promise.resolve(new Response(JSON.stringify({ metas: [], sync: { state: "idle" } }))) : original(input, init);
  }, { teams: options.reference ? ["club:fl-sd-eibar", "club:fl-real-sociedad"] : teams, empty: options.empty, playable: options.playable });
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
  await page.route("**/api/sports-data/fotmob/**", async route => {
    if (options.offline || (options.partial && route.request().url().includes("6398"))) return route.fulfill({ status: 503, json: {} });
    const url = new URL(route.request().url());
    const fixtureNames = options.reference ? { "8372": "SD Eibar", "8560": "Real Sociedad" } : names;
    if (url.pathname.endsWith("/suggest")) {
      const term = url.searchParams.get("term");
      return route.fulfill({ json: [{ suggestions: Object.entries(fixtureNames).filter(([, name]) => name === term).map(([id, name]) => ({ id, name, type: "team" })) }] });
    }
    const id = url.searchParams.get("id") ?? "8633";
    const payload = fotmobTeamFixture(Number(id), fixtureNames[id], ["6398", "920789"].includes(id));
    if (id === "8633" || id === "8634") {
      payload.details.country = "ESP";
      // Synthetic standings for repeatable visual/interaction tests, never production data.
      payload.table = [{ data: { leagueId: 87, leagueName: "LaLiga", table: { all: [
        { id: 8634, name: "FC Barcelona", idx: 1, pts: 30, played: 11, wins: 10, draws: 0, losses: 1, scoresStr: "34-0", goalConDiff: 34 },
        { id: 9906, name: "Atlético Madrid", idx: 2, pts: 28, played: 11, wins: 9, draws: 1, losses: 1, scoresStr: "25-11", goalConDiff: 14 },
        { id: 8633, name: "Real Madrid", idx: 3, pts: 27, played: 11, wins: 9, draws: 0, losses: 2, scoresStr: "24-6", goalConDiff: 18 },
        { id: 8603, name: "Real Betis", idx: 4, pts: 23, played: 11, wins: 7, draws: 2, losses: 2, scoresStr: "18-15", goalConDiff: 3 },
        { id: 8560, name: "Real Sociedad", idx: 5, pts: 19, played: 11, wins: 6, draws: 1, losses: 4, scoresStr: "15-15", goalConDiff: 0 },
        { id: 8302, name: "Sevilla", idx: 6, pts: 18, played: 12, wins: 5, draws: 3, losses: 4, scoresStr: "17-19", goalConDiff: -2 },
        { id: 10267, name: "Valencia", idx: 7, pts: 15, played: 11, wins: 4, draws: 3, losses: 4, scoresStr: "14-15", goalConDiff: -1 },
        { id: 8315, name: "Athletic Club", idx: 8, pts: 14, played: 11, wins: 4, draws: 2, losses: 5, scoresStr: "14-18", goalConDiff: -4 },
      ] } } }];
    }
    const schedule = options.reference ? [game(6, 8372, "SD Eibar", 8560, "Real Sociedad", 7, "Segunda División")] : fixtures;
    payload.fixtures.allFixtures.fixtures = schedule.filter(match => String(match.home.id) === id || String(match.away.id) === id);
    payload.stats.players = [];
    return route.fulfill({ json: payload });
  });
  await page.goto("/big-picture/sports/teams");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.getByRole("main", { name: "Mis equipos", exact: true })).toBeVisible({ timeout: 30_000 });
}

test("página propia con Ayer, Hoy y Próximos, sin duplicar enfrentamientos", async ({ page }) => {
  await setup(page);
  const panel = page.getByRole("tabpanel");
  await expect(page.getByRole("tab", { name: "Hoy", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("table")).toHaveCount(1);
  await expect(panel).toContainText("Valencia");
  await expect(panel).toContainText("15:00");
  await expect(page.getByText("Horarios de Perú · Cuotas no disponibles por ahora.", { exact: true })).toHaveCount(0);
  await expect(page.locator(".my-teams__star")).toHaveCount(1);
  await page.getByRole("tab", { name: "Ayer", exact: true }).click();
  await expect(panel).toContainText("2 – 1");
  await expect(panel).toContainText("Finalizado");
  await page.getByRole("tab", { name: "Próximos", exact: true }).click();
  await expect(panel.getByRole("table")).toHaveCount(2);
  await expect(panel.locator("tbody tr")).toHaveCount(3);
  const dateGroup = page.locator(".my-teams__date-group").filter({ hasText: /domingo,? 8 de noviembre/i });
  await expect(dateGroup.getByRole("heading", { name: /domingo,? 8 de noviembre/i })).toBeVisible();
  await expect(dateGroup.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /domingo,? 8 de noviembre/i })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Real Madrid", exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: /Real Madrid.*FC Barcelona/ }).click();
  await expect(page.locator("[data-shell-preview]")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Real Madrid — FC Barcelona");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Atlético Grau — Alianza Lima");
});

test("sin favoritos no muestra un editor ni inventa enfrentamientos", async ({ page }) => {
  await setup(page, { empty: true });
  await expect(page.getByRole("status")).toContainText("Aún no sigues equipos");
  await expect(page.getByRole("button", { name: "Elegir equipos", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("no confunde fallo de red con agenda vacía", async ({ page }) => {
  await setup(page, { offline: true });
  await expect(page.getByRole("alert")).toContainText("No se pudo actualizar la agenda");
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  await expect(page.getByText("Ningún evento hoy", { exact: true })).toHaveCount(0);
});

test("fallo parcial conserva los partidos de los demás equipos", async ({ page }) => {
  await setup(page, { partial: true });
  await expect(page.getByRole("status")).toContainText("Alianza Lima");
  await expect(page.getByRole("tabpanel")).toContainText("Valencia");
});

test("teclado y cruceta recorren las pestañas y el contenido", async ({ page }) => {
  await setup(page);
  const today = page.getByRole("tab", { name: "Hoy", exact: true });
  await today.focus();
  await page.keyboard.press("ArrowRight");
  const upcoming = page.getByRole("tab", { name: "Próximos", exact: true });
  await expect(upcoming).toBeFocused();
  await expect(upcoming).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /Real Madrid.*FC Barcelona/ })).toBeFocused();
  await today.click();
  await today.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /Valencia.*Real Madrid/ })).toBeFocused();
});

test("LB y RB recorren Ayer, Hoy y Próximos en orden", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: "Xbox Controller", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
    (window as Window & { sportsTestPad?: typeof pad }).sportsTestPad = pad;
  });
  const press = async (index: 4 | 5) => {
    await page.evaluate(button => { (window as Window & { sportsTestPad?: { buttons: Array<{ pressed: boolean; touched: boolean; value: number }> } }).sportsTestPad!.buttons[button] = { pressed: true, touched: true, value: 1 }; }, index);
  };
  const release = async (index: 4 | 5) => {
    await page.evaluate(button => { (window as Window & { sportsTestPad?: { buttons: Array<{ pressed: boolean; touched: boolean; value: number }> } }).sportsTestPad!.buttons[button] = { pressed: false, touched: false, value: 0 }; }, index);
  };
  await press(5);
  await expect(page.getByRole("tab", { name: "Próximos", exact: true })).toHaveAttribute("aria-selected", "true");
  await release(5);
  await press(4);
  await expect(page.getByRole("tab", { name: "Hoy", exact: true })).toHaveAttribute("aria-selected", "true");
  await release(4);
  await press(4);
  await expect(page.getByRole("tab", { name: "Ayer", exact: true })).toHaveAttribute("aria-selected", "true");
  await release(4);
  await press(5);
  await expect(page.getByRole("tab", { name: "Hoy", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Hoy", exact: true })).toBeFocused();
});

test("la navegación de Deportes abre la página de Mis equipos", async ({ page }) => {
  await setup(page);
  const navigation = page.getByRole("navigation", { name: "Navegación de Deportes", exact: true });
  await navigation.hover();
  await navigation.getByRole("button", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Abrir navegación, sección actual: Inicio", exact: true })).toBeVisible();
  await navigation.hover();
  await navigation.getByRole("button", { name: "Mis equipos", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports\/teams$/);
  await expect(page.getByRole("tab", { name: "Hoy", exact: true })).toBeVisible();
});

test("el cambio de perfil cierra la shell y no hereda los enfrentamientos", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("tabpanel")).toContainText("Valencia");
  await page.getByRole("button", { name: /Valencia.*Real Madrid/ }).click();
  await expect(page.locator("[data-shell-preview]")).toBeVisible();
  await page.evaluate(async () => {
    const profilesUrl = "/src/utils/localProfiles.ts";
    const prefsUrl = "/src/data/sports/preferences.ts";
    const { getLocalProfiles, setActiveProfile, writeLocalProfilesForTest } = await import(profilesUrl);
    const { defaultSportsPreferences, saveSportsPreferences } = await import(prefsUrl);
    writeLocalProfilesForTest([...getLocalProfiles(), { id: "empty-profile", name: "Otro", createdAt: 2, updatedAt: 2 }]);
    setActiveProfile("empty-profile");
    saveSportsPreferences({ ...defaultSportsPreferences(), onboarding: "completed" });
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tabpanel")).toContainText("Aún no sigues equipos");
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("la shell reutilizada se expande al enfrentamiento y vuelve a la fila completa", async ({ page }) => {
  await setup(page);
  const row = page.getByRole("button", { name: /Valencia.*Real Madrid/ });
  await row.click();
  const shell = page.locator("[data-shell-preview]");
  const detail = page.frameLocator('iframe[title="Detalle de Valencia — Real Madrid"]');
  await expect(detail.getByRole("main", { name: "Valencia — Real Madrid", exact: true })).toBeVisible();
  const dateTop = await detail.locator(".sports-match__date").evaluate(element => element.getBoundingClientRect().top);
  expect(dateTop).toBeGreaterThanOrEqual(112);
  const kickoffButton = detail.getByRole("button", { name: "Comienza en 2 horas", exact: true });
  await expect(kickoffButton).toBeVisible();
  await expect(kickoffButton).toHaveAttribute("aria-disabled", "true");
  await expect(detail.getByText(/Todavía no hay una fuente disponible para este partido/)).toHaveCount(0);
  const primarySize = await detail.locator(".sports-match__score strong").evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(primarySize).toBeGreaterThanOrEqual(25);
  await expect(detail.getByRole("button", { name: /Siguiendo|Compartir/ })).toHaveCount(0);
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(shell).toHaveAttribute("data-stage", "expanded");
  await expect(detail.getByRole("heading", { name: "Posiciones", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(shell).toHaveAttribute("data-stage", "open");
  await page.keyboard.press("Escape");
  await expect(shell).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("un partido finalizado no ofrece Ver partido", async ({ page }) => {
  await setup(page);
  await page.getByRole("tab", { name: "Ayer", exact: true }).click();
  await page.getByRole("button", { name: /Alianza Lima.*Rival/ }).click();
  const detail = page.frameLocator('iframe[title="Detalle de Alianza Lima — Rival"]');
  await expect(detail.getByRole("main", { name: "Alianza Lima — Rival", exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Ver partido", exact: true })).toHaveCount(0);
});

test("el detalle directo tolera un partido inexistente", async ({ page }) => {
  await setup(page);
  await page.goto("/big-picture/sports/match/missing");
  await expect(page.getByRole("heading", { name: "Enfrentamiento no disponible" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a Mis equipos" })).toBeVisible();
});

test("Ver partido mantiene la fuente real y la ruta del reproductor de Sports", async ({ page }) => {
  await setup(page, { playable: true });
  await page.getByRole("tab", { name: "Próximos", exact: true }).click();
  await page.getByRole("button", { name: /Real Madrid.*FC Barcelona/ }).click();
  const detail = page.frameLocator('iframe[title="Detalle de Real Madrid — FC Barcelona"]');
  await expect(detail.getByRole("button", { name: "Ver partido", exact: true })).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Enter");
  await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "true");
  await detail.getByRole("button", { name: "Ver partido", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=preview-live/);
  const handoff = await page.evaluate(() => Object.values(sessionStorage).some(value => String(value).includes("https://sports.test/live.m3u8")));
  expect(handoff).toBe(true);
});

test("solo ondea la bandera seleccionada sin frenarse al revelar paneles ni expandir", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const draws: number[] = [];
    Object.assign(window, { shellFlagDraws: draws, shellFlagRevealAt: 0, shellCanvasResizeWrites: 0 });
    const seen = new WeakSet<HTMLCanvasElement>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = getContext.apply(this, args);
      if (args[0] === "webgl" && context && !seen.has(this)) {
        seen.add(this);
        const gl = context as WebGLRenderingContext;
        const draw = gl.drawElements.bind(gl);
        gl.drawElements = (...drawArgs) => { draws.push(performance.now()); draw(...drawArgs); };
      }
      return context;
    } as typeof getContext;
  });
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    const state = window as Window & { shellFlagDraws: number[]; shellFlagRevealAt: number; shellCanvasResizeWrites: number };
    state.shellFlagDraws.length = 0;
    state.shellFlagRevealAt = 0;
    state.shellCanvasResizeWrites = 0;
    new MutationObserver(records => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (record.attributeName === "data-preview-revealed" && target.dataset.previewRevealed === "true") {
          state.shellFlagRevealAt = performance.now();
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-preview-revealed"] });
    new MutationObserver(records => {
      state.shellCanvasResizeWrites += records.filter(record => record.target instanceof HTMLCanvasElement
        && !!record.target.closest('.bp-shell-preview__panel[data-shell-side="active"] .sports-flag')).length;
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["width", "height"] });
  });
  await page.getByRole("tab", { name: "Próximos", exact: true }).click();
  await page.getByRole("button", { name: /Real Madrid.*FC Barcelona/ }).click();

  const shell = page.locator("[data-shell-preview]");
  const selectedPreview = shell.locator('.bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  await expect(selectedPreview).toHaveAttribute("data-flag-motion", "running");
  const selectedCanvas = await selectedPreview.locator("canvas").elementHandle();
  await expect(shell.locator('iframe[title="Detalle de Real Madrid — FC Barcelona"]')).toHaveAttribute("data-preview-ready", "true", { timeout: 30_000 });
  await expect(shell.locator('iframe[title="Detalle de Real Madrid — FC Barcelona"]')).toHaveAttribute("data-preview-revealed", "true");
  const layering = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.bp-shell-preview__panel[data-shell-side="active"]')!;
    const backdrop = panel.querySelector<HTMLElement>(".bp-shell-preview__match-backdrop")!;
    const frame = panel.querySelector<HTMLIFrameElement>("iframe")!;
    return { backdrop: getComputedStyle(backdrop).zIndex, frame: getComputedStyle(frame).zIndex, frameTransition: getComputedStyle(frame).transitionDuration };
  });
  expect(layering).toEqual({ backdrop: "1", frame: "2", frameTransition: "0.42s" });
  // The same shell canvas keeps running when the panels reveal; the iframe
  // remains transparent and must not start a second flag renderer.
  await expect(selectedPreview).toHaveAttribute("data-flag-motion", "running");
  await expect(shell.locator('.bp-shell-preview__match-backdrop .sports-flag[data-flag-motion="running"]')).toHaveCount(1);
  expect(await selectedCanvas?.evaluate(canvas => canvas.isConnected)).toBe(true);
  expect(await selectedCanvas?.evaluate(canvas => canvas === document.querySelector('.bp-shell-preview__panel[data-shell-side="active"] .sports-flag__canvas'))).toBe(true);
  const canvasResizeWritesAtReveal = await page.evaluate(() => (window as Window & { shellCanvasResizeWrites: number }).shellCanvasResizeWrites);
  console.log(`SHELL_CANVAS_RESIZE_WRITES ${canvasResizeWritesAtReveal}`);
  expect(canvasResizeWritesAtReveal).toBeLessThanOrEqual(4);
  const revealCadence = await page.evaluate(() => {
    const state = window as Window & { shellFlagDraws: number[]; shellFlagRevealAt: number };
    const aroundReveal = state.shellFlagDraws.filter(time => Math.abs(time - state.shellFlagRevealAt) <= 120);
    const gaps = aroundReveal.slice(1).map((time, index) => time - aroundReveal[index]);
    const before = state.shellFlagDraws.filter(time => time <= state.shellFlagRevealAt).at(-1);
    const after = state.shellFlagDraws.find(time => time >= state.shellFlagRevealAt);
    return { revealAt: state.shellFlagRevealAt, frames: aroundReveal.length, largestGap: Math.max(0, ...gaps), gapAtReveal: before !== undefined && after !== undefined ? after - before : Infinity };
  });
  console.log(`SHELL_REVEAL_CADENCE ${JSON.stringify(revealCadence)}`);
  expect(revealCadence.revealAt).toBeGreaterThan(0);
  expect(revealCadence.frames).toBeGreaterThan(4);
  expect(revealCadence.largestGap).toBeLessThan(80);
  expect(revealCadence.gapAtReveal).toBeLessThan(80);
  const nextCanvas = await shell.locator('.bp-shell-preview__panel[data-shell-side="end"] .sports-flag canvas').elementHandle();
  const detail = page.frameLocator('iframe[title="Detalle de Real Madrid — FC Barcelona"]');
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "false");
  const visibleFlagCanvas = selectedPreview.locator(".sports-flag__canvas");
  const firstPreviewFrame = await visibleFlagCanvas.screenshot();
  await page.waitForTimeout(180);
  expect((await visibleFlagCanvas.screenshot()).equals(firstPreviewFrame)).toBe(false);
  const cadence = await page.evaluate(async () => {
    const draws = (window as Window & { shellFlagDraws: number[] }).shellFlagDraws;
    draws.length = 0;
    const startedAt = performance.now();
    let frames = 0;
    await new Promise<void>(resolve => {
      const sample = (time: number) => { frames += 1; if (time - startedAt < 1_500) requestAnimationFrame(sample); else resolve(); };
      requestAnimationFrame(sample);
    });
    const intervals = draws.slice(1).map((time, index) => time - draws[index]).sort((a, b) => a - b);
    const canvas = document.querySelector<HTMLCanvasElement>('.bp-shell-preview__panel[data-shell-side="active"] .sports-flag__canvas')!;
    const gl = canvas.getContext("webgl")!;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return { frames, draws: draws.length, p95: intervals[Math.floor((intervals.length - 1) * .95)] ?? Infinity,
      width: canvas.width, height: canvas.height, renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unavailable" };
  });
  console.log(`SHELL_FLAG_CADENCE ${JSON.stringify(cadence)}`);
  expect(cadence.draws).toBeGreaterThan(45);
  expect(cadence.p95).toBeLessThan(34);

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Atlético Grau — Alianza Lima");
  const nextPreview = shell.locator('.bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  await expect(nextPreview).toHaveAttribute("data-flag-motion", "running");
  expect(await selectedCanvas?.evaluate(canvas => canvas.isConnected)).toBe(false);
  expect(await nextCanvas?.evaluate(canvas => canvas.isConnected)).toBe(false);
  await expect(shell.locator('.bp-shell-preview__match-backdrop .sports-flag[data-flag-motion="running"]')).toHaveCount(1);

  const nextFrame = shell.locator('iframe[title="Detalle de Atlético Grau — Alianza Lima"]');
  await expect(nextFrame).toHaveAttribute("data-preview-ready", "true");
  await expect(nextFrame).toHaveAttribute("data-preview-revealed", "true");
  const nextDetail = page.frameLocator('iframe[title="Detalle de Atlético Grau — Alianza Lima"]');
  await expect(nextDetail.locator(".sports-flag")).toHaveCount(0);
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await expect(nextPreview).toHaveAttribute("data-flag-motion", "running");
  await expect(shell.locator('.bp-shell-preview__match-backdrop .sports-flag[data-flag-motion="running"]')).toHaveCount(1);

  const canvasResizeWritesBeforeExpand = await page.evaluate(() => (window as Window & { shellCanvasResizeWrites: number }).shellCanvasResizeWrites);
  await page.keyboard.press("Enter");
  await expect(shell).toHaveAttribute("data-stage", "expanded");
  await expect(shell.locator('.bp-shell-preview__match-backdrop .sports-flag[data-flag-motion="running"]')).toHaveCount(1);
  await expect(nextDetail.locator(".sports-flag")).toHaveCount(0);
  await expect(nextDetail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "true");
  await page.waitForTimeout(200);
  const canvasResizeWritesAfterExpand = await page.evaluate(() => (window as Window & { shellCanvasResizeWrites: number }).shellCanvasResizeWrites);
  expect(canvasResizeWritesAfterExpand - canvasResizeWritesBeforeExpand).toBeLessThanOrEqual(2);
});

test("degradado continuo sin cuadrícula entre preview y detalle", async ({ page }) => {
  await setup(page, { freezeTime: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: /Valencia.*Real Madrid/ }).click();
  const detail = page.frameLocator('iframe[title="Detalle de Valencia — Real Madrid"]');
  const shell = page.locator("[data-shell-preview]");
  const flag = shell.locator('.bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  await expect(flag).toBeVisible();
  await expect(detail.locator(".sports-match__crest img").first()).toBeVisible();
  await expect.poll(() => flag.evaluate(element => getComputedStyle(element).getPropertyValue("--flag-home").trim())).not.toBe("");
  const background = await flag.evaluate(element => getComputedStyle(element).backgroundImage);
  const texture = await flag.evaluate(element => ["::before", "::after"].map(pseudo => getComputedStyle(element, pseudo).backgroundImage).join(" "));
  expect(texture).not.toContain("repeating-linear-gradient");
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await expect(flag.locator("canvas")).toHaveCount(1);
  await expect(flag).toHaveAttribute("data-flag-ready", "true");
  await expect(page.locator('[data-shell-preview] iframe[title="Detalle de Valencia — Real Madrid"]')).toHaveAttribute("data-preview-revealed", "true");
  await expect(flag).toHaveAttribute("data-flag-motion", "running");
  await page.keyboard.press("Enter");
  await expect(flag).toHaveAttribute("data-flag-motion", "running");
  expect(await flag.evaluate(element => getComputedStyle(element).backgroundImage)).toBe(background);
  const canvas = flag.locator("canvas");
  const firstFrame = await canvas.screenshot();
  await page.waitForTimeout(180);
  const nextFrame = await canvas.screenshot();
  expect(nextFrame.equals(firstFrame)).toBe(false);
  // Cloth fills the viewport; an opaque drawing buffer avoids compositor blending.
  expect(await canvas.evaluate(element => (element as HTMLCanvasElement).getContext("webgl")?.getContextAttributes()?.alpha)).toBe(false);
});

test("medición de cadencia de la bandera", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: /Valencia.*Real Madrid/ }).click();
  const detail = page.frameLocator('iframe[title="Detalle de Valencia — Real Madrid"]');
  await expect(detail.getByRole("main", { name: "Valencia — Real Madrid", exact: true })).toBeVisible();
  await page.keyboard.press("Enter");
  const flag = page.locator('[data-shell-preview] .bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  await expect(flag).toHaveAttribute("data-flag-motion", "running");
  await page.locator(".bp-shell-preview__viewport").evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
  const canvas = flag.locator(".sports-flag__canvas");
  await expect(canvas).toBeVisible();
  const profiler = process.env.FLAG_PROFILE ? await page.context().newCDPSession(page) : undefined;
  if (profiler) { await profiler.send("Profiler.enable"); await profiler.send("Profiler.start"); }
  const metrics = await canvas.evaluate(async element => {
    const frameIntervals: number[] = [];
    const startedAt = performance.now();
    let previous = 0;
    let frameCount = 0;
    await new Promise<void>(resolve => {
      const sample = (time: number) => {
        if (previous) frameIntervals.push(time - previous);
        previous = time;
        frameCount += 1;
        if (time - startedAt < 1_500) requestAnimationFrame(sample); else resolve();
      };
      requestAnimationFrame(sample);
    });
    const percentile = (values: number[], p: number) => values.slice().sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext("webgl")!;
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return { frameCount, rafP95: percentile(frameIntervals, .95), rafMax: Math.max(0, ...frameIntervals), width: canvas.width, height: canvas.height, renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unavailable" };
  });
  console.log(`FLAG_CADENCE ${JSON.stringify(metrics)}`);
  if (profiler) {
    const { profile } = await profiler.send("Profiler.stop");
    console.log("FLAG_CPU " + JSON.stringify(profile.nodes.filter(node => node.hitCount).sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)).slice(0, 12).map(node => ({ function: node.callFrame.functionName, url: node.callFrame.url.slice(-100), samples: node.hitCount }))));
    await profiler.detach();
  }
  expect(metrics.frameCount).toBeGreaterThan(50);
  expect(metrics.rafP95).toBeLessThan(34);
  expect(metrics.rafMax).toBeLessThan(120);
});

test("la bandera shell no se pausa al revelar paneles y respeta visibilidad y movimiento reducido", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: /Valencia.*Real Madrid/ }).click();
  const detail = page.frameLocator('iframe[title="Detalle de Valencia — Real Madrid"]');
  const flag = page.locator('[data-shell-preview] .bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  await expect(page.locator('[data-shell-preview] iframe[title="Detalle de Valencia — Real Madrid"]')).toHaveAttribute("data-preview-revealed", "true");
  await expect(flag).toHaveAttribute("data-flag-motion", "running");
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(flag).toHaveAttribute("data-flag-motion", "running");
  const canvas = flag.locator(".sports-flag__canvas");
  const bounds = await canvas.evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }));
  expect(bounds.width).toBeLessThanOrEqual(2048); expect(bounds.height).toBeLessThanOrEqual(1440);
  const firstFrame = await canvas.screenshot();
  await page.waitForTimeout(180);
  const nextFrame = await canvas.screenshot();
  expect(nextFrame.equals(firstFrame)).toBe(false);
  await flag.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(flag).toHaveAttribute("data-flag-motion", "paused");
  await expect(canvas).toBeVisible();
  await flag.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(flag).toHaveAttribute("data-flag-motion", "running");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(flag).toHaveAttribute("data-flag-motion", "still");
  await expect(flag).toHaveAttribute("data-flag-ready", "true");
  await expect(canvas).toHaveCSS("opacity", "1");
});

test("sin WebGL conserva el degradado legible en la bandera de la shell", async ({ page }) => {
  await page.addInitScript(`const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === "webgl" ? null : getContext.call(this, type, ...args);
    };`);
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("button", { name: /Valencia.*Real Madrid/ }).click();
  const detail = page.frameLocator('iframe[title="Detalle de Valencia — Real Madrid"]');
  const flag = page.locator('[data-shell-preview] .bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  await expect(flag).toBeVisible();
  await expect(flag).toHaveAttribute("data-flag-motion", "still");
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await expect(page.locator('[data-shell-preview] iframe[title="Detalle de Valencia — Real Madrid"]')).toHaveAttribute("data-preview-revealed", "true");
  expect(await flag.evaluate(element => getComputedStyle(element).backgroundImage)).toContain("linear-gradient");
  await page.keyboard.press("Enter");
  await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "true");
  await expect(flag).toHaveAttribute("data-flag-motion", "still");
  await expect(detail.locator(".sports-match__play")).toBeVisible();
});

test("shell y detalle congelados conservan la misma tela", async ({ page }, testInfo) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /Valencia.*Real Madrid/ }).click();
  const shell = page.locator("[data-shell-preview]");
  const frame = shell.locator('iframe[title="Detalle de Valencia — Real Madrid"]');
  const detail = page.frameLocator('iframe[title="Detalle de Valencia — Real Madrid"]');
  const flag = page.locator('[data-shell-preview] .bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
  const canvas = flag.locator(".sports-flag__canvas");
  await expect(detail.locator(".sports-flag")).toHaveCount(0);
  await expect(flag).toHaveAttribute("data-flag-ready", "true");
  await expect.poll(() => detail.locator(".sports-match__crest img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("shell-static.png") });
  // Compare the material alone, without text moving as the shell expands.
  await detail.locator("head").evaluate(element => {
    const style = document.createElement("style");
    style.textContent = ".sports-match__content, nav { visibility:hidden !important; }";
    element.append(style);
  });
  const preview = (await canvas.screenshot()).toString("base64");
  await expect(frame).toHaveAttribute("data-preview-ready", "true");
  await expect(frame).toHaveAttribute("data-preview-revealed", "true");
  await expect(shell).toHaveAttribute("data-stage", "revealing");
  await page.locator(".bp-shell-preview__viewport").focus();
  await page.keyboard.press("Enter");
  await expect(shell).toHaveAttribute("data-stage", "expanded");
  await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "true");
  await expect(flag).toHaveAttribute("data-flag-ready", "true");
  await expect(flag).toHaveAttribute("data-flag-motion", "still");
  const expanded = (await canvas.screenshot()).toString("base64");
  const difference = await page.evaluate(async ({ preview, expanded }) => {
    const sample = async (source: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, 64, 64);
      return context.getImageData(0, 0, 64, 64).data;
    };
    const [left, right] = await Promise.all([sample(preview), sample(expanded)]);
    return left.reduce((sum, channel, index) => sum + Math.abs(channel - right[index]), 0) / left.length;
  }, { preview, expanded });
  console.log(`FLAG_SHELL_STATIC_DIFFERENCE ${difference}`);
  expect(difference).toBeLessThan(2);
  await detail.locator("head style").last().evaluate(element => element.remove());
  await page.screenshot({ path: testInfo.outputPath("detail-static.png") });
});

test("capturas del degradado de referencia Eibar y Real Sociedad", async ({ page }) => {
  await setup(page, { reference: true });
  for (const [width, height, name] of [[1440, 1000, "desktop"], [900, 800, "minimum"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: /SD Eibar.*Real Sociedad/ }).click();
    const detail = page.frameLocator('iframe[title="Detalle de SD Eibar — Real Sociedad"]');
    await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-revealed", "true");
    await expect.poll(() => detail.locator(".sports-match__crest img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
    await page.screenshot({ path: `.impeccable/review/sports-match-detail/reference-${name}-carousel.png`, animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "true");
    await page.screenshot({ path: `.impeccable/review/sports-match-detail/reference-${name}.png`, animations: "disabled" });
    expect(await detail.locator("[data-sports-match]").evaluate(element => element.scrollWidth > element.clientWidth + 1)).toBe(false);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const flag = page.locator('[data-shell-preview] .bp-shell-preview__panel[data-shell-side="active"] .sports-flag');
    await expect(flag).toHaveAttribute("data-flag-motion", "running");
    await expect(flag.locator(".sports-flag__canvas")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `.impeccable/review/sports-match-detail/reference-${name}-waves.png` });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-shell-preview]")).toHaveAttribute("data-stage", "open");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-shell-preview]")).toHaveCount(0);
  }
});

test("capturas del carrusel reutilizado y enfrentamiento", async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const [width, height, name] of [[1440, 1000, "desktop"], [900, 800, "minimum"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.getByRole("tab", { name: "Próximos", exact: true }).click();
    await page.getByRole("button", { name: /Real Madrid.*FC Barcelona/ }).click();
    const detail = page.frameLocator('iframe[title="Detalle de Real Madrid — FC Barcelona"]');
    await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-revealed", "true");
    await expect.poll(() => detail.locator(".sports-match__crest img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
    const marksFit = await detail.locator(".sports-match__crest img").evaluateAll(images => images.every(image => {
      const bounds = image.getBoundingClientRect(); const slot = image.parentElement!.getBoundingClientRect();
      return bounds.bottom <= slot.bottom + 1 && bounds.right <= slot.right + 1;
    }));
    expect(marksFit).toBe(true);
    await page.screenshot({ path: `.impeccable/review/sports-match-detail/${name}-carousel.png`, fullPage: true, animations: "disabled" });
    await page.keyboard.press("Enter");
    await expect(detail.locator(".shell-preview-app")).toHaveAttribute("data-preview-active", "true");
    await expect(page.locator('[data-shell-preview] .bp-shell-preview__panel[data-shell-side="active"] .sports-flag')).toHaveAttribute("data-flag-motion", "running");
    await page.screenshot({ path: `.impeccable/review/sports-match-detail/${name}.png`, fullPage: true, animations: "disabled" });
    await page.screenshot({ path: `.impeccable/review/sports-match-detail/${name}-waves.png`, fullPage: true });
    const overflow = await detail.locator("[data-sports-match]").evaluate(element => element.scrollWidth > element.clientWidth + 1);
    expect(overflow).toBe(false);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-shell-preview]")).toHaveAttribute("data-stage", "open");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-shell-preview]")).toHaveCount(0);
  }
  await setup(page, { playable: true });
  await page.goto("/big-picture/sports");
  const card = page.locator(".sports-match-card").first();
  await expect(card).toBeVisible();
  await expect.poll(() => card.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
  expect(await card.locator(".sports-match-card__art").evaluate(element => getComputedStyle(element, "::before").backgroundImage)).toContain("repeating-linear-gradient");
  await expect(card.locator("canvas")).toHaveCount(0);
  await card.screenshot({ path: ".impeccable/review/sports-match-detail/match-card.png", animations: "disabled" });
});

test("capturas agrupadas en escritorio y ventana estrecha", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("tabpanel")).toContainText("Valencia");
  for (const [width, height, name] of [[1440, 1000, "desktop"], [900, 800, "minimum"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.mouse.move(width - 1, 0);
    await page.getByRole("tab", { name: "Hoy", exact: true }).click();
    await page.locator(".my-teams__table img").evaluateAll(images => images.forEach(image => { (image as HTMLImageElement).loading = "eager"; }));
    await expect.poll(() => page.locator(".my-teams__table img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
    await page.screenshot({ path: `.impeccable/review/sports-followed-matches/${name}-today.png`, animations: "disabled", fullPage: true });
    await page.getByRole("tab", { name: "Próximos", exact: true }).click();
    await page.locator(".my-teams__table img").evaluateAll(images => images.forEach(image => { (image as HTMLImageElement).loading = "eager"; }));
    await expect.poll(() => page.locator(".my-teams__table img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
    await page.screenshot({ path: `.impeccable/review/sports-followed-matches/${name}.png`, animations: "disabled", fullPage: true });
  }
});
