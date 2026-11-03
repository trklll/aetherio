import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const token = "local-e2e-only-not-a-production-secret";

test.beforeEach(async ({ page, request }) => {
  await request.put("/admin/providers/e2e-script", {
    headers: { "x-admin-token": token },
    data: { name: "E2E Script", supportedTypes: ["movie", "tv"], script: "module.exports = { getStreams: async () => [] };" },
  });
  await request.put("/admin/providers/animeav1", {
    headers: { "x-admin-token": token },
    data: { name: "AnimeAV1", description: "Scraper independiente de animeav1.com", logo: "https://hub.example/addons/logos/animeav1.svg", supportedTypes: ["movie", "tv"], enabled: true },
  });
  await page.goto("/admin");
  await page.getByLabel("Token de administración", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Entrar al panel" }).click();
  await expect(page.locator("#app-shell")).toBeVisible();
});

test("all Stremio addons are visible on entry, searchable and filterable", async ({ page }) => {
  const rows = page.locator("#provider-list .provider-row");
  for (const name of ["AnimES", "Torrentio", "PenguPlay", "DeepFlix", "Cinemeta", "Sports Streams · Highfly"]) {
    await expect(rows.locator(".provider-name").filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
  }
  await expect(rows.filter({ hasText: "AnimeAV1" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "AnimeAV1" })).toContainText("Activa");
  await page.getByLabel("Filtrar tipo de fuente").selectOption("stremio");
  await expect(rows).toHaveCount(7);
  await expect(rows.filter({ hasText: "E2E Script" })).toHaveCount(0);
  await page.locator("#search-input").fill("animeav1");
  await expect(rows).toHaveCount(0);
  await page.locator("#search-input").fill("");
  await page.getByLabel("Filtrar tipo de fuente").selectOption("script");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "E2E Script" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "AnimeAV1" })).toHaveCount(1);
  expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage)])).toEqual([[], []]);
});

test("edits an addon without exposing the script editor or losing integration settings", async ({ page, request }) => {
  await page.getByRole("button", { name: "Editar PenguPlay", exact: true }).click();
  await expect(page.locator("#addon-fields")).toBeVisible();
  await expect(page.locator("#source-editor")).toBeHidden();
  await expect(page.locator("#test-section")).toBeHidden();
  await expect(page.locator("#addon-manifest-url")).toHaveValue("/api/penguplay/manifest.json");
  await expect(page.locator("#addon-hidden")).toBeChecked();
  await page.locator("#provider-description").fill("Agregador administrado desde el Hub.");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.locator("#editor-panel")).toBeHidden();
  const publicDirectory = await (await request.get("/addons.json")).json();
  const addon = publicDirectory.addons.find((entry: { id: string }) => entry.id === "com.penguplay");
  expect(addon).toMatchObject({ description: "Agregador administrado desde el Hub.", hiddenInUi: true, manifestUrl: "/api/penguplay/manifest.json", streamAttempts: 2 });
  await expect(page.locator("#toast")).toContainText("Add-on guardado");
});

test("edits the independent AnimeAV1 scraper as a script, not as an AnimES Stremio manifest", async ({ page, request }) => {
  await page.getByRole("button", { name: "Editar AnimeAV1", exact: true }).click();
  await expect(page.locator("#addon-fields")).toBeHidden();
  await expect(page.locator("#source-editor")).toBeVisible();
  await expect(page.locator("#test-section")).toBeVisible();
  await expect(page.locator("#provider-script")).toHaveValue(/animeav1\.com/);
  await expect(page.locator("#provider-script")).not.toHaveValue(/pigamer37|alwaysdata/);
  await expect(page.locator("#provider-id")).toHaveValue("animeav1");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.locator("#editor-panel")).toBeHidden();
  const directory = await (await request.get("/addons.json")).json();
  expect(directory.addons.some((addon: { id: string }) => addon.id === "aetherio.source.animeav1")).toBe(false);
  const scripts = await (await request.get("/admin/providers", { headers: { "x-admin-token": token } })).json();
  expect(scripts.find((provider: { id: string }) => provider.id === "animeav1")).toMatchObject({ name: "AnimeAV1", enabled: true });
});

