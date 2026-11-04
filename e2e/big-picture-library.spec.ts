import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
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
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-saved-library-v1`, JSON.stringify(
      Array.from({ length: 30 }, (_, index) => ({
        id: `tmdb:${424242 + index}`,
        type: index % 2 ? "series" : "movie",
        name: `Título ${String(index + 1).padStart(2, "0")}`,
        poster: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="197" height="296"><rect width="197" height="296" fill="${index % 2 ? "#303b48" : "#35433c"}"/><text x="20" y="155" fill="white" font-size="22">Título ${String(index + 1).padStart(2, "0")}</text></svg>`)}`,
        genres: index % 2 ? ["Comedia"] : ["Drama"],
        addedAt: 30 - index,
      })),
    ));
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ results: [], total_pages: 1 }),
  }));
});

async function openLibrary(page: Page, path = "/big-picture/library") {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Mi biblioteca", exact: true })).toBeVisible({ timeout: 20_000 });
}

test("TV conserva la composición, filtros y tarjetas de escritorio", async ({ page }) => {
  await openLibrary(page, "/library");
  const desktop = await page.getByRole("button", { name: "Título 01", exact: true }).boundingBox();
  await page.screenshot({ path: "artifacts/library-controller/desktop.png" });
  await openLibrary(page);
  await expect(page.getByRole("button", { name: "Mi biblioteca", exact: true })).toBeFocused();
  await expect(page.getByText("En tu biblioteca", { exact: true })).toBeVisible();
  await expect(page.getByText("Series y anime", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Secciones de la biblioteca" })).toHaveCount(0);
  for (const label of ["Lista", "Tipo", "Género", "Orden"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${label}:`) })).toBeVisible();
  }
  const card = page.getByRole("button", { name: "Título 01", exact: true });
  const tv = await card.boundingBox();
  expect(tv?.width).toBe(desktop?.width);
  expect(tv?.height).toBe(desktop?.height);
  await expect(card.locator("..").getByText("Título 01", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/library-controller/tv.png" });
});

test("el foco de AniList distingue los dos botones al navegar con la cruceta", async ({ page }) => {
  await openLibrary(page);
  const connect = page.getByRole("button", { name: "Conectar cuenta", exact: true });
  const sync = page.getByRole("button", { name: "Sincronizar ahora", exact: true });

  await connect.focus();
  await expect(connect).toBeFocused();
  await expect.poll(() => connect.evaluate(element => getComputedStyle(element).borderTopColor)).toBe("rgba(255, 255, 255, 0.98)");
  await expect.poll(() => connect.evaluate(element => getComputedStyle(element).transform)).toContain("matrix");
  await page.screenshot({ path: "artifacts/library-controller/anilist-focus-connect.png" });

  await page.keyboard.press("ArrowRight");
  await expect(sync).toBeFocused();
  await expect.poll(() => sync.evaluate(element => getComputedStyle(element).borderTopColor)).toBe("rgba(35, 35, 37, 0.98)");
  await expect.poll(() => sync.evaluate(element => getComputedStyle(element).transform)).toContain("matrix");
  await page.screenshot({ path: "artifacts/library-controller/anilist-focus-sync.png" });
});

test("los filtros se recorren con cruceta, confirman con A y cancelan con B", async ({ page }) => {
  await openLibrary(page);
  const list = page.getByRole("button", { name: /^Lista:/ });
  const type = page.getByRole("button", { name: /^Tipo:/ });
  await list.focus();
  await page.keyboard.press("ArrowRight");
  await expect(type).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Tipo", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Todo (30)", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("button", { name: "Películas (15)", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(type).toBeFocused();
  await expect(type).toContainText("Películas (15)");
  await expect(page.locator("[data-library-media-key]")).toHaveCount(15);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Películas (15)", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const unhandled = await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-input:back", { cancelable: true })));
  expect(unhandled).toBe(false);
  await expect(dialog).toHaveCount(0);
  await expect(type).toBeFocused();
  await expect(type).toContainText("Películas (15)");
  await expect(page).toHaveURL(/\/big-picture\/library$/);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(type).toBeFocused();
});

test("el grid navega por filas, mantiene el modo TV y restaura foco y scroll al volver", async ({ page }) => {
  await openLibrary(page);
  const cards = page.locator("[data-library-media-key]");
  await cards.first().focus();
  const firstBox = await cards.first().boundingBox();
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const active = page.locator("[data-library-media-key]:focus");
  const lowerBox = await active.boundingBox();
  expect(lowerBox!.y).toBeGreaterThan(firstBox!.y);
  await cards.nth(24).focus();
  await expect(cards.nth(24)).toBeInViewport();
  const key = await cards.nth(24).getAttribute("data-library-media-key");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/detail\/movie\/tmdb%3A424266/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture\/library$/);
  await expect(page.locator(`[data-library-media-key="${key}"]`)).toBeFocused();
  await expect(page.locator(`[data-library-media-key="${key}"]`)).toBeInViewport();
});

