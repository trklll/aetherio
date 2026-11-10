import { expect, test } from "@playwright/test";

test("lazy artwork defers Spatial probes too, preserves full quality and handles errors", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => { requests.push(new URL(request.url()).pathname); });
  await page.route("https://**/*", route => route.fulfill({ contentType: "application/json", body: '{"results":[],"data":[]}' }));
  await page.route("**/__poster-probe/**", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><rect width="1000" height="1500" fill="#214362"/></svg>',
  }));
  await page.route("**/manifest.json", route => route.fulfill({ contentType: "application/json", body: "{}" }));
  await page.route("**/api/poster/**", route => route.request().url().includes("/movie/102")
    ? route.fulfill({ status: 404, body: "missing" })
    : route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><rect width="1000" height="1500" fill="#456987"/></svg>',
    }));
  await page.addInitScript(() => localStorage.setItem("aetherio-local-mode-v1", "1"));
  await page.goto("/home");
  await expect(page.locator(".home-page-scale")).toBeVisible();
  await page.evaluate(async () => {
    const path = "/e2e/fixtures/PosterLoadingProbe.tsx";
    const { mountPosterLoadingProbe } = await import(/* @vite-ignore */ path);
    mountPosterLoadingProbe();
  });
  const image = page.getByAltText("Spatial 101", { exact: true });
  await expect(image).toHaveAttribute("src", /\/api\/poster\/movie\/101\?/);
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1000);
  expect(requests.some(url => url.includes("/movie/102"))).toBe(false);
  expect(requests).not.toContain("/__poster-probe/base-102.svg");
  expect(requests).not.toContain("/__poster-probe/lazy.svg");
  expect(requests).not.toContain("/api/poster/movie/103");

  await page.getByAltText("Lazy", { exact: true }).scrollIntoViewIfNeeded();
  const fallback = page.getByAltText("Spatial 102", { exact: true });
  await expect(fallback).toHaveAttribute("src", "/__poster-probe/base-102.svg");
  await expect.poll(() => fallback.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1000);
  const lazySpatial = page.getByAltText("Lazy Spatial", { exact: true });
  await expect.poll(() => lazySpatial.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1000);
  await expect.poll(() => page.getByAltText("Lazy", { exact: true }).evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1000);
  expect(requests.filter(url => url.includes("/movie/102"))).toHaveLength(1);

  await page.getByAltText("Direct", { exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1000);
  expect(requests.filter(url => url.includes("/movie/101"))).toHaveLength(1);
});