test("creates a Stremio addon from a checked manifest and deletes it", async ({ page, request }) => {
  const manifest = { id: "org.e2e.demo", name: "E2E add-on", version: "1.0.0", types: ["movie"], resources: ["stream"], catalogs: [] };
  await page.route("**/admin/validate-addon", route => route.fulfill({ json: { ok: true, manifest } }));
  await page.getByRole("button", { name: "Nuevo add-on", exact: true }).click();
  await page.locator("#addon-manifest-url").fill("https://addon.example.org/manifest.json");
  await page.getByRole("button", { name: "Comprobar manifest", exact: true }).click();
  await expect(page.locator("#provider-id")).toHaveValue(manifest.id);
  await expect(page.locator("#provider-name")).toHaveValue(manifest.name);
  await page.getByRole("button", { name: "Guardar add-on", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editar E2E add-on", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Editar E2E add-on", exact: true }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Editar E2E add-on", exact: true })).toHaveCount(0);
  const directory = await (await request.get("/addons.json")).json();
  expect(directory.addons.some((entry: { id: string }) => entry.id === manifest.id)).toBe(false);
});

test("preserves script editing and signs out without persisting the token", async ({ page }) => {
  await page.getByRole("button", { name: "Editar E2E Script", exact: true }).click();
  await expect(page.locator("#provider-script")).toHaveValue(/getStreams/);
  await expect(page.locator("#addon-fields")).toBeHidden();
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page.locator("#login-screen")).toBeVisible();
  await expect(page.locator("#provider-list .provider-row")).toHaveCount(0);
  await expect(page.locator("#provider-script")).toHaveValue("");
});

test("keeps the unified directory and inspector usable on desktop and narrow screens", async ({ page }) => {
  const directory = fileURLToPath(new URL("../../.impeccable/review/stremio-addons", import.meta.url));
  mkdirSync(directory, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const cinemetaImage = page.locator(".provider-row").filter({ hasText: "Cinemeta" }).locator(".provider-avatar img");
  await expect(cinemetaImage).toBeVisible();
  await expect.poll(() => cinemetaImage.evaluate(image => (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: `${directory}/desktop-directory.png`, fullPage: true });
  await page.getByRole("button", { name: "Editar AnimES", exact: true }).click();
  const overflow: number[] = [];
  for (const [name, width, height] of [["desktop-inspector", 1420, 1000], ["mobile", 390, 844], ["narrow", 850, 1000]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator("#addon-fields")).toBeVisible();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) overflow.push(width);
    await page.evaluate(() => { document.querySelector("#editor-panel")!.scrollTop = 0; window.scrollTo(0, 0); });
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  }
  expect(overflow).toEqual([]);
});

test("keeps row edit actions inside the visible directory at narrow desktop widths", async ({ page }) => {
  await page.setViewportSize({ width: 850, height: 1000 });
  await page.getByRole("button", { name: "Editar AnimES", exact: true }).click();
  const clipped = await page.evaluate(() => {
    const directory = document.querySelector(".directory-column")!.getBoundingClientRect();
    return [...document.querySelectorAll(".row-edit")].some(button => button.getBoundingClientRect().right > directory.right);
  });
  expect(clipped).toBe(false);
});

test("directory logos finish loading instead of remaining hidden behind initials", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const image = page.locator(".provider-row").filter({ hasText: "Cinemeta" }).locator(".provider-avatar img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(image).toHaveCSS("opacity", "1");
});

test("blank stream overrides restore automatic settings", async ({ page, request }) => {
  await page.getByRole("button", { name: "Editar PenguPlay", exact: true }).click();
  await page.locator("#addon-timeout").fill("");
  await page.locator("#addon-attempts").fill("");
  await page.getByRole("button", { name: "Guardar cambios", exact: true }).click();
  await expect(page.locator("#editor-panel")).toBeHidden();
  const directory = await (await request.get("/addons.json")).json();
  const addon = directory.addons.find((entry: { id: string }) => entry.id === "com.penguplay");
  expect(addon.streamTimeoutMs).toBeUndefined();
  expect(addon.streamAttempts).toBeUndefined();
  await page.getByRole("button", { name: "Editar PenguPlay", exact: true }).click();
  await expect(page.locator("#addon-timeout")).toHaveValue("");
  await expect(page.locator("#addon-attempts")).toHaveValue("");
});
