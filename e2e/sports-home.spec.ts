import { expect, test, type Page } from "@playwright/test";

async function setupSports(page: Page, brokenArtwork = false, replayCount = 0, holdReplays = false, replayMissingSources: number[] = []) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ replayCount, holdReplays, replayMissingSources }) => {
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
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1 }));
    const live = {
      id: "sports-test", title: "Real Madrid vs Barcelona", sport: "Football", league: "LaLiga", poster: "/sports-test-art.svg",
      status: "live", startsAt: new Date(Date.now() - 600_000).toISOString(),
      home: { name: "Real Madrid" }, away: { name: "FC Barcelona" },
      sources: [{ id: "one", label: "Fuente local", url: "https://sports.test/live.m3u8" }],
    };
    const upcoming = { ...live, id: "next-test", title: "Atlético de Madrid vs Sevilla", status: "upcoming",
      startsAt: new Date(Date.now() + 3_600_000).toISOString(), home: { name: "Atlético de Madrid" }, away: { name: "Sevilla" }, sources: [] };
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify([live]));
    localStorage.setItem("aetherio-live-sports-snapshot", JSON.stringify({ events: [live], upcoming: [upcoming], channels: [], fetchedAt: Date.now() }));
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
      const state = window as unknown as { sportsReplayStreamRequests: number; sportsReplayFailSkip: number; sportsReplayMissingIds: number[]; sportsReplayGenre?: string; sportsReplayTitlePrefix?: string };
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
          id: `nuvio_sport_replay_${skip + index}`, type: "tv", name: `${state.sportsReplayTitlePrefix ?? "LaLiga"} Repetición ${skip + index}`,
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
  }, { replayCount, holdReplays, replayMissingSources });
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
    const moduleUrl = "/src/services/liveSportsService.ts";
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

test("Sports reutiliza el hero y los catálogos horizontales del home", async ({ page }) => {
  const trailerRequests: string[] = [];
  page.on("request", request => { if (/(?:youtube\.com|youtu\.be|\/api\/(?:youtube|trailer))/i.test(request.url())) trailerRequests.push(request.url()); });
  await setupSports(page);
  await expect(page.getByRole("button", { name: "Abrir navegación, sección actual: Sports", exact: true })).toBeVisible();
  await expect(page.locator("[data-bp-sports] .bp-hero-copy-stage")).toBeVisible();
  await expect(page.locator("[data-bp-sports] .home-page-scale")).toHaveCount(1);
  await expect(page.locator("[data-bp-sports] .media-card-frame").first()).toHaveCSS("width", "425px");
  await expect(page.locator("[data-bp-sports] .media-card-frame").first()).toHaveCSS("height", "248px");
  await expect(page.locator("[data-bp-sports] [data-row-view-more]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Real Madrid vs Barcelona" })).toBeVisible();
  const backdrop = page.locator("[data-bp-sports] .bp-bg__still").first();
  await expect(backdrop).toHaveAttribute("src", "/sports-test-art.svg");
  await expect.poll(() => backdrop.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(trailerRequests).toEqual([]);
  await page.screenshot({ path: "artifacts/sports/home-1920.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "artifacts/sports/home-1280.png" });
  await page.locator('.media-card-frame[role="button"]').first().focus();
  await page.screenshot({ path: "artifacts/sports/catalogs-1280.png" });
});

test("los ajustes usan Sports y no la marca del backend", async ({ page }) => {
  await setupSports(page);
  await page.goto("/big-picture/settings?tab=sources");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.getByRole("heading", { name: "Sports", exact: true })).toBeVisible();
  await expect(page.locator(".bp-settings-page__content")).not.toContainText(/Nuvio/i);
  await expect(page.locator(".bp-settings-page__content")).not.toContainText("Live Sports");
});

test("Ahora mismo aparece justo antes de Próximamente y abre el partido en directo", async ({ page }) => {
  await setupSports(page);
  await setupUpcomingSchedule(page);
  const now = page.locator('[data-row-key*="sports-now"]');
  await expect(now).toHaveAttribute("data-row-count", "1");
  await expect(page.locator("[data-bp-sports] .home-row-title")).toHaveText(["Ahora mismo", "Próximamente", "Repeticiones"]);
  await now.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/sports/now-1920.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await now.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/sports/now-1280.png" });
  await now.getByRole("button", { name: "Real Madrid vs Barcelona", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=sports-test/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!).url)).toBe("https://sports.test/live.m3u8");
});

