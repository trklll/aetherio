import { expect, test, type Page } from "@playwright/test";

/**
 * Foco del mando al entrar a Modo Sports.
 *
 * Entrar por el rail (el camino normal con mando) dejaba el foco en el item
 * del rail: ya colapsado e invisible, el motor ignora teclas dentro del rail,
 * así que la página cargaba con el mando muerto (flechas que no movían nada y
 * Left que no reabría nada). Regresión en `BigPictureRail` (soltar el foco
 * cuando el restore apunta a una page desmontada) y `BigPictureSportsHome`
 * (requester de foco propio, como Party/Genre/Search/Settings).
 */

async function setupSports(page: Page) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
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
    const profileId = "sports-rail-focus-e2e";
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
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify([live]));
    localStorage.setItem("aetherio-live-sports-snapshot", JSON.stringify({ events: [live], upcoming: [], channels: [], fetchedAt: Date.now() }));
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-sports-preferences`, JSON.stringify({
      version: 1, onboarding: "completed", sports: ["futbol"],
      followedCompetitions: [], followedClubs: [], followedNationalTeams: [],
      followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos",
    }));
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const pathname = new URL(url).pathname;
      if (/\/catalog\/tv\/nuvio_sports/.test(pathname)) return Promise.resolve(new Response(JSON.stringify({ metas: [] })));
      if (url.includes("127.0.0.1:7310/api/provider-health")) return Promise.resolve(new Response(JSON.stringify({ sync: { state: "idle" } })));
      if (/nuviosports/.test(url)) return Promise.resolve(new Response(JSON.stringify({ metas: [] })));
      return originalFetch(input, init);
    };
  });
  await page.route("**/sports-test-art.svg", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#303e42"/></svg>',
  }));
  await page.route("**/api/tmdb/**", route => route.fulfill({ json: { results: [], total_pages: 1 } }));
}

test("entrar a Sports desde el rail con el mando deja el foco en la página", async ({ page }) => {
  await setupSports(page);
  await page.goto("/big-picture");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.locator(".bp-rail__collapsed")).toBeVisible();

  // El rail se abre y enfoca sus items: el foco entra al item Sports.
  await page.locator(".bp-rail__collapsed").focus();
  await expect(page.locator(".bp-rail__expanded.is-visible")).toBeVisible();
  await page.locator(".bp-rail__item", { hasText: "Sports" }).focus();
  await expect(page.locator(".bp-rail__item.is-focused", { hasText: "Sports" })).toBeVisible();

  // A del mando: activa el item y navega a Sports.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/sports\/?$/);
  await expect(page.locator("[data-bp-sports]")).toBeVisible();

  // El foco NO puede quedarse en el rail colapsado (item invisible): la page
  // enfoca su acción principal ("Ver en directo").
  await expect(page.locator("[data-bp-sports] [data-hero-primary]")).toBeFocused();
  const activeLabel = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? "");
  expect(activeLabel).toContain("Ver en directo");

  // El mando sigue vivo: Down baja de la acción primaria a la primera card.
  await page.keyboard.press("ArrowDown");
  const card = page.locator('.media-card-frame[role="button"]').first();
  await expect(card).toBeFocused();
  await expect(page.locator("[data-hero-primary]")).not.toBeFocused();
});

test("con la agenda tardando, Sports enfoca su contenido apenas carga", async ({ page }) => {
  // Sin snapshot cacheado: el hero aparece cuando el proveedor responde.
  await setupSports(page);
  await page.addInitScript(() => { localStorage.removeItem("aetherio-live-sports-snapshot"); });
  await page.goto("/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver en directo", exact: true })).toBeFocused();
});

test("ruta directa a /big-picture/sports enfoca la acción principal", async ({ page }) => {
  await setupSports(page);
  await page.goto("/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.locator("[data-bp-sports]")).toBeVisible();
  await expect(page.locator("[data-bp-sports] [data-hero-primary]")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.media-card-frame[role="button"]').first()).toBeFocused();
});

test("se puede navegar al perfil desde el rail con el mando", async ({ page }) => {
  await setupSports(page);
  await page.goto("/big-picture");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.locator(".bp-rail__collapsed")).toBeVisible();

  await page.locator(".bp-rail__collapsed").focus();
  const searchItem = page.locator(".bp-rail__item", { hasText: "Buscar" });
  const profileButton = page.getByRole("button", { name: "Abrir ajustes del perfil" });

  // Desde Inicio, sube a Buscar y una vez más al perfil del encabezado.
  await expect(page.locator(".bp-rail__item", { hasText: "Inicio" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(searchItem).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(profileButton).toBeFocused();
  await expect(page.locator(".bp-rail__item.is-focused")).toHaveCount(0);
  await expect(page.locator(".bp-rail__indicator")).toBeHidden();

  // También se puede volver al menú y activar el perfil con A/Enter.
  await page.keyboard.press("ArrowDown");
  await expect(searchItem).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(profileButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/settings\/?$/);
  await expect(page.locator("[data-bp-settings]")).toBeVisible();
  await expect(page.locator("[data-bp-settings-primary]")).toBeFocused();
});
