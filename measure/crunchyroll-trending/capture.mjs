import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("./", import.meta.url));
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
await context.addInitScript(() => {
  const profileId = "crunchyroll-visual-check";
  let id = 1;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => id++,
    invoke: async command => command.startsWith("plugin:event|") ? id++ : null,
    convertFileSrc: value => value,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {},
  };
  window.__TAURI__ = { event: { listen: async () => () => undefined } };
  localStorage.setItem("aetherio-local-mode-v1", "1");
  localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: profileId, name: "Vista previa", createdAt: 1, updatedAt: 1 }]));
  localStorage.setItem("aetherio-active-profile-id", profileId);
  localStorage.setItem(`aetherio-profile:${profileId}:aetherio-home-preferences`, JSON.stringify({ playStreamingPlatformIntros: false }));
});
const page = await context.newPage();
const errors = [];
const failedRequests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("requestfailed", request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
// Only the existing TMDB catalog is stubbed. Trending data and covers are LIVE.
await page.route("**/api/tmdb/**", route => route.fulfill({
  status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total_pages: 1 }),
}));
const metrics = [];
try {
  for (const [name, width, height, route] of [
    ["desktop", 1920, 1080, "/platform/crunchyroll"],
    ["small", 390, 844, "/platform/crunchyroll"],
    ["big-picture", 1920, 1080, "/big-picture/platform/crunchyroll"],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:1420${route}`, { waitUntil: "domcontentloaded" });
    const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
    await section.locator("[data-row-card]").first().waitFor({ state: "visible", timeout: 30000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.querySelectorAll(".crunchyroll-trending__cover img")).slice(0, 7).map(image => image.decode().catch(() => undefined)));
    });
    await page.screenshot({ path: `${directory}${name}.png` });
    if (name === "desktop") await section.screenshot({ path: `${directory}section.png` });
    metrics.push(await section.evaluate((el, name) => {
      const cover = el.querySelector(".crunchyroll-trending__cover").getBoundingClientRect();
      const second = el.querySelectorAll(".crunchyroll-trending__cover")[1].getBoundingClientRect();
      const hero = document.querySelector(".streaming-platform-hero").getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return { name, sectionTop: rect.top, sectionWidth: rect.width, headerBottom: hero.bottom, coverWidth: cover.width, coverHeight: cover.height, gap: second.left - cover.right, cards: el.querySelectorAll("[data-row-card]").length, documentWidth: document.documentElement.scrollWidth };
    }, name));
  }
  await writeFile(`${directory}verification.json`, JSON.stringify({ metrics, errors: [...new Set(errors)], failedRequests }, null, 2));
  console.log(JSON.stringify({ metrics, errors: [...new Set(errors)], failedRequests }, null, 2));
} finally {
  await browser.close();
}
