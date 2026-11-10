import { expect, test, type Page } from "@playwright/test";

async function setupSports(page: Page, brokenArtwork = false, replayCount = 0, holdReplays = false, replayMissingSources: number[] = [], sampledCrests = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ replayCount, holdReplays, replayMissingSources, sampledCrests }) => {
    let nextId = 1;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: () => nextId++,
        invoke: async (command: string) => command === "start_nuvio_sports_server"
          ? { ready: true, running: true, port: 7310, pid: 1 }
          : command.startsWith("plugin:event|") ? nextId++ : null,
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
      },
      __TAURI__: { event: { listen: async () => () => undefined } },
    });
    const profileId = "sports-home-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: profileId, name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1, iptvProvidersVersion: 1, sportsStreamsProvidersVersion: 1, cncVerseTvIptvProvidersVersion: 1 }));
    const live = {
      id: "sports-test", title: "Real Madrid vs Barcelona", sport: "Football", league: "LaLiga", poster: "/sports-test-art.svg",
      status: "live", startsAt: new Date(Date.now() - 600_000).toISOString(),
      home: { name: "Real Madrid" }, away: { name: "FC Barcelona" },
      sources: [{ id: "one", label: "Fuente local", url: "https://sports.test/live.m3u8" }],
    };
    const upcoming = { ...live, id: "next-test", title: "Atlético de Madrid vs Sevilla", status: "upcoming",
      startsAt: new Date(Date.now() + 3_600_000).toISOString(), home: { name: "Atlético de Madrid" }, away: { name: "Sevilla" }, sources: [] };
    const events = sampledCrests ? [0, 1].map(index => ({
      ...live, id: `sampled-${index}`, title: index === 0 ? "Fixture Rojo vs Fixture Azul" : "Fixture Coral vs Fixture Marino",
      startsAt: new Date(Date.now() - (index + 1) * 600_000).toISOString(),
      home: { name: index === 0 ? "Fixture Rojo" : "Fixture Coral", logo: "/crest-fixture-red.svg" },
      away: { name: index === 0 ? "Fixture Azul" : "Fixture Marino", logo: "/crest-fixture-blue.svg" },
    })) : [live];
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify(events));
    localStorage.setItem("aetherio-live-sports-snapshot", JSON.stringify({ events, upcoming: [upcoming], channels: [], fetchedAt: Date.now() }));
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-sports-preferences`, JSON.stringify({
      version: 1, onboarding: "completed", sports: ["futbol"],
      followedCompetitions: ["comp:esp-laliga"], followedClubs: [], followedNationalTeams: [],
      followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos",
    }));
    // Keep the cached agenda stable; these tests cover the home, not providers.
    const originalFetch = window.fetch.bind(window);
    Object.assign(window, { sportsReplayStreamRequests: 0, sportsReplayFailSkip: -1, sportsReplayMissingIds: replayMissingSources });
    window.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const state = window as unknown as { sportsReplayStreamRequests: number; sportsReplayFailSkip: number; sportsReplayMissingIds: number[]; sportsReplayGenre?: string; sportsReplayTitlePrefix?: string; sportsReplayTitle?: string };
      // La fila curada lee catálogos concretos (hoy, ayer, semana, older) más
      // la cola genérica; el skip viaja dentro del mismo segmento de ruta.
      const replayCatalog = /\/catalog\/tv\/(nuvio_sports_catalog\/genre=Replays|nuvio_sports_replays_[a-z_]+)&skip=(\d+)\.json$/.exec(new URL(url).pathname);
      if (replayCatalog) {
        const [, catalog, skipText] = replayCatalog;
        const skip = Number(skipText);
        // Solo "hoy" y la genérica publican repeticiones en el fixture: el
        // resto de catálogos del plan (ayer, semana, older) llegan vacíos.
        const servesReplays = catalog === "nuvio_sports_replays_football_today" || catalog === "nuvio_sports_catalog/genre=Replays";
        if (!servesReplays) return Promise.resolve(new Response(JSON.stringify({ metas: [] })));
        if (holdReplays) return new Promise<Response>(() => {});
        if (state.sportsReplayFailSkip === skip) return Promise.resolve(new Response("offline", { status: 503 }));
        const metas = Array.from({ length: Math.max(0, Math.min(100, replayCount - skip)) }, (_, index) => ({
          id: `nuvio_sport_replay_${skip + index}`, type: "tv", name: state.sportsReplayTitle ?? `${state.sportsReplayTitlePrefix ?? "LaLiga"} Repetición ${skip + index}`,
          genres: [state.sportsReplayGenre ?? "FOOTBALL"], poster: "/sports-test-art.svg", released: "2026-10-28T18:00:00Z",
        }));
        return Promise.resolve(new Response(JSON.stringify({ metas })));
      }
      if (url.includes("/stream/tv/nuvio_sport_replay_")) {
        state.sportsReplayStreamRequests++;
        const replayId = Number(url.match(/nuvio_sport_replay_(\d+)\.json$/)?.[1] ?? -1);
        return Promise.resolve(new Response(JSON.stringify({ streams: state.sportsReplayMissingIds.includes(replayId) ? [] : [{
          name: "Sports HD", url: "https://sports.test/replay.mp4",
          behaviorHints: { live: true, notWebReady: true, proxyHeaders: { request: { Referer: "https://sports.test/" } } },
        }] })));
      }
      if (url.includes("127.0.0.1:7310/api/provider-health")) return Promise.resolve(new Response(JSON.stringify({ sync: { state: "idle" } })));
      if (/nuviosports|highfly|stremverse/.test(url)) return Promise.resolve(new Response(JSON.stringify({ metas: [] })));
      return originalFetch(input, init);
    };
  }, { replayCount, holdReplays, replayMissingSources, sampledCrests });
  await page.route("**/sports-test-art.svg", route => brokenArtwork
    ? route.fulfill({ status: 503, body: "Artwork provider unavailable" })
    : route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#303e42"/><path d="M0 750 960 400l960 350v330H0Z" fill="#466a56"/><ellipse cx="960" cy="630" rx="850" ry="280" fill="none" stroke="#90a5a3" stroke-width="40"/><path d="M300 700h1320M960 500v580" stroke="#b5c1b0" stroke-width="6"/></svg>' }));
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
  await page.goto("/big-picture/sports");
  // The native splash window isn't present in the browser harness.
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
}

async function setupUpcomingSchedule(page: Page) {
  await page.evaluate(async () => {
    // Reuse the exact Vite URL (including its HMR query) imported by the hook.
    // Importing the bare path creates a second provider registry. Reading the
    // transformed import also works when Playwright's virtual clock clears the
    // Performance resource entries.
    const hookUrl = new URL("/src/hooks/useLiveEvents.ts", location.origin).href;
    const hookSource = await fetch(hookUrl).then(response => response.text());
    const moduleSpecifier = /from ["']([^"']*\/src\/services\/liveSportsService\.ts[^"']*)["']/.exec(hookSource)?.[1];
    if (!moduleSpecifier) throw new Error("No se encontró la importación de servicios deportivos del hook.");
    const moduleUrl = new URL(moduleSpecifier, location.origin).href;
    const { getLiveSportsProvider, registerLiveSportsProvider } = await import(moduleUrl);
    const provider = getLiveSportsProvider("local");
    const [live] = JSON.parse(localStorage.getItem("aetherio-live-sports-local-events")!);
    localStorage.setItem("sports-home-upcoming", JSON.stringify([{
      ...live, id: "next-test", title: "Atlético de Madrid vs Sevilla", status: "upcoming",
      startsAt: new Date(Date.now() + 3_600_000).toISOString(), home: { name: "Atlético de Madrid" }, away: { name: "Sevilla" }, sources: [],
    }]));
    registerLiveSportsProvider({ ...provider, fetchUpcoming: async () => JSON.parse(localStorage.getItem("sports-home-upcoming")!) });
  });
  await page.getByRole("button", { name: "Actualizar agenda", exact: true }).click();
  await expect(page.locator('[data-row-key*="sports-upcoming"]')).toHaveAttribute("data-row-count", "1");
}

test("Deportes tiene navegación propia y vuelve a Aetherio desde el primer botón", async ({ page }) => {
  await setupSports(page);
  await expect(page.getByLabel("Hora actual")).toHaveText(/\d{1,2}:\d{2}/);
  await expect(page.locator("[data-bp-sports] .home-row-title").filter({ hasText: "Equipos que sigues" })).toBeVisible();
  const collapsedHome = page.getByRole("button", { name: "Abrir navegación, sección actual: Inicio", exact: true });
  await expect.poll(async () => page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>(".bp-rail__collapsed");
    const clock = document.querySelector<HTMLElement>(".bp-sports-home__clock");
    if (!pill || !clock) return Infinity;
    return Math.abs((pill.getBoundingClientRect().top + pill.getBoundingClientRect().bottom) / 2
      - (clock.getBoundingClientRect().top + clock.getBoundingClientRect().bottom) / 2);
  })).toBeLessThanOrEqual(2);
  await expect(collapsedHome).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Navegación de Deportes", exact: true });
  await expect(navigation).toBeVisible();
  await navigation.hover();
  const items = navigation.locator(".bp-rail__item");
  await expect(items).toHaveText(["Volver a Aetherio", "Inicio", "Mis equipos", "Personalizar"]);
  await expect(navigation.getByRole("button", { name: "Inicio", exact: true }).locator("svg")).toHaveAttribute("viewBox", "0 0 64 64");
  await expect(navigation.getByRole("button", { name: "Abrir ajustes del perfil" })).toBeVisible();
  await expect(navigation.getByText("Plataformas", { exact: true })).toHaveCount(0);
  await items.first().click();
  await expect(page).toHaveURL(/\/big-picture$/);
  const mainNavigation = page.getByRole("navigation", { name: "Navegación espacial", exact: true });
  await mainNavigation.hover();
  await mainNavigation.getByRole("button", { name: "Deportes", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await expect(navigation).toBeVisible();
});

test("la sidebar de Deportes abre las secciones y ajustes existentes", async ({ page }) => {
  test.setTimeout(60_000);
  await setupSports(page, false, 1);
  const navigation = page.getByRole("navigation", { name: "Navegación de Deportes", exact: true });
  await navigation.hover();
  await navigation.getByRole("button", { name: "Mis equipos", exact: true }).click();
  await expect(page).toHaveURL(/\/sports#equipos$/);
  await expect(page.getByRole("button", { name: "Añadir equipos", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Repeticiones", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "Repeticiones", exact: true })).toHaveCount(0);
  await page.mouse.move(0, 0);
  await navigation.hover();
  await page.getByRole("button", { name: "Inicio", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await page.getByRole("button", { name: "Listas IPTV", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await expect.poll(() => page.locator(".big-picture__scroll").evaluate(element => element.scrollTop)).toBe(0);
  await page.mouse.move(0, 0);
  await navigation.hover();
  await navigation.getByRole("button", { name: "Personalizar", exact: true }).click();
  await expect(page.locator("[data-aetherio-sports-onboarding]")).toBeVisible();
});

test("las rutas desconocidas de la app deportiva regresan a su inicio", async ({ page }) => {
  await setupSports(page);
  await page.goto("/big-picture/sports/desconocida");
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await expect(page.getByRole("navigation", { name: "Navegación de Deportes", exact: true })).toBeVisible();
});

test("la sidebar deportiva conserva teclado y geometría del rail compartido", async ({ page }) => {
  test.setTimeout(60_000);
  await setupSports(page);
  const navigation = page.getByRole("navigation", { name: "Navegación de Deportes", exact: true });
  await navigation.hover();
  const first = navigation.getByRole("button", { name: "Volver a Aetherio", exact: true });
  await first.focus();
  await first.press("ArrowUp");
  await expect(navigation.getByRole("button", { name: "Abrir ajustes del perfil", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(first).toBeFocused();
  for (const [width, height, name] of [[1920, 1080, "desktop"], [1280, 720, "user-1280"], [900, 600, "minimum"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.mouse.move(0, 0);
    await navigation.hover();
    const box = await first.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.impeccable/review/sports-app/${name}.png`, animations: "disabled" });
  }
});

