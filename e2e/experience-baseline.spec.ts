import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { experienceFixture, installExperienceFixture, revealForCapture } from "./fixtures/experience";

const CAPTURE_DIR = path.resolve(process.cwd(), "docs/experience/baseline-captures");

test.use({ locale: "es-ES", timezoneId: "UTC" });

async function capture(
  page: Page,
  name: string,
  route: string,
  viewport: { width: number; height: number },
  expectedText: string,
) {
  await page.setViewportSize(viewport);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await revealForCapture(page);
  await expect(page.locator("body")).toContainText(expectedText);
  const visibleCopy = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 180);
  console.log(`[baseline:${name}] ${visibleCopy || "<sin texto visible>"}`);
  await page.screenshot({
    path: path.join(CAPTURE_DIR, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

test("captura baseline de Home, Detail, Ajustes y Party en escritorio y Big Picture", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(CAPTURE_DIR, { recursive: true });
  await installExperienceFixture(page);

  expect(experienceFixture.profiles).toHaveLength(2);
  expect(experienceFixture.media.anime).toHaveLength(3);
  expect(new Set(experienceFixture.media.anime.map(item => item.id)).size).toBe(3);
  expect(experienceFixture.media.anime.some(item => item.format === "OVA")).toBe(true);
  expect(new Set(experienceFixture.sources.map(source => source.state))).toEqual(new Set(["success", "empty", "error"]));
  expect(experienceFixture.audioTracks.map(track => track.language)).toEqual(["spa", "eng", null]);
  expect(experienceFixture.watchedHistory.some(entry => entry.season === 0 && entry.episode === 0 && entry.completed)).toBe(true);
  expect(experienceFixture.continueWatching.some(entry => entry.episode === 4 && entry.entryKind === "new")).toBe(true);
  expect(experienceFixture.party.members).toHaveLength(2);

  const desktop = { width: 1600, height: 900 };
  const bigPicture = { width: 1920, height: 1080 };

  await capture(page, "desktop-home", "/home", desktop, "La última estación");
  await expect(page.locator(".home-page-scale")).toBeVisible();
  const profileCount = await page.evaluate(() => {
    const raw = localStorage.getItem("aetherio-local-profiles-v1") ?? "[]";
    return JSON.parse(raw).length;
  });
  expect(profileCount).toBe(2);
  const quotaErrorName = await page.evaluate(key => {
    try {
      localStorage.setItem(key, "test");
      return null;
    } catch (error) {
      return error instanceof DOMException ? error.name : "unknown";
    }
  }, experienceFixture.storageFailure.key);
  expect(quotaErrorName).toBe("QuotaExceededError");

  await capture(page, "desktop-detail", "/detail/movie/990001", desktop, "La última estación");
  await expect(page).toHaveURL(/\/detail\/movie\/990001/);

  await capture(page, "desktop-settings", "/settings", desktop, "Cuenta");
  await expect(page).toHaveURL(/\/settings/);

  await page.goto("/home", { waitUntil: "domcontentloaded" });
  await revealForCapture(page);
  await page.getByRole("button", { name: "Party: ver juntos" }).click();
  await page.clock.runFor(500);
  await expect(page.getByRole("dialog", { name: "Ver juntos (Party)" })).toBeVisible();
  await page.screenshot({ path: path.join(CAPTURE_DIR, "desktop-party.png"), fullPage: false, animations: "disabled" });

  await capture(page, "big-picture-home", "/big-picture", bigPicture, "Horizonte quieto");
  await expect(page.locator("[data-aetherio-big-picture]")).toBeVisible();

  await capture(page, "big-picture-detail", "/big-picture/detail/movie/990001", bigPicture, "La última estación");
  await expect(page).toHaveURL(/\/big-picture\/detail\/movie\/990001/);

  await capture(page, "big-picture-settings", "/big-picture/settings", bigPicture, "Ajustes");
  await expect(page).toHaveURL(/\/big-picture\/settings/);

  await capture(page, "big-picture-party", "/big-picture/party", bigPicture, "Party");
  await expect(page).toHaveURL(/\/big-picture\/party/);
});
