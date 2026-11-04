import { expect, test } from "@playwright/test";

test("streaming platform navigation matches desktop and Big Picture", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    let nextId = 1;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => nextId++,
      invoke: async (command: string) => (command.startsWith("plugin:event|") ? nextId++ : null),
      convertFileSrc: (value: string) => value,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };

    const profileId = "streaming-platform-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Test", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    sessionStorage.setItem("aetherio.streaming-platform-intros.v1", JSON.stringify(["apple-tv-plus"]));
  });
  await page.route("**/api/tmdb/**", route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/movie/424242")
      ? { belongs_to_collection: { id: 707070, name: "Colección de prueba", poster_path: "/collection.jpg", backdrop_path: "/collection-bg.jpg" } }
      : path.endsWith("/collection/707070")
        ? {
          id: 707070,
          name: "Colección de prueba",
          parts: [
            { id: 424242, title: "Película de prueba", poster_path: "/poster.jpg", release_date: "2024-01-01", vote_average: 8.2 },
            { id: 424243, title: "Secuela de prueba", poster_path: "/poster-2.jpg", release_date: "2025-01-01", vote_average: 7.9 },
          ],
        }
        : {
          results: [{
            id: 424242,
            title: "Película de prueba",
            name: "Serie de prueba",
            poster_path: "/poster.jpg",
            backdrop_path: "/backdrop.jpg",
            overview: "Contenido de prueba para explorar la plataforma.",
            release_date: "2024-01-01",
            first_air_date: "2024-01-01",
            vote_average: 8.2,
            vote_count: 500,
            genre_ids: [18],
            original_language: "es",
          }],
          total_pages: 1,
        };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/big-picture/platform/apple-tv-plus", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Apple TV+" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-row-view-more]")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Ver más: Top 10 Películas" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir colección Colección de prueba" })).toBeVisible();
  const pictureSpacing = await page.evaluate(() => {
    const title = document.querySelector(".streaming-platform-hero__copy h1");
    const description = document.querySelector(".streaming-platform-hero__copy p");
    const firstRow = document.querySelector("[data-row-header]");
    if (!title || !description || !firstRow) return null;
    return {
      titleTop: title.getBoundingClientRect().top,
      descriptionToRow: firstRow.getBoundingClientRect().top - description.getBoundingClientRect().bottom,
    };
  });
  expect(pictureSpacing).not.toBeNull();
  expect(pictureSpacing!.titleTop).toBeLessThan(240);
  expect(pictureSpacing!.descriptionToRow).toBeLessThan(80);

  // Returning to the first catalog row must restore the platform hero as well,
  // not align the focused card at the top and clip the logo/description.
  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".streaming-platform-catalog [data-row-key]"));
    const secondCard = rows[1]?.querySelector<HTMLElement>("[data-row-card]");
    if (!shell || !rows[1] || !secondCard) throw new Error("Expected a second platform row with a focusable card");
    const shellRect = shell.getBoundingClientRect();
    shell.scrollTop += rows[1].getBoundingClientRect().top - shellRect.top;
    secondCard.focus({ preventScroll: true });
  });
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => page.locator("[data-aetherio-scroll-shell]").evaluate(el => (el as HTMLElement).scrollTop)).toBeLessThan(3);
  await expect(page.locator(".streaming-platform-hero__title img")).toBeInViewport();
  await expect(page.locator(".streaming-platform-hero__copy p")).toBeInViewport();

  await page.getByRole("button", { name: "Abrir colección Colección de prueba" }).click();
  await expect(page).toHaveURL(/\/big-picture\/catalog\?.*tmdb\.collection\.707070/);
  await expect(page.locator(".bp-genre__title")).toHaveText("Colección de prueba");
  await expect(page.locator(".bp-genre__subtitle")).toHaveText("2 títulos");
  await page.goBack();
  await expect(page.locator("[data-streaming-platform='apple-tv-plus']")).toBeVisible();

  await page.getByRole("button", { name: "Ver más: Películas populares" }).click();
  await expect(page).toHaveURL(/\/big-picture\/catalog\?/);
  await expect(page.locator(".bp-genre__subtitle")).toHaveText("1 títulos");
  await expect(page.locator(".bp-genre__status")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/platform/apple-tv-plus", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Apple TV+" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver", exact: true })).toBeVisible();
  await expect(page.locator("[data-row-view-more]")).toHaveCount(4);
  await page.getByRole("button", { name: "Abrir colección Colección de prueba" }).click();
  await expect(page).toHaveURL(/\/catalog\?.*tmdb\.collection\.707070/);
  await expect(page.getByText("2 títulos", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator("[data-streaming-platform='apple-tv-plus']")).toBeVisible();

  await page.getByRole("button", { name: "Películas populares", exact: true }).click();
  await expect(page).toHaveURL(/\/catalog\?/);
  await expect(page.getByText("1 títulos", { exact: true })).toBeVisible();
  await expect(page.getByText("Este catálogo no devolvió contenido.", { exact: true })).toHaveCount(0);
});