test("F9 alterna Sports con transición propia y conserva F10 para TV", async ({ page }) => {
  test.setTimeout(60_000);
  await setupSports(page);
  await page.keyboard.press("F9");
  await expect(page).toHaveURL(/\/big-picture$/);
  await expect(page.getByRole("navigation", { name: "Navegación espacial", exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.keyboard.press("F9");
  const logo = page.locator('[data-bp-mode-brand-logo][data-bp-mode-logo="sports"]');
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", /AetherioSportsLogo/);
  await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator("#aetherio-bp-mode")).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-bp-mode-brand]")).toHaveCSS("opacity", "1");
  await page.screenshot({ path: ".impeccable/review/sports-app/transition.png" });
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await expect(page.locator("#aetherio-bp-mode")).toHaveCSS("pointer-events", "none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("F10");
  await expect(page).toHaveURL(/\/home$/);
  await page.keyboard.press("F9");
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  const navigation = page.getByRole("navigation", { name: "Navegación de Deportes", exact: true });
  await navigation.hover();
  await navigation.getByRole("button", { name: "Volver a Aetherio", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
});

test("View Back del mando Xbox entra a Sports una sola vez al mantenerlo", async ({ page }) => {
  await setupSports(page);
  await page.keyboard.press("F9");
  await expect(page).toHaveURL(/\/big-picture$/);
  await page.evaluate(() => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = { id: "Xbox Controller", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons };
    Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
    (window as any).sportsTestPad = pad;
    buttons[8] = { pressed: true, touched: true, value: 1 };
  });
  await expect(page).toHaveURL(/\/big-picture\/sports$/);
  await page.evaluate(() => { (window as any).sportsTestPad.buttons[8] = { pressed: false, touched: false, value: 0 }; });
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => { (window as any).sportsTestPad.buttons[8] = { pressed: true, touched: true, value: 1 }; });
  await expect(page).toHaveURL(/\/big-picture$/);
});

test("las cards de TV componen los equipos y mantienen el título fuera del artwork del addon", async ({ page }) => {
  await setupSports(page);
  const card = page.locator('[data-row-key*="sports-now"] .sports-match-card').first();
  const frame = card.getByRole("button", { name: "Real Madrid vs Barcelona", exact: true });
  await expect(frame).toBeVisible();
  await expect(frame.locator("img")).toHaveCount(2);
  for (const image of await frame.locator("img").all()) {
    await expect(image).toHaveAttribute("src", /\/assets\/football-logos\/clubs\//);
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(frame.locator('img[src="/sports-test-art.svg"]')).toHaveCount(0);
  await expect(frame).not.toContainText("Real Madrid vs Barcelona");
  await expect(card.locator(".sports-match-card__title")).toHaveText("Real Madrid vs Barcelona");
  const artworkBox = await frame.boundingBox();
  const titleBox = await card.locator(".sports-match-card__title").boundingBox();
  expect(titleBox!.y).toBeGreaterThanOrEqual(artworkBox!.y + artworkBox!.height);
  await frame.focus();
  await expect(frame).toHaveCSS("outline-style", "solid");
  await expect(card.getByRole("button", { name: "Elegir fuentes para Real Madrid vs Barcelona" })).toHaveCount(0);
  await frame.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/sports\/match\/live%3Asports-test/);
  await expect(page.getByRole("button", { name: "Ver partido", exact: true })).toBeVisible();
});

test("un escudo caído conserva las iniciales y nunca recupera el póster del addon", async ({ page }) => {
  await page.route("**/assets/football-logos/clubs/**", route => route.fulfill({ status: 503, body: "offline" }));
  await setupSports(page, true);
  const frame = page.locator('[data-row-key*="sports-now"] .sports-match-card__frame').first();
  await expect(frame).toBeVisible();
  await expect(frame.locator("img")).toHaveCount(0);
  await expect(frame.locator(".sports-match-card__initials")).toHaveText(["RM", "BAR"]);
  await expect(page.locator(".sports-match-card__title").first()).toBeVisible();
  await frame.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/sports\/match\/live%3Asports-test/);
  await expect(page.getByRole("button", { name: "Ver partido", exact: true })).toBeVisible();
});

test("la composición usa también nombres del título cuando el catálogo no separa los equipos", async ({ page }) => {
  await setupSports(page);
  await page.evaluate(() => {
    const [live] = JSON.parse(localStorage.getItem("aetherio-live-sports-local-events")!);
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify([{ ...live, home: undefined, away: undefined }]));
  });
  await page.getByRole("button", { name: "Actualizar agenda", exact: true }).click();
  const card = page.locator('[data-row-key*="sports-now"] .sports-match-card').first();
  await expect(card.locator(".sports-match-card__crest img")).toHaveCount(2);
  await expect(card.locator(".sports-match-card__title")).toHaveText("Real Madrid vs Barcelona");
});

test("capturas de las tarjetas TV con varios equipos, títulos largos e iniciales", async ({ page }) => {
  await setupSports(page);
  await page.evaluate(async () => {
    const preferencesUrl = "/src/data/sports/preferences.ts";
    const { patchSportsPreferences } = await import(preferencesUrl);
    patchSportsPreferences({ followedCompetitions: [] });
    const [live] = JSON.parse(localStorage.getItem("aetherio-live-sports-local-events")!);
    const opponents = [["Atalanta", "Ajax"], ["Arsenal", "Chelsea"], ["Real Madrid", "FC Barcelona"], ["Deportivo Metropolitano del Norte", "Atlético Universitario de la Costa"]];
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify(opponents.map(([home, away], index) => ({
      ...live, id: `gallery-${index}`, title: `${home} vs ${away}`, home: { name: home }, away: { name: away },
    }))));
  });
  await page.getByRole("button", { name: "Actualizar agenda", exact: true }).click();
  const row = page.locator('[data-row-key*="sports-now"]');
  await expect(row).toHaveAttribute("data-row-count", "4");
  const frame = row.locator(".sports-match-card__frame").first();
  await frame.focus();
  await expect(frame).toHaveCSS("outline-style", "solid");
  for (const image of await row.locator("img").all()) {
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  for (const [width, height, filename] of [[1920, 1080, "desktop"], [1280, 720, "user-1280"], [900, 600, "minimum-900"], [390, 844, "mobile"]] as const) {
    await page.setViewportSize({ width, height });
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>(".big-picture__scroll")!.scrollTop = 0;
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: `.impeccable/review/sports-match-cards/full-${filename}.png`, fullPage: true, animations: "disabled" });
    await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>('[data-row-key*="sports-now"]')!;
      const shell = document.querySelector<HTMLElement>(".big-picture__scroll")!;
      shell.scrollTop += row.getBoundingClientRect().top - shell.getBoundingClientRect().top - 130;
    });
    await page.screenshot({ path: `.impeccable/review/sports-match-cards/${filename}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.mouse.move(0, 0);
  await row.locator(".sports-match-card").last().scrollIntoViewIfNeeded();
  await expect(row.locator(".row-arrow-shell").last()).toHaveCSS("opacity", "0");
  await row.locator(".sports-match-card").last().screenshot({ path: ".impeccable/review/sports-match-cards/long-title.png", animations: "disabled" });
});

test("Sports entra arriba y al volver a la primera fila restaura la posición inicial", async ({ page }) => {
  const trailerRequests: string[] = [];
  page.on("request", request => { if (/(?:youtube\.com|youtu\.be|\/api\/(?:youtube|trailer))/i.test(request.url())) trailerRequests.push(request.url()); });
  await setupSports(page);
  await expect(page.getByRole("button", { name: "Abrir navegación, sección actual: Inicio", exact: true })).toBeVisible();
  await expect(page.locator("[data-bp-sports] .bp-hero-copy-stage")).toHaveCount(0);
  await expect(page.locator("[data-bp-sports] .home-page-scale")).toHaveCount(1);
  await expect(page.locator("[data-bp-sports] .media-card-frame").first()).toHaveCSS("width", "425px");
  await expect(page.locator("[data-bp-sports] .media-card-frame").first()).toHaveCSS("height", "248px");
  await expect(page.locator("[data-bp-sports] [data-row-view-more]")).toHaveCount(0);
  const shell = page.locator(".big-picture__scroll");
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBe(0);
  expect(trailerRequests).toEqual([]);
  const firstCard = page.locator('[data-row-key*="sports-now"] .sports-match-card__frame').first();
  await firstCard.focus();
  const backdrop = page.locator("[data-bp-sports] .bp-sports__ambient");
  await expect(backdrop).toBeVisible();
  await expect(backdrop.locator("img")).toHaveCount(0);
  await expect.poll(() => backdrop.evaluate(element => getComputedStyle(element).filter)).toContain("blur(120px)");
  await expect(page.locator("[data-bp-sports]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await shell.evaluate(element => { element.scrollTop = 240; });
  await firstCard.press("ArrowUp");
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBe(0);
});

test("el ambiente conserva los colores muestreados de cada card al cambiar el foco", async ({ page }) => {
  await page.route("**/crest-fixture-*.svg", route => route.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="${route.request().url().includes("red") ? "#D02020" : "#2040D0"}"/></svg>`,
  }));
  await setupSports(page, false, 0, false, [], true);
  const cards = page.locator('[data-row-key*="sports-now"] .sports-match-card');
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    await expect(card).toHaveCSS("--match-home-color", "#D03030");
    await expect(card).toHaveCSS("--match-away-color", "#3050D0");
  }
  const ambient = page.locator(".bp-sports__ambient");
  for (const index of [0, 1, 0]) {
    await cards.nth(index).locator("button").focus();
    await expect(ambient).toHaveCSS("--match-home-color", "#D03030");
    await expect(ambient).toHaveCSS("--match-away-color", "#3050D0");
    await expect(ambient).toHaveCSS("opacity", "1");
  }
  await page.screenshot({ path: ".impeccable/review/sports-match-cards/ambient-sampled-colors.png" });
});

