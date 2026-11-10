import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function openFullHome(page: Page, route: string, networkArtwork = false) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route("https://**/*", request => request.fulfill({
    contentType: "application/json", body: JSON.stringify({ results: [], data: [] }),
  }));
  await page.route("**/__poster-perf/**", request => request.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><rect width="1000" height="1500" fill="#214362"/></svg>',
  }));
  await page.addInitScript(() => {
    localStorage.setItem("aetherio-local-mode-v1", "1");
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".home-page-scale")).toBeVisible();
  await page.evaluate(async networkArtwork => {
    // Use the app's real query/cache and real Home rows; no public service or
    // personal library is involved in this deterministic 32-catalog fixture.
    const source = "/src/queryClient.ts";
    const { queryClient } = await import(/* @vite-ignore */ source);
    await queryClient.cancelQueries({ queryKey: ["home"] });
    const query = queryClient.getQueryCache().getAll().find((entry: { queryKey: unknown[] }) =>
      entry.queryKey[0] === "home" && entry.queryKey[1] === "rows");
    if (!query) throw new Error("Home rows query not mounted");
    const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#214362"/><circle cx="200" cy="280" r="140" fill="#456987"/></svg>')}`;
    const rows = Array.from({ length: 32 }, (_, row) => ({
      addonId: "aetherio-starter", addonName: "Aetherio", catalogId: `scroll-perf-${row}`,
      name: `Catálogo de prueba ${row}`, type: "movie",
      items: Array.from({ length: 20 }, (_, item) => ({
        id: `scroll-perf-${row}-${item}`, name: `Película ${row} / ${item}`, type: "movie",
        poster: networkArtwork ? `/__poster-perf/${row}/${item}.svg` : image,
        background: image, year: 2026,
      })),
    }));
    queryClient.setQueryData(query.queryKey, rows);
  }, networkArtwork);
  await expect(page.locator('[data-row-key*="/scroll-perf-"]')).toHaveCount(32);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

test("Home only loads nearby posters, retaining full resolution when scrolling both axes", async ({ page }) => {
  const requests = new Set<string>();
  page.on("request", request => {
    if (request.url().includes("/__poster-perf/")) requests.add(new URL(request.url()).pathname);
  });
  await openFullHome(page, "/home", true);
  const firstRow = page.locator('[data-row-key="aetherio-starter/scroll-perf-0/movie"]');
  await firstRow.scrollIntoViewIfNeeded();
  const firstImage = firstRow.locator('img[alt="Película 0 / 0"]');
  await expect.poll(() => firstImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1000);

  // 640 distinct images: JavaScript preloads must not bypass native lazy loading.
  console.log(`[home-posters:initial] ${requests.size} unique loads (640 available)`);
  expect(requests.size).toBeLessThan(80);
  expect([...requests].some(url => url.startsWith("/__poster-perf/31/"))).toBe(false);
  expect(requests.has("/__poster-perf/0/19.svg")).toBe(false);

  await firstRow.locator("[data-row-scroller]").evaluate(element => { element.scrollLeft = 4000; });
  await expect.poll(() => requests.has("/__poster-perf/0/19.svg")).toBe(true);
  const distantRow = page.locator('[data-row-key="aetherio-starter/scroll-perf-20/movie"]');
  await distantRow.scrollIntoViewIfNeeded();
  const distantImage = distantRow.locator('img[alt="Película 20 / 0"]');
  await expect.poll(() => distantImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1000);
  console.log(`[home-posters] ${requests.size} unique loads after vertical + horizontal navigation (640 available)`);
});

