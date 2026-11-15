import { expect, test, type Page } from "@playwright/test";

const PROFILE = "continue-background-e2e";
const SCOPE = `aetherio-profile:${PROFILE}:`;
const MEDIA_KEY = "series:tmdb:990002";
const IMAGE_BASE = "https://image.tmdb.org/t/p";
const BACKDROP = `${IMAGE_BASE}/original/series-backdrop.svg`;
const STILL = `${IMAGE_BASE}/w780/episode-still.svg`;
const ALTERNATIVE = `${IMAGE_BASE}/original/alternative-backdrop.svg`;

async function installFixture(page: Page, cachedBackground: boolean) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(({ profile, scope, mediaKey, backdrop, still, cachedBackground }) => {
    const target = window as unknown as Record<string, any>;
    let callbackId = 1;
    target.__TAURI_INTERNALS__ = {
      transformCallback: () => callbackId++,
      invoke: async (command: string) => command.startsWith("plugin:event|") ? callbackId++ : null,
      convertFileSrc: (value: string) => value,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    target.__TAURI__ = { event: { listen: async () => () => undefined } };
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
    if (localStorage.getItem("continue-background-seeded")) return;
    localStorage.setItem("continue-background-seeded", "1");
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profile, name: "Prueba", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profile);
    localStorage.setItem(`${scope}aetherio-continue-watching-v1`, JSON.stringify([{
      key: `${mediaKey}:1:2`, mediaKey, type: "series", id: "tmdb:990002",
      name: "Serie de prueba", season: 1, episode: 2, episodeName: "Capítulo de prueba",
      background: still, episodeStill: still, poster: backdrop, logo: backdrop,
      currentTime: 120, duration: 2400, completed: false, updatedAt: Date.now(),
    }]));
    if (cachedBackground) {
      sessionStorage.setItem("aetherio-detail-media-meta-v1", JSON.stringify({
        [mediaKey]: { id: "tmdb:990002", type: "series", name: "Serie de prueba", background: backdrop },
      }));
    }
  }, { profile: PROFILE, scope: SCOPE, mediaKey: MEDIA_KEY, backdrop: BACKDROP, still: STILL, cachedBackground });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === "image") {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#334455"/></svg>',
      });
    }
    if (url.pathname.includes("/api/tmdb/") || url.hostname === "api.themoviedb.org") {
      const body = /\/tv\/990002\/images$/.test(url.pathname)
        ? { backdrops: [{ file_path: "/alternative-backdrop.svg", iso_639_1: null }] }
        : /\/tv\/990002$/.test(url.pathname)
          ? {
            id: 990002, name: "Serie de prueba", original_name: "Serie de prueba",
            backdrop_path: "/series-backdrop.svg", first_air_date: "2020-01-01",
            seasons: [], genres: [], credits: { cast: [], crew: [] },
            images: { backdrops: [], logos: [] }, videos: { results: [] },
          }
          : { results: [], seasons: [], episodes: [], air_date: "2020-01-01" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort("blockedbyclient");
  });
}

for (const mode of [
  { name: "PC", home: "/home", detail: "/detail/series/tmdb%3A990002" },
  { name: "TV", home: "/big-picture", detail: "/big-picture/detail/series/tmdb%3A990002" },
]) {
  for (const cachedBackground of [false, true]) {
    test(`${mode.name}: continuar conserva el fondo del medio ${cachedBackground ? "cacheado" : "sin caché"}, no el del capítulo`, async ({ page }) => {
      await installFixture(page, cachedBackground);
      await page.goto(mode.home);
      const card = page.locator('[data-row-key="continue-watching"] .media-card-frame').first();
      await expect(card).toBeVisible();
      await expect(card.locator("img").first()).toHaveAttribute("src", /episode-still\.svg/);
      await card.click();
      await expect(page).toHaveURL(new RegExp(mode.detail.replaceAll("/", "\\/")));
      const root = page.locator(".detail-page-root:visible");
      await expect(root.locator('img[width="1920"]').last()).toHaveAttribute("src", BACKDROP);
      await expect.poll(() => page.evaluate(mediaKey =>
        JSON.parse(sessionStorage.getItem("aetherio-detail-media-meta-v1") ?? "{}")[mediaKey]?.background,
      MEDIA_KEY)).toBe(BACKDROP);
    });
  }

  test(`${mode.name}: el selector carga alternativas y guarda el fondo elegido al reabrir`, async ({ page }) => {
    await installFixture(page, false);
    await page.goto(mode.detail);
    const root = page.locator(".detail-page-root:visible");
    await root.getByRole("button", { name: "Opciones del medio", exact: true }).click();
    await page.getByRole("menuitem", { name: "Elegir fondo del medio", exact: true }).click();
    const picker = page.locator("[data-artwork-picker]");
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "TMDB 1", exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(root.locator('img[width="1920"]').last()).toHaveAttribute("src", ALTERNATIVE);
    await expect.poll(() => page.evaluate(key =>
      JSON.parse(localStorage.getItem(key) ?? "{}")["series:tmdb:990002"],
    `${SCOPE}aetherio-detail-background-override-v1`)).toBe(ALTERNATIVE);
    await page.reload();
    await expect(page.locator('.detail-page-root:visible img[width="1920"]').last()).toHaveAttribute("src", ALTERNATIVE);
  });
}