test("Descubrir conserva sus filtros y permite recorrer todos los géneros sin salir del cuadro", async ({ page }) => {
  await openLibrary(page);
  await page.getByRole("button", { name: "Descubrir", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Descubrir", exact: true })).toBeVisible();
  const genre = page.getByRole("button", { name: /^Género:/ });
  await genre.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Género", exact: true });
  await expect(dialog.getByRole("button", { name: "Película de TV", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button")).toHaveCount(21); // Todos, 19 géneros y cerrar.
  for (let index = 0; index < 19; index += 1) await page.keyboard.press("ArrowDown");
  const focused = dialog.locator("button:focus");
  await expect(focused).toBeInViewport();
  await page.screenshot({ path: "artifacts/library-controller/tv-picker.png" });
  const chosen = await focused.innerText();
  await page.keyboard.press("Enter");
  await expect(genre).toBeFocused();
  await expect(genre).toContainText(chosen.trim());
});

test("escritorio mantiene los selectores nativos", async ({ page }) => {
  await openLibrary(page, "/library");
  await expect(page.getByRole("combobox", { name: "Tipo", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Tipo", exact: true }).selectOption("movie");
  await expect(page.getByRole("button", { name: "Título 02", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Título 01", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("A sintético del mando abre y confirma el selector sin doble activación", async ({ page }) => {
  await openLibrary(page);
  const order = page.getByRole("button", { name: /^Orden:/ });
  await order.focus();
  const confirm = () => page.evaluate(() => {
    const target = document.activeElement!;
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(event, "aetherioGamepadHold", { value: true });
      target.dispatchEvent(event);
    }
  });
  await confirm();
  const dialog = page.getByRole("dialog", { name: "Orden", exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
    key: "ArrowDown", bubbles: true, cancelable: true,
  })));
  await expect(dialog.getByRole("button", { name: "Añadidos primero", exact: true })).toBeFocused();
  await confirm();
  await expect(dialog).toHaveCount(0);
  await expect(order).toBeFocused();
  await expect(order).toContainText("Añadidos primero");
  await expect(page.locator("[data-library-media-key]").first()).toHaveAttribute("aria-label", "Título 30");
});

test("Descubrir restaura las páginas cargadas y el póster seleccionado", async ({ page }) => {
  await page.route("**/api/tmdb/discover/movie?*", route => {
    const current = Number(new URL(route.request().url()).searchParams.get("page") ?? 1);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      results: Array.from({ length: 20 }, (_, index) => ({ id: current * 100 + index, title: `Catálogo ${current}-${index}` })),
      total_pages: 2,
    }) });
  });
  await openLibrary(page);
  await page.getByRole("button", { name: "Descubrir", exact: true }).click();
  await expect(page.locator("[data-library-media-key]")).toHaveCount(20);
  const more = page.getByRole("button", { name: "Mostrar más", exact: true });
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-library-media-key]")).toHaveCount(40);
  const card = page.getByRole("button", { name: "Catálogo 2-5", exact: true });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/detail\/movie\/tmdb%3A205/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Descubrir", exact: true })).toBeVisible();
  await expect(page.locator("[data-library-media-key]")).toHaveCount(40);
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport();
});

test("una biblioteca vacía mantiene las pestañas accesibles con el mando", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aetherio-profile:library-e2e:aetherio-saved-library-v1", "[]"));
  await openLibrary(page);
  await expect(page.getByText("Tu biblioteca se llenará automáticamente.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mi biblioteca", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Descubrir", exact: true })).toBeFocused();
});

test("el modo TV en ventana mantiene filtros y cuadro dentro de la pantalla", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openLibrary(page);
  const genre = page.getByRole("button", { name: /^Género:/ });
  await genre.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Género", exact: true });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("ArrowDown");
  await expect(dialog.getByRole("button", { name: "Comedia (15)", exact: true })).toBeFocused();
  await page.screenshot({ path: "artifacts/library-controller/tv-1280.png" });
  await page.keyboard.press("Escape");
  await expect(genre).toBeFocused();
  await expect(genre).toBeInViewport();
});

test("al subir desde los pósters hasta los filtros, revela completa la cabecera", async ({ page }) => {
  await openLibrary(page);
  const shell = page.locator("[data-aetherio-scroll-shell]");
  const cards = page.locator("[data-library-media-key]");
  await cards.last().focus();
  await expect(cards.last()).toBeInViewport();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("[data-library-media-key]:focus")).toHaveCount(0);
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBe(0);
  const heading = await page.getByRole("heading", { name: "Mi biblioteca", exact: true }).boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(0);
});