test("las nuevas cards no cambian los ajustes de Fuentes ni exponen la marca del backend", async ({ page }) => {
  await setupSports(page);
  await page.goto("/big-picture/settings?tab=sources");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.getByRole("heading", { name: "Fuentes", exact: true })).toBeVisible();
  await expect(page.locator(".bp-settings-page__content")).not.toContainText(/Nuvio/i);
  await expect(page.locator(".bp-settings-page__content")).not.toContainText("Live Sports");
});

test("las cards entran al enfrentamiento y Ver partido abre fuentes antes del reproductor", async ({ page }) => {
  await setupSports(page);
  await expect(page.getByLabel("Hora actual")).toHaveText(/\d{1,2}:\d{2}/);
  await setupUpcomingSchedule(page);
  const now = page.locator('[data-row-key*="sports-now"]');
  await expect(now).toHaveAttribute("data-row-count", "1");
  await expect(page.locator("[data-bp-sports] .home-row-title")).toHaveText(["Ahora mismo", "Equipos que sigues", "Competiciones que sigues", "Próximamente"]);
  await expect(page.getByRole("region", { name: "Repeticiones", exact: true })).toHaveCount(0);
  await now.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/sports/now-1920.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await now.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/sports/now-1280.png" });
  await now.getByRole("button", { name: "Real Madrid vs Barcelona", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/sports\/match\/live%3Asports-test/);
  await page.getByRole("button", { name: "Ver partido", exact: true }).click();
  const source = page.getByRole("button", { name: /Seleccionar Fuente local/ });
  await expect(source).toBeVisible();
  await expect(page).not.toHaveURL(/\/big-picture\/player/);
  await source.click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=sports-test/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!).url)).toBe("https://sports.test/live.m3u8");
});

