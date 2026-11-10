import { expect, test, type Locator, type Page } from "@playwright/test";

const names = [
  "Tsuihou Sareta Cheat Fuyo Majutsushi wa Kimama na Second Life wo Ouka Suru",
  "ONE PIECE", "Kyouran Reijou Nia Liston", "Cyberpunk: Edgerunners 2", "Black Clover",
  "Shiotaiou no Satou-san ga Ore ni dake Amai", "Tempal: Item no Chikara",
];

const trending = Array.from({ length: 20 }, (_, index) => ({
  id: index + 1,
  idMal: index + 1,
  title: { romaji: `${names[index % names.length]}${index >= names.length ? ` ${index + 1}` : ""}`, english: null },
  coverImage: { large: "/assets/streaming-platforms/crunchyroll-card.png" },
  bannerImage: null,
  description: "Anime de prueba",
  averageScore: 80,
  genres: ["Action"],
  season: "FALL",
  seasonYear: index === 1 ? 1999 : 2026,
  startDate: { year: index === 1 ? 1999 : 2026 },
  status: index % 2 ? "FINISHED" : "RELEASING",
}));

async function prepare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    let nextId = 1;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => nextId++,
      invoke: async (command: string) => command.startsWith("plugin:event|") ? nextId++ : null,
      convertFileSrc: (value: string) => value,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    const profileId = "crunchyroll-trending-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([
      { id: profileId, name: "Test", createdAt: 1, updatedAt: 1 },
    ]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-home-preferences`, JSON.stringify({ playStreamingPlatformIntros: false }));
  });
  let nextResolvedTmdbId = 424242;
  await page.route("**/api/tmdb/**", route => {
    const url = new URL(route.request().url());
    const isSearch = url.pathname.includes("/search/");
    const query = url.searchParams.get("query");
    const title = isSearch && query ? query : "Anime de catálogo";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [{
        id: isSearch ? nextResolvedTmdbId++ : 424200,
        name: title,
        title,
        original_name: title,
        original_title: title,
        genre_ids: [16], original_language: "ja", vote_average: 8.2,
      }], total_pages: 1 }),
    });
  });
}

async function mockTrending(page: Page, media = trending) {
  await page.route("https://graphql.anilist.co/", route => {
    const { variables } = route.request().postDataJSON();
    const responseMedia = media === trending && variables?.genre === "Drama"
      ? [{ ...trending[0], id: 999, title: { romaji: "Drama de prueba", english: null } }]
      : media === trending && variables?.genre === "Horror" ? [] : media;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { Page: { media: responseMedia } } }) });
  });
}

async function mockDragonBallDetail(page: Page) {
  await page.unroute("**/api/tmdb/**");
  const searchIds = new Map<string, number>();
  let nextSearchId = 425000;
  await page.route("**/api/tmdb/**", route => {
    const path = new URL(route.request().url()).pathname;
    const query = new URL(route.request().url()).searchParams.get("query") ?? "Dragon Ball Daima: Beerus";
    if (path === "/api/tmdb/discover/tv") {
      const names = [
        "One Piece",
        "Jujutsu Kaisen",
        "Demon Slayer",
        "Frieren: Beyond Journey's End",
        "Dragon Ball Daima: Beerus",
        "Solo Leveling",
        "Chainsaw Man",
        "Spy x Family",
        "My Hero Academia",
        "Attack on Titan",
      ];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: names.map((name, index) => ({
            id: index === 4 ? 424242 : 425100 + index,
            name,
            first_air_date: "2024-01-01",
            poster_path: `/anime-${index + 1}.jpg`,
            backdrop_path: `/anime-backdrop-${index + 1}.jpg`,
            overview: "Anime de prueba para el regreso desde streams.",
            vote_average: 9.8 - index / 10,
            vote_count: 1000,
            genre_ids: [16],
            original_language: "ja",
          })),
          total_pages: 1,
        }),
      });
    }
    if (path === "/api/tmdb/discover/movie") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total_pages: 1 }) });
    }
    const seasonMatch = path.match(/\/tv\/(\d+)\/season\/(\d+)$/);
    if (seasonMatch) {
      const season = Number(seasonMatch[2]);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: Number(seasonMatch[1]),
          season_number: season,
          episodes: Array.from({ length: 4 }, (_, index) => ({
            id: 9000 + index,
            season_number: season,
            episode_number: index + 1,
            name: index === 3 ? "Beerus" : `Capítulo ${index + 1}`,
            overview: "Episodio de prueba",
            still_path: null,
            air_date: "2024-01-01",
          })),
        }),
      });
    }
    if (/\/search\/(movie|tv)$/.test(path)) {
      const id = query.toLowerCase().includes("dragon ball")
        ? 424242
        : searchIds.get(query) ?? nextSearchId++;
      searchIds.set(query, id);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [{ id, name: query, title: query, original_name: query, original_title: query, first_air_date: "2024-01-01" }],
          total_pages: 1,
        }),
      });
    }
    if (/\/movie\/\d+$/.test(path)) return route.fulfill({ status: 404, body: "{}" });
    if (/\/tv\/\d+\/images$/.test(path)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ logos: [] }) });
    }
    if (/\/tv\/\d+$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 424242,
          name: "Dragon Ball Daima: Beerus",
          original_name: "Dragon Ball Daima: Beerus",
          first_air_date: "2024-01-01",
          overview: "Una serie de prueba para reproducir el regreso desde streams.",
          poster_path: "/dragon-ball.jpg",
          backdrop_path: "/dragon-ball-backdrop.jpg",
          genres: [{ id: 16, name: "Animación" }],
          seasons: [{ id: 900, season_number: 1, name: "Temporada 1", episode_count: 4, air_date: "2024-01-01" }],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [], total_pages: 1 }) });
  });
}

async function expectCatalogCount(section: Locator, count: number) {
  await expect(section.locator("[data-row-count]")).toHaveAttribute("data-row-count", String(count));
  if (count > 0) await expect(section.locator(".media-card-frame").first()).toBeVisible();
}

test("Crunchyroll shows an unpaginated standard trending row first in the catalog", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/platform/crunchyroll");

  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  await expect(section).toBeVisible();
  await expect(section.locator(".crunchyroll-trending__header > *")).toHaveCount(1);
  const cards = section.locator(".media-card-frame");
  await expectCatalogCount(section, 20);
  await expect(section.getByRole("tab", { name: "Todos", exact: true })).toHaveAttribute("aria-selected", "true");
  const sectionBox = (await section.boundingBox())!;
  const heroBox = (await page.locator(".streaming-platform-hero").boundingBox())!;
  expect(sectionBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height);
  expect(await section.evaluate(el => el.parentElement?.classList.contains("streaming-platform-catalog") && el.parentElement.firstElementChild === el)).toBe(true);

  const card = cards.first();
  const frameSize = await card.evaluate(el => ({ width: getComputedStyle(el).width, height: getComputedStyle(el).height }));
  expect(frameSize.width).toBe("217px");
  expect(frameSize.height).toBe("326px");
  expect(await card.evaluate(el => getComputedStyle(el).borderRadius)).toBe("12px");
  await expect(section.locator("[data-rank-number]")).toHaveCount(0);
  await expect(section.locator(".scroll-row")).toBeVisible();
  await expect(section.locator(".row-arrow-shell")).toHaveCount(2);
  await expect(section.locator(".crunchyroll-trending__arrow, .crunchyroll-trending__genre-arrow")).toHaveCount(0);
  await expect(section.locator(".crunchyroll-trending__airing")).toHaveCount(0);
  await expect(cards.first().getByLabel("En emisión")).toHaveCount(0);

  const animatedTitle = card.locator("xpath=..").locator(":scope > div").nth(1);
  await card.hover();
  await expect.poll(() => animatedTitle.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});

for (const route of ["/platform/crunchyroll", "/big-picture/platform/crunchyroll"]) {
  test(`${route}: keeps full-page gradients composited without removing glass`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await prepare(page);
    await mockTrending(page);
    await page.goto(route);
    const platform = page.locator('[data-streaming-platform="crunchyroll"]');
    await expect(platform).toBeVisible();

    for (const selector of [".streaming-platform-page__backdrop", ".streaming-platform-page__scrim"]) {
      const background = platform.locator(selector);
      // Without a persistent layer, SVG backdrop refraction reprocesses these
      // full-page gradients during scrolling in WebView2 (native A/B evidence).
      await expect(background).not.toHaveCSS("transform", "none");
      await expect(background).toHaveCSS("background-image", /gradient\(/);
      const coverage = await background.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const page = element.closest("[data-streaming-platform]")!.getBoundingClientRect();
        return { width: Math.abs(rect.width - page.width), height: Math.abs(rect.height - page.height) };
      });
      expect(coverage.width).toBeLessThan(1);
      expect(coverage.height).toBeLessThan(1);
    }
    const glass = platform.locator(".row-arrow-shell").first();
    await expect(glass).toHaveCSS("backdrop-filter", /frosted-xl/);
  });
}

test("genre tabs query new trends and restore cached All results", async ({ page }) => {
  await prepare(page);
  await mockTrending(page);
  await page.goto("/platform/crunchyroll");
  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  const cards = section.locator(".media-card-frame");
  await expectCatalogCount(section, 20);
  await section.getByRole("tab", { name: "Drama", exact: true }).click();
  await expectCatalogCount(section, 1);
  await expect(section.getByRole("tab", { name: "Drama", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(section).toContainText("Drama de prueba");
  await section.getByRole("tab", { name: "Terror", exact: true }).click();
  await expect(section.getByRole("status")).toContainText("No hay tendencias para este género");
  await expect(section.locator("[data-row-count]")).toHaveCount(0);
  await section.getByRole("tab", { name: "Todos", exact: true }).click();
  await expectCatalogCount(section, 20);
});

test("genre tabs align to the catalog gutter and Todos resets to the start", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/platform/crunchyroll");

  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  const tablist = section.getByRole("tablist", { name: "Géneros" });
  await expectCatalogCount(section, 20);
  await expect(tablist.getByRole("tab")).toHaveText([
    "Todos", "Acción", "Aventura", "Ciencia ficción", "Comedia", "Deportes", "Drama", "Ecchi",
    "Fantasía", "Mecha", "Misterio", "Música", "Psicológico", "Romance", "Sobrenatural", "Suspenso",
    "Terror", "Vida cotidiana",
  ]);
  await expect(tablist.getByRole("tab", { name: "Chicas mágicas", exact: true })).toHaveCount(0);
  const gutter = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-gutter-x")));
  const geometry = async (label: string) => tablist.getByRole("tab", { name: label, exact: true }).evaluate(tab => {
    const tabRect = tab.getBoundingClientRect();
    const rail = tab.parentElement as HTMLElement;
    return { tabLeft: tabRect.left, tabRight: tabRect.right, scrollLeft: rail.scrollLeft };
  });

  const headerLeft = (await section.locator(".crunchyroll-trending__header h2").boundingBox())!.x;
  const firstTab = await geometry("Todos");
  expect(Math.abs(firstTab.tabLeft - headerLeft)).toBeLessThanOrEqual(3);

  await tablist.getByRole("tab", { name: "Suspenso", exact: true }).click();
  await expect(tablist.getByRole("tab", { name: "Suspenso", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => {
    const selected = await geometry("Suspenso");
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    return selected.tabLeft >= gutter - 4 && selected.tabRight <= viewportWidth - gutter + 4;
  }).toBe(true);

  await tablist.getByRole("tab", { name: "Todos", exact: true }).click();
  await expect(tablist.getByRole("tab", { name: "Todos", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => tablist.evaluate(element => (element as HTMLElement).scrollLeft)).toBeLessThan(1);
  const returnedFirstTab = await geometry("Todos");
  expect(Math.abs(returnedFirstTab.tabLeft - headerLeft)).toBeLessThanOrEqual(3);
  expect(returnedFirstTab.tabLeft).toBeGreaterThanOrEqual(gutter - 2);
});

test("trending row keeps standard spacing to the next catalog", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/platform/crunchyroll");

  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  await expectCatalogCount(section, 20);
  const nextCatalogHeading = page.locator(".streaming-platform-catalog [data-row-header]").first();
  await expect(nextCatalogHeading).toBeVisible();
  const cardsBottom = (await section.locator(".media-card-frame").first().boundingBox())!.y
    + (await section.locator(".media-card-frame").first().boundingBox())!.height;
  const headingTop = (await nextCatalogHeading.boundingBox())!.y;
  expect(headingTop - cardsBottom).toBeLessThanOrEqual(80);
});

test("carousel controls and keyboard work and cards open Aetherio details", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/platform/crunchyroll");
  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  const scroller = section.locator(".scroll-row");
  await expectCatalogCount(section, 20);
  await scroller.hover();
  await section.getByRole("button", { name: "Siguiente", exact: true }).click();
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(200);
  await section.getByRole("button", { name: "Anterior", exact: true }).click();
  await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeLessThan(3);
  await section.locator(".media-card-frame").nth(1).click();
  await expect(page).toHaveURL(/\/detail\/anime\/tmdb%3A/);
});

test("Crunchyroll Top 10 Anime restores its selected card after returning from episode streams", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await mockTrending(page, []);
  await mockDragonBallDetail(page);
  await page.goto("/platform/crunchyroll");

  const row = page.locator('[data-row-key="tmdb/streaming.crunchyroll.anime.top-10/series"]');
  await expect(row).toHaveAttribute("data-row-count", "11");
  const card = row.locator(".media-card-frame").nth(4);
  const scroller = row.locator("[data-row-scroller]");
  const shell = page.locator(".streaming-platform-scroll-shell");
  await expect(card).toBeVisible();
  const saved = await page.evaluate(() => {
    const shellElement = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    const rowElement = document.querySelector<HTMLElement>('[data-row-key="tmdb/streaming.crunchyroll.anime.top-10/series"]');
    const scrollerElement = rowElement?.querySelector<HTMLElement>("[data-row-scroller]");
    const target = rowElement?.querySelector<HTMLElement>('[data-item-index="3"] .media-card-frame');
    if (!shellElement || !rowElement || !scrollerElement || !target) throw new Error("Crunchyroll trending card not found");
    shellElement.scrollTop = Math.max(0, shellElement.scrollTop + rowElement.getBoundingClientRect().top - shellElement.getBoundingClientRect().top - 140);
    scrollerElement.scrollLeft = 300;
    target.focus({ preventScroll: true });
    return { vertical: shellElement.scrollTop, horizontal: scrollerElement.scrollLeft };
  });

  await card.evaluate(element => (element as HTMLElement).click());
  await expect(page).toHaveURL(/\/detail\/series\/tmdb%3A424242$/);
  await expect(page.getByRole("heading", { name: "Dragon Ball Daima: Beerus" })).toBeVisible();
  await expect(page.locator(".detail-episode-card")).toHaveCount(4);
  const episodeFour = page.locator(".detail-episode-card").nth(3);
  await expect(episodeFour).toContainText("Beerus");
  await episodeFour.evaluate(element => (element as HTMLElement).click());
  const episodeSections = page.locator("[data-aetherio-episode-section]");
  await expect(episodeSections).toHaveCount(2);
  await expect(episodeSections.first()).toHaveCSS("visibility", "visible");

  await page.keyboard.press("Escape");
  await expect(episodeSections).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL(/\/platform\/crunchyroll$/);
  await expect(card).toBeFocused();
  await expect.poll(() => shell.evaluate(element => (element as HTMLElement).scrollTop)).toBe(saved.vertical);
  await expect.poll(() => scroller.evaluate(element => (element as HTMLElement).scrollLeft)).toBe(saved.horizontal);

  // Player return can enter through /streams, which redirects into the same
  // embedded episode section while preserving the platform's focus snapshot.
  await card.evaluate(element => (element as HTMLElement).click());
  await expect(page).toHaveURL(/\/detail\/series\/tmdb%3A424242$/);
  await expect(page.locator(".detail-episode-card")).toHaveCount(4);
  await page.evaluate(() => {
    const currentState = window.history.state && typeof window.history.state === "object"
      ? window.history.state as Record<string, unknown>
      : {};
    const nextIndex = typeof currentState.idx === "number" ? currentState.idx + 1 : 1;
    window.history.pushState(
      { usr: null, key: `e2e-streams-${nextIndex}`, idx: nextIndex },
      "",
      "/streams?type=series&id=tmdb%3A424242&season=1&ep=4&epTitle=Beerus",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/detail\/series\/tmdb%3A424242/);
  const redirectedEpisodeSections = page.locator("[data-aetherio-episode-section]");
  await expect(redirectedEpisodeSections).toHaveCount(2);
  await expect(redirectedEpisodeSections.first()).toHaveCSS("visibility", "visible");
  await expect(redirectedEpisodeSections.first()).toContainText("Beerus");

  await page.keyboard.press("Escape");
  await expect(redirectedEpisodeSections).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/platform\/crunchyroll$/);
  await expect(card).toBeFocused();
  await expect.poll(() => shell.evaluate(element => (element as HTMLElement).scrollTop)).toBe(saved.vertical);
  await expect.poll(() => scroller.evaluate(element => (element as HTMLElement).scrollLeft)).toBe(saved.horizontal);
});

test("Big Picture returns to the platform header when pressing up from the first row", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/big-picture/platform/crunchyroll");

  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  const firstCard = section.locator(".media-card-frame").first();
  const shell = page.locator("[data-aetherio-scroll-shell]").first();
  await expectCatalogCount(section, 20);
  const startingScrollTop = await shell.evaluate((element, card) => {
    const shellTop = element.getBoundingClientRect().top;
    const cardTop = (card as HTMLElement).getBoundingClientRect().top;
    const target = Math.max(0, element.scrollTop + cardTop - shellTop - 180);
    element.scrollTop = target;
    return element.scrollTop;
  }, await firstCard.elementHandle());
  expect(startingScrollTop).toBeGreaterThan(0);

  await firstCard.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBeLessThan(2);
  await expect(page.locator(".streaming-platform-hero__title img")).toBeInViewport();
  await expect(page.locator(".streaming-platform-hero__copy p")).toBeInViewport();
});

test("Big Picture gets the same first catalog section and preserves its detail route", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/big-picture/platform/crunchyroll");
  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  const cards = section.locator(".media-card-frame");
  await expectCatalogCount(section, 20);
  const genreTabs = section.getByRole("tablist", { name: "Géneros" });
  await expect(genreTabs).toHaveAttribute("data-spatial-ignore", "true");
  expect(await genreTabs.locator('[role="tab"]').evaluateAll(tabs => tabs.every(tab => tab.getAttribute("aria-disabled") === "true"))).toBe(true);
  expect(await genreTabs.locator('[role="tab"]').evaluateAll(tabs => tabs.every(tab => tab.getAttribute("tabindex") === "-1"))).toBe(true);
  await expect(section.getByRole("button", { name: "Más géneros" })).toHaveCount(0);

  const rightBumperClaimed = await page.evaluate(() => {
    const action = new CustomEvent("aetherio-gamepad-action", { cancelable: true, detail: { id: "rb" } });
    window.dispatchEvent(action);
    return action.defaultPrevented;
  });
  expect(rightBumperClaimed).toBe(true);
  await expect(section.getByRole("tab", { name: "Acción", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("PageDown");
  await expect(section.getByRole("tab", { name: "Aventura", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("PageUp");
  await expect(section.getByRole("tab", { name: "Acción", exact: true })).toHaveAttribute("aria-selected", "true");

  await cards.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();
  const focusedTitle = cards.nth(1).locator("xpath=..").locator(":scope > div").nth(1);
  await expect.poll(() => focusedTitle.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  const hero = (await page.locator(".streaming-platform-hero").boundingBox())!;
  expect((await section.boundingBox())!.y).toBeGreaterThanOrEqual(hero.y + hero.height);
  await cards.nth(1).click();
  await expect(page).toHaveURL(/\/big-picture\/detail\/anime\/tmdb%3A/);
});

test("small viewports keep genres and covers in their own horizontal rails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await mockTrending(page);
  await page.goto("/platform/crunchyroll");
  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  await expectCatalogCount(section, 20);
  expect((await section.boundingBox())!.width).toBeLessThan(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(section.locator(".crunchyroll-trending__genre-arrow")).toHaveCount(0);
  await section.locator("[data-trending-genres]").evaluate(el => el.scrollTo({ left: 240, behavior: "instant" }));
  await expect.poll(() => section.locator("[data-trending-genres]").evaluate(el => el.scrollLeft)).toBeGreaterThan(10);
});

test("a failed AniList request can be retried without hiding the existing catalog", async ({ page }) => {
  await prepare(page);
  let unavailable = true;
  await page.route("https://graphql.anilist.co/", route => unavailable
    ? route.fulfill({ status: 503, body: "Unavailable" })
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { Page: { media: trending } } }) }));
  await page.goto("/platform/crunchyroll");
  const section = page.getByRole("region", { name: "En tendencia ahora", exact: true });
  await expect(section.getByRole("status")).toContainText("No pudimos cargar las tendencias de AniList");
  await expect(page.getByRole("heading", { name: "Crunchyroll", exact: true })).toBeVisible();
  unavailable = false;
  await section.getByRole("button", { name: "Intentar de nuevo" }).click();
  await expectCatalogCount(section, 20);
});

test("other platforms do not get the trending section or request its discovery query", async ({ page }) => {
  await prepare(page);
  let requests = 0;
  await page.route("https://graphql.anilist.co/", route => {
    if (route.request().postDataJSON().query.includes("AetherioTrendingAnime")) requests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { Page: { media: [] } } }) });
  });
  await page.goto("/platform/netflix");
  await expect(page.getByRole("heading", { name: "Netflix", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "En tendencia ahora", exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});