test("las filas de directo y agenda se actualizan solas y Ahora mismo desaparece cuando no hay partidos", async ({ page }) => {
  await page.clock.install();
  await setupSports(page);
  await setupUpcomingSchedule(page);
  const now = page.locator('[data-row-key*="sports-now"]');
  await expect(now).toHaveCount(1);
  await page.evaluate(() => {
    const [live] = JSON.parse(localStorage.getItem("aetherio-live-sports-local-events")!);
    localStorage.setItem("sports-home-live-fixture", JSON.stringify(live));
    localStorage.setItem("aetherio-live-sports-local-events", "[]");
    const [upcoming] = JSON.parse(localStorage.getItem("sports-home-upcoming")!);
    localStorage.setItem("sports-home-upcoming", JSON.stringify([{ ...upcoming, id: "next-2", title: "Sevilla vs Atlético de Madrid", home: { name: "Sevilla" }, away: { name: "Atlético de Madrid" } }]));
  });
  await page.clock.fastForward(60_000);
  await expect(now).toHaveCount(0);
  await expect(page.locator(".home-row-title", { hasText: "Ahora mismo" })).toHaveCount(0);
  await expect(page.locator('[data-row-key*="sports-now"]')).toHaveCount(0);
  await expect(page.locator('[data-row-key*="sports-upcoming"]').getByRole("button", { name: "Sevilla vs Atlético de Madrid", exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.setItem("aetherio-live-sports-local-events", `[${localStorage.getItem("sports-home-live-fixture")}]`));
  await page.clock.fastForward(60_000);
  await expect(now).toHaveAttribute("data-row-count", "1");
});

test("Repeticiones vuelve a comprobar las fuentes periódicamente sin pulsar Actualizar", async ({ page }) => {
  await page.clock.install();
  await setupSports(page, false, 2, false, [1]);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "1");
  await expect(replays).toHaveAttribute("aria-busy", "false");

  await page.evaluate(() => { (window as any).sportsReplayMissingIds = [0]; });
  await page.clock.fastForward(60_000);
  await expect(replays.getByRole("button", { name: "LaLiga Repetición 1", exact: true })).toBeVisible();
  await expect(replays.getByRole("button", { name: "LaLiga Repetición 0", exact: true })).toHaveCount(0);

  await page.evaluate(() => { (window as any).sportsReplayMissingIds = [0, 1]; });
  await page.clock.fastForward(60_000);
  await expect(replays.locator("[data-row-count]")).toHaveCount(0);

  await page.evaluate(() => { (window as any).sportsReplayMissingIds = []; });
  await page.clock.fastForward(60_000);
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "2");
});

test("Repeticiones resuelve fuentes al listar y pagina más allá de 200", async ({ page }) => {
  await setupSports(page, false, 205);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  const row = replays.locator("[data-row-count]");
  await expect(row).toHaveAttribute("data-row-count", "100");
  await expect.poll(() => page.evaluate(() => (window as any).sportsReplayStreamRequests)).toBe(100);
  await replays.getByRole("button", { name: "Cargar más repeticiones", exact: true }).click();
  await expect(row).toHaveAttribute("data-row-count", "200");
  await expect.poll(() => page.evaluate(() => (window as any).sportsReplayStreamRequests)).toBe(200);
  await replays.getByRole("button", { name: "Cargar más repeticiones", exact: true }).click();
  await expect(row).toHaveAttribute("data-row-count", "205");
  await expect.poll(() => page.evaluate(() => (window as any).sportsReplayStreamRequests)).toBe(205);
  // "Hoy" ya lo dio todo con 5 metas: el plan salta a la siguiente fuente…
  await replays.getByRole("button", { name: "Cargar más repeticiones", exact: true }).click();
  // …misma lectura que recorre ayer, semana y older (vacíos) y apaga el botón
  // porque el plan se agotó sin traer una sola repetición más.
  await expect(row).toHaveAttribute("data-row-count", "205");
  await expect.poll(() => page.evaluate(() => (window as any).sportsReplayStreamRequests)).toBe(205);
  await expect(replays.getByRole("button", { name: "Cargar más repeticiones", exact: true })).toHaveCount(0);
  await row.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(replays.getByRole("button", { name: "LaLiga Repetición 204", exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/sports/replays-1920.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: "artifacts/sports/replays-1280.png" });
});

test("una página sin fuentes permite avanzar y reintentar la siguiente página", async ({ page }) => {
  await setupSports(page, false, 101, false, Array.from({ length: 100 }, (_, index) => index));
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await expect(replays.locator("[data-row-count]")).toHaveCount(0);
  await expect(replays.getByRole("button", { name: "Cargar más repeticiones", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).sportsReplayFailSkip = 100; });
  await replays.getByRole("button", { name: "Cargar más repeticiones", exact: true }).click();
  await expect(replays.getByRole("alert")).toContainText(/repeticiones/i);
  await page.evaluate(() => { (window as any).sportsReplayFailSkip = -1; });
  await replays.getByRole("button", { name: "Reintentar carga de repeticiones", exact: true }).click();
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "1");
  await expect(replays.getByRole("button", { name: "LaLiga Repetición 100", exact: true })).toBeVisible();
});

test("una página de repeticiones fallida conserva las cards y permite reintentar", async ({ page }) => {
  await setupSports(page, false, 105);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "100");
  await page.evaluate(() => { (window as any).sportsReplayFailSkip = 100; });
  await replays.getByRole("button", { name: "Cargar más repeticiones", exact: true }).click();
  await expect(replays.getByRole("alert")).toContainText(/repeticiones/i);
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "100");
  await page.evaluate(() => { (window as any).sportsReplayFailSkip = -1; });
  await replays.getByRole("button", { name: "Reintentar carga de repeticiones", exact: true }).click();
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "105");
});

