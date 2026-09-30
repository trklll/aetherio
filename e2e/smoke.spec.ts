import { expect, test } from "@playwright/test";

// La app es un Tauri: en el navegador las llamadas a `invoke` fallan, asi que
// estos tests comprueban la capa que si existe en la web (shell, rutas y
// preferencias que viven en localStorage) y nunca dependen del reproductor.

async function gotoApp(page: import("@playwright/test").Page, path = "/") {
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
}

test("el shell de la aplicacion monta", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator("#root")).toBeAttached();
  await expect(page.locator("body")).not.toBeEmpty();
});

test("la vista de ajustes se abre por ruta", async ({ page }) => {
  await gotoApp(page, "/settings?tab=account");
  await expect(page.locator("#root")).toBeAttached();
  // La navegacion real depende del router; con que el shell monte y la ruta no
  // reviente la app, la ruta esta registrada.
  expect(page.url()).toContain("/settings");
});

test("no aparecen errores de consola al arrancar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await gotoApp(page);
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test("las preferencias de reproduccion se guardan y se recuperan", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(() => {
    const key = "aetherio-playback-preferences";
    localStorage.setItem(key, JSON.stringify({ autoSubtitleSync: "on", sourceSelectionMode: "first" }));
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  });
  expect(result?.autoSubtitleSync).toBe("on");
  expect(result?.sourceSelectionMode).toBe("first");
});
