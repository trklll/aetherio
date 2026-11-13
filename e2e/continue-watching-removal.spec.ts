import { expect, test, type Page } from "@playwright/test";

const PROFILE = "continue-removal-e2e";
const PROGRESS_KEY = `aetherio-profile:${PROFILE}:aetherio-continue-watching-v1`;
const IMAGE = "https://image.tmdb.org/t/p/original/removal-fixture.svg";

async function installRemovalFixture(page: Page, withNextEpisode: boolean) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(({ profile, progressKey, image, withNextEpisode }) => {
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
    // Do not re-seed on reload: the test must verify the persisted deletion.
    if (localStorage.getItem("continue-removal-seeded")) return;
    localStorage.setItem("continue-removal-seeded", "1");
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profile, name: "Prueba", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profile);
    const type = withNextEpisode ? "series" : "movie";
    const mediaKey = `${type}:tmdb:990002`;
    const entry = {
      key: withNextEpisode ? `${mediaKey}:1:2` : mediaKey,
      mediaKey, type, id: "tmdb:990002", name: "Título para eliminar",
      background: image, poster: image, logo: image, episodeStill: image,
      season: withNextEpisode ? 1 : undefined,
      episode: withNextEpisode ? 2 : undefined,
      currentTime: 120, duration: 2400, completed: false,
      entryKind: "resume", updatedAt: Date.now(),
    };
    const entries = withNextEpisode ? [
      entry,
      { ...entry, key: `${mediaKey}:1:3`, episode: 3, currentTime: 0, entryKind: "next" },
    ] : [entry];
    localStorage.setItem(progressKey, JSON.stringify(entries));
  }, { profile: PROFILE, progressKey: PROGRESS_KEY, image: IMAGE, withNextEpisode });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === "image") {
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#334455"/></svg>',
      });
    }
    if (url.pathname.includes("/api/tmdb/") || url.hostname === "api.themoviedb.org") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results: [], seasons: [], air_date: "2020-01-01" }),
      });
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort("blockedbyclient");
  });
}

for (const mode of [
  { name: "PC", path: "/home" },
  { name: "TV", path: "/big-picture" },
]) {
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    for (const withNextEpisode of [false, true]) {
      test(`${mode.name} (${reducedMotion}): quitar ${withNextEpisode ? "una serie con siguiente episodio oculto" : "la última película"} persiste tras refrescar`, async ({ page }) => {
        test.setTimeout(60_000);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.emulateMedia({ reducedMotion });
        await installRemovalFixture(page, withNextEpisode);
        await page.goto(mode.path);
        const row = page.locator('[data-row-key="continue-watching"]');
        await expect(row).toBeVisible();
        const card = row.locator(".media-card-frame").first();
        if (mode.name === "PC") {
          await card.getByRole("button", { name: "Más opciones", exact: true }).click();
          await page.getByRole("menuitem", { name: "Eliminar de la lista", exact: true }).click();
        } else {
          await card.focus();
          await page.keyboard.down("Enter");
          await expect(page.getByRole("menu")).toBeVisible();
          await page.keyboard.up("Enter");
          await page.getByRole("menuitem", { name: "Eliminar de la lista", exact: true }).focus();
          await page.keyboard.press("Enter");
        }
        await expect(row).toHaveCount(0);
        await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), PROGRESS_KEY)).toEqual([]);
        expect(errors).toEqual([]);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".home-page-scale")).toBeAttached();
        await expect(row).toHaveCount(0);
        expect(errors).toEqual([]);
      });
    }
  }
}