test("una carga lenta de repeticiones no bloquea los directos ni la agenda", async ({ page }) => {
  await setupSports(page, false, 100, true);
  await expect(page.getByRole("heading", { name: "Real Madrid vs Barcelona" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver en directo", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Repeticiones", exact: true })).toContainText("Cargando repeticiones");
});

test("Repeticiones solo muestra los deportes elegidos y lo seguido", async ({ page }) => {
  await setupSports(page, false, 3);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "3");
  // El addon declara MMA, pero el usuario solo eligió fútbol: la fila se vacía.
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).sportsReplayGenre = "MMA"; });
  await replays.getByRole("button", { name: "Actualizar repeticiones", exact: true }).click();
  await expect(replays.locator("[data-row-count]")).toHaveCount(0);
  // El deporte vuelve a encajar, pero los títulos no casan con lo seguido: fuera.
  await page.evaluate(() => {
    const state = window as unknown as Record<string, unknown>;
    state.sportsReplayGenre = "FOOTBALL";
    state.sportsReplayTitlePrefix = "Premier League";
  });
  await replays.getByRole("button", { name: "Actualizar repeticiones", exact: true }).click();
  await expect(replays.locator("[data-row-count]")).toHaveCount(0);
  // Y regresan cuando el título vuelve a casar con LaLiga, la competición seguida.
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).sportsReplayTitlePrefix = "LaLiga"; });
  await replays.getByRole("button", { name: "Actualizar repeticiones", exact: true }).click();
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "3");
});

test("reintentar tras fallar una actualización recarga el catálogo aunque no queden páginas", async ({ page }) => {
  await setupSports(page, false, 1);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "1");
  await page.evaluate(() => { (window as any).sportsReplayFailSkip = 0; });
  await replays.getByRole("button", { name: "Actualizar repeticiones", exact: true }).click();
  await expect(replays.getByRole("alert")).toBeVisible();
  await page.evaluate(() => { (window as any).sportsReplayFailSkip = -1; });
  await replays.getByRole("button", { name: "Reintentar carga de repeticiones", exact: true }).click();
  await expect(replays.getByRole("alert")).toHaveCount(0);
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "1");
});

test("una repetición abre el reproductor VOD y Escape vuelve a Sports", async ({ page }) => {
  const movieLookups: string[] = [];
  page.on("request", request => { if (/(?:tmdb|cinemeta|theintrodb|aniskip)/.test(request.url()) && /(?:nuvio|replay|Repetici)/i.test(decodeURIComponent(request.url()))) movieLookups.push(request.url()); });
  await setupSports(page, false, 1);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await replays.getByRole("button", { name: "LaLiga Repetición 0", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=sports-replay&id=replay%3Anuvio_sport_replay_0/);
  expect(await page.evaluate(() => (window as any).sportsReplayStreamRequests)).toBe(1);
  const stream = await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!));
  expect(stream).toMatchObject({ url: "https://sports.test/replay.mp4", behaviorHints: { live: false, sportsReplay: true, headers: { Referer: "https://sports.test/" } } });
  expect(movieLookups).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture\/sports\/?$/);
  await expect(replays).toBeVisible();
});

test("la fila omite repeticiones sin fuentes y permite abrir una que sí las tiene", async ({ page }) => {
  await setupSports(page, false, 3, false, [0, 2]);
  const replays = page.getByRole("region", { name: "Repeticiones", exact: true });
  await expect(replays.locator("[data-row-count]")).toHaveAttribute("data-row-count", "1");
  await expect(replays.getByRole("button", { name: "LaLiga Repetición 0", exact: true })).toHaveCount(0);
  await expect(replays.getByRole("button", { name: "LaLiga Repetición 2", exact: true })).toHaveCount(0);
  await replays.getByRole("button", { name: "LaLiga Repetición 1", exact: true }).click();
  await expect(page).toHaveURL(/\/big-picture\/player\?type=sports-replay&id=replay%3Anuvio_sport_replay_1/);
});

test("un proveedor de imágenes caído no deja cards rotas ni un hero negro", async ({ page }) => {
  await setupSports(page, true);
  const card = page.locator("[data-bp-sports] .media-card-frame img").first();
  const hero = page.locator("[data-bp-sports] .bp-bg__still").first();
  for (const image of [card, hero]) {
    await expect(image).toHaveAttribute("src", /^data:image\/svg\+xml,/);
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
  const card = page.locator('.media-card-frame[role="button"]').first();
  await expect(card).toBeFocused();
  // A del mando: Enter sintético; keydown/keyup de pulsación corta.
  await page.evaluate(() => {
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true });
      Object.assign(event, { aetherioGamepadHold: true });
      document.activeElement?.dispatchEvent(event);
    }
  });
  await expect(page).toHaveURL(/\/big-picture\/player\?type=live&id=sports-test/);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream") ?? "null")?.url)).toBe("https://sports.test/live.m3u8");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture\/sports\/?$/);
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
  await expect(page).not.toHaveURL(/\/big-picture\/episode/);
});