test("las filas conservan el orden Ahora mismo, Mis equipos y Próximamente al cambiar los directos", async ({ page }) => {
  await setupSports(page);
  await setupUpcomingSchedule(page);
  const now = page.locator('[data-row-key*="sports-now"]');
  await expect(now).toHaveCount(1);
  await expect(page.locator("[data-bp-sports] .home-row-title")).toHaveText(["Ahora mismo", "Equipos que sigues", "Competiciones que sigues", "Próximamente"]);
  await page.evaluate(() => {
    const [live] = JSON.parse(localStorage.getItem("aetherio-live-sports-local-events")!);
    localStorage.setItem("sports-home-live-fixture", JSON.stringify(live));
    localStorage.setItem("aetherio-live-sports-local-events", "[]");
    const [upcoming] = JSON.parse(localStorage.getItem("sports-home-upcoming")!);
    localStorage.setItem("sports-home-upcoming", JSON.stringify([{ ...upcoming, id: "next-2", title: "Sevilla vs Atlético de Madrid", home: { name: "Sevilla" }, away: { name: "Atlético de Madrid" } }]));
  });
  await page.getByRole("button", { name: "Actualizar agenda", exact: true }).click();
  await expect(now).toHaveCount(0);
  await expect(page.locator(".home-row-title")).toHaveText(["Ahora mismo", "Equipos que sigues", "Competiciones que sigues", "Próximamente"]);
  await expect(page.getByText("Sin partidos en directo ahora mismo.")).toBeVisible();
  await expect(page.locator('[data-row-key*="sports-now"]')).toHaveCount(0);
  await expect(page.locator('[data-row-key*="sports-upcoming"]').getByRole("button", { name: "Sevilla vs Atlético de Madrid", exact: true })).toBeVisible();
});

