import { expect, test } from "@playwright/test";

test("Big Picture biblioteca filtra sus géneros y muestra el catálogo completo en Descubrir", async ({ page }) => {
  test.setTimeout(60_000);
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

    const profileId = "library-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Test", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-saved-library-v1`, JSON.stringify([
      { id: "tmdb:424242", type: "movie", name: "E2E Drama", genres: ["Drama"], addedAt: 1 },
    ]));
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ results: [], total_pages: 1 }),
  }));

  await page.goto("/big-picture/library", { waitUntil: "domcontentloaded" });
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await expect(page.locator("[data-bp-library]")).toBeVisible({ timeout: 20_000 });

  const nav = page.getByRole("navigation", { name: "Secciones de la biblioteca" });
  await expect(nav.getByRole("button", { name: "Drama" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Comedia" })).toHaveCount(0);

  const card = page.locator('[data-library-media-key="movie:tmdb:424242"]');
  const title = card.locator("xpath=following-sibling::div");
  await card.focus();
  await expect(title).toHaveCSS("opacity", "1");
  await card.evaluate(element => (element as HTMLButtonElement).blur());
  await expect(title).toHaveCSS("opacity", "0");

  await nav.getByRole("button", { name: "Descubrir" }).click();

  const movieGenre = page.getByRole("combobox", { name: "Género para descubrir" });
  await expect(movieGenre).toBeVisible();
  await expect(movieGenre.locator("option")).toHaveCount(20); // Todos + los 19 géneros oficiales de películas.
  await movieGenre.selectOption({ label: "Película de TV" });
  await expect(movieGenre).toHaveValue("Película de TV");
});
