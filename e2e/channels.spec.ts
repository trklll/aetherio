import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.setTimeout(60_000);

async function openChannels(page: Page) {
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
      { id: "channels-demo", name: "Usuario", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", "channels-demo");
  });
  await page.goto("/channels");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
}

test("Canales tiene ruta propia, entrada en la navegación y programación de ejemplo", async ({ page }) => {
  await openChannels(page);
  await expect(page.getByRole("heading", { name: "Canales", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Canales", exact: true })).toBeVisible();
  await expect(page.getByText("Programación de ejemplo", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planeta azul", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reproducción no disponible en la maqueta" })).toBeDisabled();
});

test("seleccionar un programa actualiza la vista previa sin simular reproducción", async ({ page }) => {
  await openChannels(page);
  await page.getByRole("button", { name: /La 1, Telediario 1,/ }).click();
  await expect(page.getByRole("heading", { name: "Telediario 1", exact: true })).toBeVisible();
  await expect(page.getByText("A continuación", { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/channels$/);
});

test("los filtros incluyen estado vacío y se pueden restablecer", async ({ page }) => {
  await openChannels(page);
  await page.getByRole("button", { name: "Cine", exact: true }).click();
  await expect(page.locator("[data-channel-row]")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Buscar canal" }).fill("canal inexistente");
  await expect(page.getByText("No encontramos ese canal.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restablecer filtros" }).click();
  await expect(page.locator("[data-channel-row]")).toHaveCount(7);
});

test("la navegación horaria vuelve al ahora de ejemplo y limita sus extremos", async ({ page }) => {
  await openChannels(page);
  const scroll = page.locator(".channels-guide__scroll");
  await expect(page.getByRole("button", { name: "Ver horario anterior" })).toBeDisabled();
  await page.getByRole("button", { name: "Ver horario siguiente" }).click();
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Ahora", exact: true }).click();
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(0);
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(page.getByRole("button", { name: "Ver horario siguiente" })).toBeDisabled();
  const position = await scroll.evaluate(element => element.scrollLeft);
  await page.getByRole("button", { name: /La 1, Aquí la Tierra,/ }).click();
  expect(await scroll.evaluate(element => element.scrollLeft)).toBe(position);
});

test("la maqueta funciona con teclado y no desborda una ventana estrecha", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChannels(page);
  const navigation = page.getByRole("button", { name: "Canales", exact: true });
  await expect(navigation).toBeVisible();
  expect(await navigation.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  })).toBe(true);
  const programme = page.getByRole("button", { name: /La 2, Planeta azul,/ });
  await programme.focus();
  await page.keyboard.press("Enter");
  await expect(programme).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Planeta azul", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("las categorías y la búsqueda se pueden combinar y borrar", async ({ page }) => {
  await openChannels(page);
  for (const [name, count] of [["Documentales", 1], ["Deportes", 1], ["Generalistas", 4], ["Todos", 7]] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("[data-channel-row]")).toHaveCount(count);
  }
  await page.getByRole("searchbox", { name: "Buscar canal" }).fill("SEXTA");
  await expect(page.locator("[data-channel-row]")).toHaveCount(1);
  await page.getByRole("button", { name: "Borrar búsqueda" }).click();
  await expect(page.locator("[data-channel-row]")).toHaveCount(7);
});

if (process.env.CHANNELS_CAPTURE === "1") {
  test("capturas de revisión agrupadas: escritorio y ventana estrecha", async ({ page }) => {
    mkdirSync(".impeccable/review/channels", { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openChannels(page);
    await expect(page.getByRole("heading", { name: "Planeta azul", exact: true })).toBeVisible();
    await page.locator(".channels-preview img").evaluate((image: HTMLImageElement) => image.decode());
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: ".impeccable/review/channels/desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: ".impeccable/review/channels/mobile.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator("[data-aetherio-scroll-shell]").evaluate(element => {
      const heading = element.querySelector(".channels-guide__heading");
      if (heading) element.scrollTop += heading.getBoundingClientRect().top - 150;
    });
    await expect.poll(() => page.locator("[data-aetherio-scroll-shell]").evaluate(element => element.scrollTop)).toBeGreaterThan(300);
    await page.screenshot({ path: ".impeccable/review/channels/mobile-guide.png", fullPage: true });
  });
}
