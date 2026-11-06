// Real running Tauri WebView2 only: no browser launch, IPC mocks or sports fixtures.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.connectOverCDP(process.argv[2] ?? "http://127.0.0.1:9232");
const page = browser.contexts().flatMap(context => context.pages()).find(page => !page.url().includes("window=splash"));
if (!page || !await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__) && window.__TAURI_INTERNALS__.metadata?.currentWindow?.label === "main")) {
  throw new Error("Expected the actual main Tauri WebView, not a browser preview");
}
const original = page.url();
const originalSection = await page.locator('.team-page__nav [aria-current="page"]').textContent().catch(() => null);
const out = ".impeccable/review/sports-team-page";
await mkdir(out, { recursive: true });
const report = { native: true, endpoint: process.argv[2] ?? "http://127.0.0.1:9232", checkedAt: new Date().toISOString(), teams: [] };
let failed = false;
try {
  for (const [id, name] of [["club:man-city", "Manchester City"], ["club:man-utd", "Manchester United"], ["club:fl-alianza-lima", "Alianza Lima"], ["club:fl-atletico-grau", "Atlético Grau"]]) {
    await page.goto(new URL(`/big-picture/sports/team/${encodeURIComponent(id)}`, original).href);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.locator(".team-page__own").first()).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Alineación", exact: true }).click();
    await expect(page.locator(".team-page__players li")).toHaveCount(11);
    await page.getByRole("button", { name: "Plantilla", exact: true }).click();
    const rosterRows = await page.getByRole("row").count();
    expect(rosterRows).toBeGreaterThan(20);
    await expect.poll(() => page.locator(".team-page__photo img").first().evaluate(image => image.naturalWidth), { timeout: 15000 }).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Partidos", exact: true }).click();
    expect(await page.locator(".team-page__fixtures li").count()).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Títulos", exact: true }).click();
    await expect(page.getByRole("table")).toBeVisible();
    if (id !== "club:man-utd") await expect(page.getByText(/Registro parcial de FotMob/)).toBeVisible();
    await page.screenshot({ path: `${out}/tauri-${id.replaceAll(":", "-")}.png` });
    report.teams.push({ id, name, ok: true, starters: 11, rosterRows });
  }
} catch (error) {
  failed = true;
  report.error = String(error);
  await page.screenshot({ path: `${out}/tauri-failure.png` }).catch(() => {});
} finally {
  await writeFile(`${out}/tauri-verification.json`, JSON.stringify(report, null, 2));
  await page.goto(original);
  if (originalSection) await page.getByRole("button", { name: originalSection, exact: true }).click();
  console.log(JSON.stringify(report, null, 2));
  // Disconnect without closing the user's native application.
  process.exit(failed ? 1 : 0);
}
