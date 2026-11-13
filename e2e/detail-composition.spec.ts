import { expect, test, type Page } from "@playwright/test";
import { experienceFixture, installExperienceFixture } from "./fixtures/experience";

async function openDetail(
  page: Page,
  bigPicture: boolean,
  mediaType: "series" | "movie" = "series",
  options: {
    seasonNumbers?: number[];
    seriesId?: number;
    seriesName?: string;
    episodeCounts?: Record<number, number>;
  } = {},
) {
  const {
    seasonNumbers = [1],
    seriesId = 990002,
    seriesName = experienceFixture.tmdb.seriesDetail.name as string,
    episodeCounts = {},
  } = options;
  const episodeCountForSeason = (season: number) => episodeCounts[season] ?? 100;
  const expectedEpisodeCount = seasonNumbers.reduce(
    (total, season) => total + episodeCountForSeason(season),
    0,
  );
  await installExperienceFixture(page);
  await page.route("**/api/tmdb/**", route => {
    const path = new URL(route.request().url()).pathname;
    const series = {
      ...experienceFixture.tmdb.seriesDetail,
      id: seriesId,
      name: seriesName,
      original_name: seriesName,
      number_of_seasons: seasonNumbers.length,
      number_of_episodes: expectedEpisodeCount,
      seasons: seasonNumbers.map(season => ({
        id: 90 + season,
        season_number: season,
        name: `Temporada ${season}`,
        episode_count: episodeCountForSeason(season),
        air_date: "2023-01-01",
      })),
      credits: { cast: [{ id: 12, name: "Intérprete de prueba", character: "Protagonista", profile_path: "/actor.svg" }], crew: [] },
      networks: [{ id: 13, name: "Cadena de prueba", logo_path: "/network.svg" }],
      production_companies: [{ id: 14, name: "Estudio de prueba", logo_path: "/studio.svg" }],
      videos: { results: [{ id: "trailer-1", key: "trailer-test", name: "Tráiler de prueba", site: "YouTube", type: "Trailer", official: true }] },
    };
    const movie = {
      ...experienceFixture.tmdb.movieDetail,
      credits: series.credits,
      production_companies: series.production_companies,
    };
    const seasonMatch = path.match(new RegExp(`/tv/${seriesId}/season/(\\d+)$`));
    const season = seasonMatch ? Number(seasonMatch[1]) : 1;
    const isFixtureSeries = new RegExp(`/tv/${seriesId}(?:/|$)`).test(path);
    const body = seasonMatch
      ? { id: 90 + season, season_number: season, episodes: Array.from({ length: episodeCountForSeason(season) }, (_, index) => ({
          id: season * 10_000 + index, season_number: season, episode_number: index + 1,
          name: `Episodio ${index + 1}`, overview: "Sinopsis de prueba.",
          air_date: "2023-01-01", runtime: 24, still_path: `/still-${season}-${index}.svg`,
        })) }
      : isFixtureSeries ? series
      : /\/movie\/990001(?:\/|$)/.test(path) ? movie
      : { results: [], total_pages: 1 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  const mediaId = mediaType === "series" ? seriesId : 990001;
  await page.goto(
    `${bigPicture ? "/big-picture" : ""}/detail/${mediaType}/tmdb%3A${mediaId}`,
    { waitUntil: "domcontentloaded" },
  );
  const root = page.locator(".detail-page-root:visible");
  await expect(root.locator(".detail-page-content")).toBeVisible();
  if (mediaType === "series") {
    await expect(root.locator('[data-row-key$=":episodes"]')).toHaveAttribute(
      "data-row-count",
      String(expectedEpisodeCount),
    );
    await expect(root.locator(".detail-episode-card").first()).toBeVisible();
  }
  await expect.poll(() => root.locator(".detail-page-content > :not(.detail-content-logo)").evaluateAll(elements =>
    elements.every(el => (el as HTMLElement).style.transform === ""),
  )).toBe(true);
  return root;
}

for (const bigPicture of [false, true]) {
test(`${bigPicture ? "TV" : "PC"}: episode cards show episode number without repeating the season and tabs follow the visible season`, async ({ page }) => {
  const root = await openDetail(page, bigPicture, "series", { seasonNumbers: [1, 2] });
  const row = root.locator('[data-row-key$=":episodes"]');
  const seasonOne = root.getByRole("tab", { name: "Temporada 1", exact: true });
  const seasonTwo = root.getByRole("tab", { name: "Temporada 2", exact: true });

  await expect(seasonOne).toHaveAttribute("aria-selected", "true");
  await expect(root.locator(".detail-episode-card__eyebrow").first()).toHaveText("Episodio 1");
  await expect.poll(() => root.locator(".detail-episode-card__eyebrow").evaluateAll(labels =>
    labels.every(label => /^Episodio \d+$/.test(label.textContent?.trim() ?? "")),
  )).toBe(true);

  await row.evaluate(element => {
    const scroller = element as HTMLElement;
    scroller.scrollLeft = 100 * (347 + 22);
    scroller.dispatchEvent(new Event("scroll"));
  });

  await expect(seasonTwo).toHaveAttribute("aria-selected", "true");
  await expect(seasonOne).toHaveAttribute("aria-selected", "false");
  await expect(root.locator('.detail-episode-card[data-scroll-key="2:1"]')).toBeVisible();
});
}

const onePieceSeasonNumbers = Array.from({ length: 22 }, (_, index) => index + 1);
const onePieceEpisodeCounts: Record<number, number> = Object.fromEntries(
  onePieceSeasonNumbers.map(season => [
    season,
    season === 1 ? 61 : season === 2 ? 16 : 53,
  ]),
);

test("PC: ONE PIECE anime season tabs navigate the long episode row", async ({ page }) => {
  test.setTimeout(90_000);
  const root = await openDetail(page, false, "series", {
    seasonNumbers: onePieceSeasonNumbers,
    seriesId: 37854,
    seriesName: "ONE PIECE",
    episodeCounts: onePieceEpisodeCounts,
  });
  const row = root.locator('[data-row-key$=":episodes"]');
  const seasonTwo = root.getByRole("tab", { name: "Temporada 2", exact: true });

  await expect(root.getByRole("heading", { name: "ONE PIECE" }).first()).toBeVisible();
  await seasonTwo.click();
  await expect(seasonTwo).toHaveAttribute("aria-selected", "true");
  await expect(root.locator('.detail-episode-card[data-scroll-key="2:1"]')).toBeVisible();
  await expect(row).toHaveAttribute("data-row-count", "1137");
});

test("TV: ONE PIECE anime remote navigation moves across episodes and seasons", async ({ page }) => {
  test.setTimeout(90_000);
  const root = await openDetail(page, true, "series", {
    seasonNumbers: onePieceSeasonNumbers,
    seriesId: 37854,
    seriesName: "ONE PIECE",
    episodeCounts: onePieceEpisodeCounts,
  });
  const seasonOne = root.getByRole("tab", { name: "Temporada 1", exact: true });
  const seasonTwo = root.getByRole("tab", { name: "Temporada 2", exact: true });
  const firstEpisode = root.locator('.detail-episode-card[data-scroll-key="1:1"]');

  await expect(seasonOne).toHaveAttribute("aria-selected", "true");
  await firstEpisode.focus();
  await page.keyboard.press("ArrowRight");
  await expect(root.locator('.detail-episode-card[data-scroll-key="1:2"]')).toBeFocused();

  await page.keyboard.press("PageDown");
  const firstEpisodeOfSeasonTwo = root.locator('.detail-episode-card[data-scroll-key="2:1"]');
  await expect(seasonTwo).toHaveAttribute("aria-selected", "true");
  await expect(firstEpisodeOfSeasonTwo).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(root.locator('.detail-episode-card[data-scroll-key="2:2"]')).toBeFocused();
});

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

test("TV: arrow focus applies the same card scale from episodes through production", async ({ page }) => {
  const root = await openDetail(page, true);
  await page.clock.resume();
  const episode = root.locator(".detail-episode-card").first();
  const trailer = root.locator('[data-row-key$=":trailers"] .media-card-frame').first();
  const cast = root.locator('[data-row-key$=":cast"] button').first();
  const network = root.locator('[data-row-key$=":companies"] button').first();
  const production = root.locator('[data-row-key$=":companies"] button').nth(1);
  const focusedTransforms: Array<{ scale: number; lift: number }> = [];
  const recordFocusedScale = async (card: typeof episode) => {
    await page.waitForTimeout(240);
    focusedTransforms.push(await card.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { scale: matrix.a, lift: matrix.f };
    }));
  };

  await episode.focus();
  await expect(episode).toBeFocused();
  await recordFocusedScale(episode);
  await page.keyboard.press("ArrowDown");
  await expect(trailer).toBeFocused();
  await recordFocusedScale(trailer);
  await page.keyboard.press("ArrowDown");
  await expect(cast).toBeFocused();
  await recordFocusedScale(cast);
  await page.keyboard.press("ArrowDown");
  await expect(network).toBeFocused();
  await recordFocusedScale(network);
  await page.keyboard.press("ArrowRight");
  await expect(production).toBeFocused();
  await recordFocusedScale(production);
  for (const [index, transform] of focusedTransforms.entries()) {
    expect(transform.scale, `TV card ${index} should start expanding on focus`).toBeGreaterThan(1.005);
    expect(transform.lift, `TV card ${index} should lift on focus`).toBeLessThan(0);
  }
});

test("PC: hover uses the same quick card expansion from episodes through production", async ({ page }) => {
  const root = await openDetail(page, false);
  await page.clock.resume();
  await page.waitForTimeout(650);
  const cards = [
    root.locator(".detail-episode-card").first(),
    root.locator('[data-row-key$=":trailers"] .media-card-frame').first(),
    root.locator('[data-row-key$=":cast"] button').first(),
    root.locator('[data-row-key$=":companies"] button').first(),
    root.locator('[data-row-key$=":companies"] button').nth(1),
  ];
  for (const [index, card] of cards.entries()) {
    await card.hover();
    await page.waitForTimeout(240);
    const transform = await card.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { scale: matrix.a, lift: matrix.f };
    });
    expect(transform.scale, `content card ${index} should expand on hover`).toBeGreaterThan(1.03);
    expect(transform.lift, `content card ${index} should lift on hover`).toBeLessThan(0);
  }
});