test("un proveedor de imágenes caído no deja cards rotas ni un hero negro", async ({ page }) => {
  await setupSports(page, true);
  const card = page.locator("[data-bp-sports] .media-card-frame img").first();
  const hero = page.locator("[data-bp-sports] .bp-bg__still").first();
  await expect(card).toHaveAttribute("src", /^\/assets\/football-logos\/clubs\//);
  await expect(hero).toHaveAttribute("src", /^data:image\/svg\+xml,/);
  for (const image of [card, hero]) {
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: "artifacts/sports/artwork-offline-1920.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "artifacts/sports/artwork-offline-1280.png" });
});

test("el mando navega del hero a las cards y conserva la sesión de directo", async ({ page }) => {
  await setupSports(page);
  const play = page.getByRole("button", { name: "Ver en directo", exact: true });
  await play.focus();
  await page.keyboard.press("ArrowDown");
  const card = page.locator('.media-card-frame:is(button, [role="button"])').first();
  await expect(card).toBeFocused();
  // A del mando: Enter sintético; keydown/keyup de pulsación corta.
  await page.evaluate(() => {
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true });
      Object.assign(event, { aetherioGamepadHold: true });
      document.activeElement?.dispatchEvent(event);
    }
  });
  await expect(page).toHaveURL(/\/big-picture\/sports\/match\/live%3Asports-test/);
  await page.getByRole("button", { name: "Ver partido", exact: true }).click();
  await page.getByRole("button", { name: /Seleccionar Fuente local/ }).click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=sports-test/);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream") ?? "null")?.url)).toBe("https://sports.test/live.m3u8");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture\/sports\/?$/);
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
  await expect(page).not.toHaveURL(/\/big-picture\/episode/);
});
