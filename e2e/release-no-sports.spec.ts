import { expect, test } from "@playwright/test";
import { installExperienceFixture, revealForCapture } from "./fixtures/experience";

test("release has no Sports navigation, settings, route or provider requests", async ({ page }) => {
  test.setTimeout(120_000);
  const sportsRequests: string[] = [];
  page.on("request", request => {
    if (/127\.0\.0\.1:731[01]|sports\.highfly|nuviosports/.test(request.url())) sportsRequests.push(request.url());
  });
  await installExperienceFixture(page);
  await page.goto("/big-picture/sports", { waitUntil: "domcontentloaded" });
  await revealForCapture(page);
  await expect(page).toHaveURL(/\/big-picture$/);
  await expect(page.locator("[data-aetherio-big-picture]")).toBeVisible();
  await expect(page.locator("[data-bp-sports]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sports", exact: true })).toHaveCount(0);

  await page.goto("/big-picture/settings?tab=sources", { waitUntil: "domcontentloaded" });
  await revealForCapture(page);
  await expect(page.getByRole("heading", { name: "Fuentes", exact: true })).toBeVisible();
  await expect(page.getByText("Instancia deportiva", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sports", { exact: true })).toHaveCount(0);
  expect(sportsRequests).toEqual([]);
});

test("release hides IPTV Channels navigation and redirects direct links", async ({ page }) => {
  await installExperienceFixture(page);

  await page.goto("/channels", { waitUntil: "domcontentloaded" });
  await revealForCapture(page);
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("button", { name: "Canales", exact: true })).toHaveCount(0);
  await expect(page.getByText("Guía de canales", { exact: true })).toHaveCount(0);

  await page.goto("/big-picture/channels", { waitUntil: "domcontentloaded" });
  await revealForCapture(page);
  await expect(page).toHaveURL(/\/big-picture$/);
  await expect(page.getByRole("button", { name: "Canales", exact: true })).toHaveCount(0);
  await expect(page.getByText("Guía de canales", { exact: true })).toHaveCount(0);
});