async function measureScroll(page: Page) {
  return page.evaluate(async () => {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]")!;
    shell.scrollTop = 0;
    const frameTimes: number[] = [];
    const longTasks: number[] = [];
    const observer = new PerformanceObserver(list => {
      longTasks.push(...list.getEntries().map(entry => entry.duration));
    });
    observer.observe({ type: "longtask" });
    const distance = Math.min(8000, shell.scrollHeight - shell.clientHeight);
    const start = performance.now();
    let previous = start;
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        frameTimes.push(now - previous);
        previous = now;
        const elapsed = now - start;
        const progress = Math.min(1, elapsed / 4000);
        shell.scrollTop = Math.round(distance * progress);
        if (elapsed < 4000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    const sorted = frameTimes.slice(2).sort((a, b) => a - b);
    return {
      frames: frameTimes.length,
      frameP95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(1)),
      framesOver33Ms: sorted.filter(value => value > 33.4).length,
      longTasks: longTasks.length,
      longTaskTotalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
      scrollTop: Math.round(shell.scrollTop),
    };
  });
}

test("Home keeps keyboard focus on a card after marking a title watched", async ({ page }) => {
  await openFullHome(page, "/home");
  const firstCard = page.locator(".media-card-frame").first();
  await firstCard.evaluate(element => element.setAttribute("data-mark-watched-focus-target", "true"));
  await firstCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Marcar como visto", exact: true }).click();

  await expect(page.locator('[data-mark-watched-focus-target="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement?.matches(".media-card-frame") ?? false)).toBe(true);
});

for (const [route, cinematic] of [["/home", false], ["/big-picture", false], ["/big-picture", true]] as const) {
test(`${route}${cinematic ? " cinematic" : ""}: Home restores the exact row, viewport and card after returning from its detail`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFullHome(page, route);
  if (cinematic) {
    await page.evaluate(async () => {
      const source = "/src/queryClient.ts";
      const { queryClient } = await import(source);
      const query = queryClient.getQueryCache().getAll().find((entry: { queryKey: unknown[] }) => entry.queryKey[0] === "home" && entry.queryKey[1] === "rows");
      queryClient.setQueryData(query!.queryKey, (rows: Array<{ catalogId: string }>) => rows.map(row => row.catalogId === "scroll-perf-9" ? { ...row, presentation: "cinematic" } : row));
    });
  }
  const row = page.locator('[data-row-key="aetherio-starter/scroll-perf-9/movie"]');
  const shell = page.locator("[data-aetherio-scroll-shell]");
  const card = row.locator(cinematic ? '[data-item-index="3"]' : '[data-item-index="3"] .media-card-frame');
  await row.evaluate(element => {
    const scrollShell = document.querySelector<HTMLElement>("[data-aetherio-scroll-shell]");
    if (!scrollShell) throw new Error("Home scroll shell not found");
    scrollShell.scrollTop = element.getBoundingClientRect().top - scrollShell.getBoundingClientRect().top;
  });
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  const savedPosition = await shell.evaluate(element => (element as HTMLElement).scrollTop);
  const savedHorizontal = await row.locator("[data-row-scroller]").evaluate(element => element.scrollLeft);

  if (route === "/big-picture") await card.press("Enter");
  else await card.click();
  if (route === "/big-picture") {
    // TV opens the embedded detail preview rather than pushing a route.
    const preview = page.getByRole("dialog", { name: "Película 9 / 3", exact: true });
    await expect(preview).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
  } else {
    await expect(page).toHaveURL(/\/detail\/movie\//);
    await page.goBack();
  }

  await expect(row).toBeVisible();
  await expect(card).toBeFocused();
  await expect.poll(() => shell.evaluate(element => (element as HTMLElement).scrollTop)).toBe(savedPosition);
  await expect.poll(() => row.locator("[data-row-scroller]").evaluate(element => element.scrollLeft)).toBe(savedHorizontal);
});
}

for (const [mode, route] of [["normal", "/home"], ["TV", "/big-picture"]]) {
  test(`${mode}: mide gestos reales de rueda, no solo scrollTop programático`, async ({ page }) => {
    await openFullHome(page, route);
    await page.locator(".media-card-frame").first().hover();
    const initialTop = await page.locator("[data-aetherio-scroll-shell]").first().evaluate(element => element.scrollTop);
    const session = await page.context().newCDPSession(page);
    await session.send("Performance.enable");
    const before = await session.send("Performance.getMetrics");
    const [sample] = await Promise.all([
      page.evaluate(async () => {
        const frames: number[] = [];
        const start = performance.now();
        let previous = start;
        let cancelledWheels = 0;
        let wheelCount = 0;
        const onWheel = (event: WheelEvent) => { wheelCount += 1; if (event.defaultPrevented) cancelledWheels += 1; };
        document.addEventListener("wheel", onWheel, { passive: true });
        await new Promise<void>(resolve => {
          const tick = (now: number) => {
            frames.push(now - previous);
            previous = now;
            if (now - start < 2000) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
        document.removeEventListener("wheel", onWheel);
        const sorted = frames.slice(2).sort((a, b) => a - b);
        return {
          frameP95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(1)),
          framesOver33Ms: sorted.filter(value => value > 33.4).length,
          cancelledWheels,
          wheelCount,
        };
      }),
      (async () => { for (let n = 0; n < 36; n++) await page.mouse.wheel(0, 180); })(),
    ]);
    const after = await session.send("Performance.getMetrics");
    const delta = (name: string) => Number(((after.metrics.find(metric => metric.name === name)?.value ?? 0)
      - (before.metrics.find(metric => metric.name === name)?.value ?? 0)).toFixed(4));
    console.log(`[home-wheel:${mode}] ${JSON.stringify({ ...sample, layouts: delta("LayoutCount"), layoutMs: delta("LayoutDuration") * 1000, scriptMs: delta("ScriptDuration") * 1000 })}`);
    await session.detach();
    await expect.poll(() => page.locator("[data-aetherio-scroll-shell]").first().evaluate(element => element.scrollTop)).toBeGreaterThan(initialTop + 1000);
  });

  test(`${mode}: composición por fila sin promover cada tarjeta ni cambiar el scroll TV`, async ({ page }) => {
    await openFullHome(page, route);
    const rows = page.locator('[data-row-key*="/scroll-perf-"]');
    // The entrance tween temporarily transforms rows; the persistent surface
    // must survive its clearProps, not merely exist during the entrance.
    await expect.poll(() => rows.first().evaluate(element => (element as HTMLElement).style.transform)).toBe("");
    const transforms = await rows.evaluateAll(elements => elements.map(element => getComputedStyle(element).transform));
    if (mode === "normal") {
      expect(transforms.every(transform => transform !== "none")).toBe(true);
      expect(await rows.first().evaluate(element => new DOMMatrixReadOnly(getComputedStyle(element).transform).isIdentity)).toBe(true);
    } else {
      // This change is measured on desktop; do not alter TV's compositor path.
      expect(transforms.every(transform => transform === "none")).toBe(true);
    }
    expect(await rows.locator("[data-row-card]").evaluateAll(cards => cards.filter(card =>
      getComputedStyle(card).transform.startsWith("matrix3d") || getComputedStyle(card).willChange.includes("transform"),
    ).length)).toBe(0);
    expect(await rows.last().evaluate(element => getComputedStyle(element).contentVisibility)).toBe("auto");
  });

  test(`${mode}: no mantiene cientos de capas de animación en tarjetas inactivas`, async ({ page }) => {
    await openFullHome(page, route);
    const hints = await page.locator('[data-row-key*="/scroll-perf-"]').evaluateAll(rows =>
      rows.flatMap(row => Array.from(row.querySelectorAll<HTMLElement>("*")))
        .filter(element => getComputedStyle(element).willChange.includes("transform")).length);
    // Animation layers should follow active interactions, not the catalog size.
    expect(hints).toBeLessThan(16);
  });

  test(`${mode}: omite renderizar filas lejanas sin cambiar su altura ni ocultar el foco`, async ({ page }) => {
    await openFullHome(page, route);
    const first = page.locator('[data-row-key="aetherio-starter/scroll-perf-0/movie"]');
    const last = page.locator('[data-row-key="aetherio-starter/scroll-perf-31/movie"]');
    await first.scrollIntoViewIfNeeded();
    expect(await last.evaluate(element => getComputedStyle(element).contentVisibility)).toBe("auto");
    const firstHeight = await first.evaluate(element => element.getBoundingClientRect().height);
    const lastHeight = await last.evaluate(element => element.getBoundingClientRect().height);
    expect(Math.abs(firstHeight - lastHeight)).toBeLessThan(1);
    await last.scrollIntoViewIfNeeded();
    const card = last.locator(".media-card-frame").first();
    await card.focus();
    await expect(card).toBeFocused();
    await expect(card).toBeInViewport();
    expect(Math.abs(await last.evaluate(element => element.getBoundingClientRect().height) - lastHeight)).toBeLessThan(1);
    if (mode === "TV") {
      await page.keyboard.press("ArrowUp");
      const previousCard = page.locator('[data-row-key="aetherio-starter/scroll-perf-30/movie"] .media-card-frame').first();
      await expect(previousCard).toBeFocused();
      await expect(previousCard).toBeInViewport();
    }
  });

  test(`${mode}: la rueda usa la ruta de scroll adecuada sin perder desplazamiento`, async ({ page }) => {
    await openFullHome(page, route);
    const prevented = await page.locator(".media-card-frame").first().evaluate(element => {
      const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
      element.dispatchEvent(wheel);
      return wheel.defaultPrevented;
    });
    // Desktop Home uses GSAP inertia; TV keeps its compositor-backed routing.
    expect(prevented).toBe(true);
    // Use a real visible card, not a viewport coordinate that may still be
    // covered by Big Picture's entrance layer or floating navigation.
    await page.locator(".media-card-frame").first().hover();
    const shell = page.locator("[data-aetherio-scroll-shell]").first();
    const before = await shell.evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, 480);
    await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBeGreaterThan(before + 200);
  });

  test(`${mode}: ${mode === "normal" ? "anima scrollTop con GSAP" : "mantiene el scroll del compositor sin tweens GSAP"}`, async ({ page }) => {
    await openFullHome(page, route);
    const card = page.locator(".media-card-frame").first();
    await card.hover();
    const tweens = await card.evaluate(async element => {
      const path = "/src/utils/motion.ts";
      const { gsap } = await import(/* @vite-ignore */ path);
      element.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
      const shell = document.querySelector("[data-aetherio-scroll-shell]");
      return gsap.getTweensOf(shell).filter((tween: { vars: { scrollTop?: number } }) => tween.vars.scrollTop !== undefined).length;
    });
    expect(tweens).toBe(mode === "normal" ? 1 : 0);
  });

  test(`${mode}: desplaza un Home completo y conserva hover y navegación horizontal`, async ({ page }) => {
    await openFullHome(page, route);
    console.log(`[home-scroll:${mode}] ${JSON.stringify(await measureScroll(page))}`);
    const row = page.locator('[data-row-key="aetherio-starter/scroll-perf-0/movie"]');
    const card = row.locator(".media-card-frame").first();
    await card.hover();
    await expect.poll(() => card.evaluate(element =>
      new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeGreaterThan(1.03);
    await page.mouse.move(5, 5);
    await expect.poll(() => card.evaluate(element =>
      new DOMMatrixReadOnly(getComputedStyle(element).transform).a)).toBeLessThan(1.01);
    const scroller = row.locator("[data-row-scroller]");
    await scroller.evaluate(element => { element.scrollLeft = 1800; });
    await expect.poll(() => row.locator('[data-item-index="10"]').count()).toBeGreaterThan(0);
    const left = await scroller.evaluate(element => element.scrollLeft);
    expect(left).toBeGreaterThan(0);
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBe(left);
  });
}