test("Big Picture restores the source platform card, scroll, blur and navigation on back", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    let nextId = 1;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => nextId++,
      invoke: async (command: string) => (command.startsWith("plugin:event|") ? nextId++ : null),
      convertFileSrc: (value: string) => value,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    const profileId = "streaming-platform-return-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Test", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ results: [], total_pages: 1 }),
  }));

  await page.goto("/big-picture", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".streaming-platform-card").first()).toBeVisible();
  const saved = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    const row = document.querySelector<HTMLElement>('[data-row-key="streaming-platforms"]');
    const scroller = row?.querySelector<HTMLElement>("[data-row-scroller]");
    const cards = Array.from(row?.querySelectorAll<HTMLElement>("[data-platform-id]") ?? []);
    const card = cards[cards.length - 2];
    if (!shell || !scroller || !card?.dataset.platformId) throw new Error("Big Picture Home platform row is missing");
    // Give the shell enough travel to verify restoration independently of the
    // catalog fixture's content length.
    shell.style.paddingBottom = "1400px";
    shell.scrollTop = 720;
    scroller.scrollLeft = Math.min(280, scroller.scrollWidth - scroller.clientWidth);
    card.focus({ preventScroll: true });
    return { vertical: shell.scrollTop, horizontal: scroller.scrollLeft, platformId: card.dataset.platformId };
  });
  expect(saved.vertical).toBeGreaterThan(0);
  const sourceCard = page.locator(`.streaming-platform-card[data-platform-id="${saved.platformId}"]`);
  await expect(sourceCard).toBeVisible();
  await sourceCard.evaluate(card => (card as HTMLButtonElement).click());
  await expect(page).toHaveURL(new RegExp(`/big-picture/platform/${saved.platformId}$`));

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture$/);
  await expect(sourceCard).toBeFocused();
  await expect.poll(() => page.locator("[data-aetherio-scroll-shell]").evaluate(el => (el as HTMLElement).scrollTop)).toBe(saved.vertical);
  await expect.poll(() => page.locator('[data-row-key="streaming-platforms"] [data-row-scroller]').evaluate(el => (el as HTMLElement).scrollLeft)).toBe(saved.horizontal);

  const expectedBlur = Math.round(Math.min(28, saved.vertical / 12));
  await expect.poll(() => page.locator(".bp-bg__image").evaluate(el => getComputedStyle(el).filter)).toBe(`blur(${expectedBlur}px)`);
  const nextPlatformId = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".streaming-platform-card"));
    const index = cards.findIndex(card => card.dataset.platformId === document.activeElement?.getAttribute("data-platform-id"));
    return cards[index + 1]?.dataset.platformId ?? null;
  });
  expect(nextPlatformId).not.toBeNull();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(`.streaming-platform-card[data-platform-id="${nextPlatformId}"]`)).toBeFocused();
});

test("marking a platform title watched transfers focus to a remaining card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const profileId = "streaming-mark-watched-focus-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Test", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    sessionStorage.setItem("aetherio.streaming-platform-intros.v1", JSON.stringify(["apple-tv-plus"]));
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      results: [
        { id: 424242, title: "Película para marcar", name: "Serie de prueba", poster_path: "/poster.jpg", backdrop_path: "/backdrop.jpg", vote_average: 8, vote_count: 500, genre_ids: [18], original_language: "es" },
        { id: 424243, title: "Siguiente película", name: "Siguiente serie", poster_path: "/poster-2.jpg", backdrop_path: "/backdrop-2.jpg", vote_average: 7, vote_count: 400, genre_ids: [18], original_language: "es" },
      ],
      total_pages: 1,
    }),
  }));

  await page.goto("/platform/apple-tv-plus", { waitUntil: "domcontentloaded" });
  const firstCard = page.locator(".media-card-frame").first();
  await expect(firstCard).toBeVisible();
  await firstCard.evaluate(element => element.setAttribute("data-mark-watched-focus-target", "true"));
  await firstCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar como visto", exact: true }).click();

  await expect(page.locator('[data-mark-watched-focus-target="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches(".media-card-frame") ?? false)).toBe(true);
});

test("streaming platform restores the exact row and card after returning from detail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const profileId = "streaming-detail-focus-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Test", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    sessionStorage.setItem("aetherio.streaming-platform-intros.v1", JSON.stringify(["apple-tv-plus"]));
  });
  const results = Array.from({ length: 20 }, (_, index) => ({
    id: 424242 + index,
    title: `Película ${index + 1}`,
    name: `Serie ${index + 1}`,
    poster_path: `/poster-${index + 1}.jpg`,
    backdrop_path: `/backdrop-${index + 1}.jpg`,
    overview: "Contenido de prueba para restaurar el foco.",
    release_date: "2024-01-01",
    first_air_date: "2024-01-01",
    vote_average: 8.5 - index / 10,
    vote_count: 500,
    genre_ids: [18],
    original_language: "es",
  }));
  await page.route("**/api/tmdb/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ results, total_pages: 1 }),
  }));

  await page.goto("/platform/apple-tv-plus", { waitUntil: "domcontentloaded" });
  const row = page.locator('[data-row-key="tmdb/streaming.apple-tv-plus.series.popular/series"]');
  const shell = page.locator("[data-aetherio-scroll-shell]");
  const scroller = row.locator("[data-row-scroller]");
  const card = row.locator('[data-item-index="3"] .media-card-frame');
  await expect(card).toBeVisible();
  await row.evaluate(element => {
    const scrollShell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    if (!scrollShell) throw new Error("Platform scroll shell not found");
    scrollShell.scrollTop = element.getBoundingClientRect().top - scrollShell.getBoundingClientRect().top;
  });
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  const savedPosition = await shell.evaluate(element => (element as HTMLElement).scrollTop);
  const savedHorizontal = await scroller.evaluate(element => (element as HTMLElement).scrollLeft);

  // Playwright's locator.click() auto-scrolls the target to its own preferred
  // alignment; dispatch the card activation directly so the assertion compares
  // the app's saved selection position, not that automation adjustment.
  await card.evaluate(element => (element as HTMLElement).click());
  await expect(page).toHaveURL(/\/detail\//);
  await page.goBack();

  await expect(row).toBeVisible();
  await expect(card).toBeFocused();
  await expect.poll(() => shell.evaluate(element => (element as HTMLElement).scrollTop)).toBe(savedPosition);
  await expect.poll(() => scroller.evaluate(element => (element as HTMLElement).scrollLeft)).toBe(savedHorizontal);
});
