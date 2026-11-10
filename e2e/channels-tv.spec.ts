import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.setTimeout(60_000);

async function openGuide(page: Page, path = "/big-picture/channels") {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    let nextId = 1;
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback: () => nextId++,
        invoke: async (command: string) => command.startsWith("plugin:event|") ? nextId++ : null,
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
      },
      __TAURI__: { event: { listen: async () => () => undefined } },
    });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: "channels-tv", name: "Usuario", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", "channels-tv");
  });
  await page.route("**/api/tmdb/**", route => route.fulfill({ contentType: "application/json", body: '{"results":[]}' }));
  await page.goto(path);
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect(page.getByRole("heading", { name: "Canales", exact: true })).toBeVisible();
  if (path.startsWith("/big-picture")) await expect(page.getByRole("button", { name: /La 2, Planeta azul,/ })).toBeFocused();
}

test("TV abre su guía y enfoca el programa seleccionado, sin simular una señal", async ({ page }) => {
  await openGuide(page);
  await expect(page.locator("[data-bp-channels]")).toBeVisible();
  await expect(page.getByRole("button", { name: /La 2, Planeta azul,/ })).toBeFocused();
  await expect(page.getByText("Programación de ejemplo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reproducción no disponible en la maqueta" })).toBeDisabled();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
});

test("la cruceta recorre horarios y canales conservando la hora, y actualiza la vista previa", async ({ page }) => {
  await openGuide(page);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /La 2, Bosques del mundo,/ })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Bosques del mundo", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /Antena 3, Cocina abierta,/ })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("button", { name: /La 2, Bosques del mundo,/ })).toBeFocused();
  await expect(page).toHaveURL(/\/big-picture\/channels$/);
});

test("el foco revela programas fuera de pantalla sin desplazar la vista previa", async ({ page }) => {
  await openGuide(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  const previewTop = await page.locator(".channels-preview").evaluate(element => element.getBoundingClientRect().top);
  for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /La 2, Rutas con historia,/ })).toBeFocused();
  await expect.poll(() => page.locator(".channels-guide__scroll").evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowDown");
  const focused = page.locator(".channels-program:focus");
  await expect(focused).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".channels-preview")).toBeInViewport({ ratio: 1 });
  expect(await page.locator(".channels-preview").evaluate(element => element.getBoundingClientRect().top)).toBe(previewTop);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("el borde izquierdo abre el rail y vuelve al mismo programa", async ({ page }) => {
  await openGuide(page);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".bp-rail__expanded.is-visible")).toBeVisible();
  await expect(page.locator('.bp-rail__item[aria-current="page"]')).toContainText("Canales");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /La 2, Saber vivir,/ })).toBeFocused();
});

test("los filtros se activan con A y abajo entra al canal filtrado", async ({ page }) => {
  await openGuide(page);
  const cinema = page.getByRole("button", { name: "Cine", exact: true });
  await cinema.focus();
  await page.evaluate(() => {
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(event, "aetherioGamepadHold", { value: true });
      document.activeElement!.dispatchEvent(event);
    }
  });
  await expect(page.locator("[data-channel-row]")).toHaveCount(1);
  await expect(cinema).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: /Paramount Network, Una mañana de cine,/ })).toBeFocused();
});

test("buscar funciona sin teclado físico y B cierra solo el teclado", async ({ page }) => {
  await openGuide(page);
  const search = page.getByRole("button", { name: "Buscar canal", exact: true });
  await search.click();
  const dialog = page.getByRole("dialog", { name: "Buscar canal", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Escribir c", exact: true }).click();
  await dialog.getByRole("button", { name: "Escribir u", exact: true }).click();
  await dialog.getByRole("button", { name: "Escribir a", exact: true }).click();
  await expect(page.locator("[data-channel-row]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/\/big-picture\/channels$/);
  await search.click();
  expect(await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-input:back", { cancelable: true })))).toBe(false);
  await expect(dialog).toHaveCount(0);
  await expect(search).toBeFocused();
});

test("búsqueda vacía se recupera con mando y Ahora devuelve el programa actual", async ({ page }) => {
  await openGuide(page);
  await page.getByRole("button", { name: "Buscar canal", exact: true }).click();
  await page.keyboard.type("zzzz");
  await page.getByRole("button", { name: "Ver canales", exact: true }).click();
  await expect(page.getByText("No encontramos ese canal.", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Restablecer filtros" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-channel-row]")).toHaveCount(7);
  await page.getByRole("button", { name: /La 1, Aquí la Tierra,/ }).focus();
  await page.getByRole("button", { name: "Ahora", exact: true }).click();
  await expect(page.getByRole("button", { name: /La 1, La mañana,/ })).toBeFocused();
  await expect(page.getByRole("heading", { name: "La mañana", exact: true })).toBeVisible();
});

test("F10 conserva Canales al alternar entre escritorio y TV", async ({ page }) => {
  await openGuide(page, "/channels");
  await page.keyboard.press("F10");
  await expect(page).toHaveURL(/\/big-picture\/channels$/);
  await expect(page.locator("[data-bp-channels]")).toBeVisible();
  await page.keyboard.press("F10");
  await expect(page).toHaveURL(/\/channels$/);
});

test("B desde una entrada directa vuelve al inicio TV, nunca sale a escritorio", async ({ page }) => {
  await openGuide(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/big-picture$/);
});

test("el teclado contiene el foco y admite números, borrado y ventana 720p", async ({ page }) => {
  await openGuide(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Buscar canal", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Buscar canal", exact: true });
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "lb" } })));
  await expect(dialog.getByRole("button", { name: "Escribir 1", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status").first()).toContainText("1");
  await page.keyboard.press("Backspace");
  await expect(dialog.getByRole("status").first()).toContainText("Nombre del canal");
  for (let index = 0; index < 12; index++) await page.keyboard.press("ArrowRight");
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "Ver canales", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
});

if (process.env.CHANNELS_TV_CAPTURE === "1") {
  test("revisión agrupada: 1080p, 720p, 4K y búsqueda", async ({ page }) => {
    mkdirSync(".impeccable/review/channels-tv", { recursive: true });
    await openGuide(page);
    await page.locator(".channels-preview img").evaluate((image: HTMLImageElement) => image.decode());
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height] of [[1920, 1080], [1280, 720], [3840, 2160]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `.impeccable/review/channels-tv/${height}p.png` });
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.getByRole("button", { name: "Buscar canal", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Buscar canal", exact: true })).toBeVisible();
    await page.screenshot({ path: ".impeccable/review/channels-tv/search.png" });
  });
}
