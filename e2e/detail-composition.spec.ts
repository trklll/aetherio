import { expect, test, type Page } from "@playwright/test";
import { experienceFixture, installExperienceFixture } from "./fixtures/experience";

async function openDetail(page: Page, bigPicture: boolean, mediaType: "series" | "movie" = "series") {
  await installExperienceFixture(page);
  await page.route("**/api/tmdb/**", route => {
    const path = new URL(route.request().url()).pathname;
    const series = {
      ...experienceFixture.tmdb.seriesDetail,
      seasons: [{ id: 91, season_number: 1, name: "Temporada 1", episode_count: 100, air_date: "2023-01-01" }],
      credits: { cast: [{ id: 12, name: "Intérprete de prueba", character: "Protagonista", profile_path: "/actor.svg" }], crew: [] },
      networks: [{ id: 13, name: "Cadena de prueba", logo_path: "/network.svg" }],
      production_companies: [{ id: 14, name: "Estudio de prueba", logo_path: "/studio.svg" }],
    };
    const movie = {
      ...experienceFixture.tmdb.movieDetail,
      credits: series.credits,
      production_companies: series.production_companies,
    };
    const body = /\/tv\/990002\/season\/1$/.test(path)
      ? { id: 91, season_number: 1, episodes: Array.from({ length: 100 }, (_, index) => ({
          id: 9000 + index, season_number: 1, episode_number: index + 1,
          name: `Episodio ${index + 1}`, overview: "Sinopsis de prueba.",
          air_date: "2023-01-01", runtime: 24, still_path: `/still-${index}.svg`,
        })) }
      : /\/tv\/990002(?:\/|$)/.test(path) ? series
      : /\/movie\/990001(?:\/|$)/.test(path) ? movie
      : { results: [], total_pages: 1 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`${bigPicture ? "/big-picture" : ""}/detail/${mediaType}/tmdb%3A${mediaType === "series" ? "990002" : "990001"}`);
  const root = page.locator(".detail-page-root:visible");
  await expect(root.locator(".detail-page-content")).toBeVisible();
  if (mediaType === "series") await expect(root.locator(".detail-episode-card")).toHaveCount(100);
  await expect.poll(() => root.locator(".detail-page-content > :not(.detail-content-logo)").evaluateAll(elements =>
    elements.every(el => (el as HTMLElement).style.transform === ""),
  )).toBe(true);
  return root;
}

for (const bigPicture of [false, true]) {
  for (const mediaType of ["series", "movie"] as const) {
    test(`${bigPicture ? "TV" : "normal"} ${mediaType}: bounds detail composition by section without promoting cards`, async ({ page }) => {
      const root = await openDetail(page, bigPicture, mediaType);
      const sections = root.locator(".detail-page-content > :not(.detail-content-logo)");
      const styles = await sections.evaluateAll(elements => elements.map(el => ({
        transform: getComputedStyle(el).transform,
        identity: new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity,
        overflow: getComputedStyle(el).overflow,
      })));
      expect(styles.length).toBeGreaterThan(1);
      expect(styles.every(style => style.transform !== "none" && style.identity)).toBe(true);
      expect(styles.every(style => style.overflow === "visible")).toBe(true);
      expect(await root.locator(".detail-episode-card").evaluateAll(cards => cards.filter(el =>
        getComputedStyle(el).transform.startsWith("matrix3d") || getComputedStyle(el).willChange.includes("transform"),
      ).length)).toBe(0);
      const glass = root.locator(".liquid-glass-dark").first();
      await expect(glass).toHaveCSS("backdrop-filter", /frosted-xl/);
    });
  }
}

for (const bigPicture of [false, true]) {
test(`${bigPicture ? "TV" : "normal"}: composed sections preserve episode hover, menu and viewport placement after scrolling`, async ({ page }) => {
  const root = await openDetail(page, bigPicture);
  const first = root.locator(".detail-episode-card").first();
  await first.scrollIntoViewIfNeeded();
  const menu = page.locator('[data-aetherio-context-menu][data-context-open="true"]');
  if (bigPicture) {
    // TV has no ellipsis button: holding A/Enter opens the same menu.
    await first.focus();
    await page.keyboard.down("Enter");
    try {
      await expect(menu).toBeVisible();
    } finally {
      await page.keyboard.up("Enter");
    }
  } else {
    await first.hover();
    const trigger = first.locator(".detail-episode-card__menu");
    await expect(trigger).toBeVisible();
    await trigger.click();
  }
  await expect(menu).toBeVisible();
  const bounds = await menu.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await first.focus();
  await expect(first).toBeFocused();
  if (bigPicture) {
    await page.keyboard.press("ArrowRight");
    const next = root.locator(".detail-episode-card").nth(1);
    await expect(next).toBeFocused();
    await expect(next).toBeInViewport();
  }
});
}
