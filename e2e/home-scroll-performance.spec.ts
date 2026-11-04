import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function openFullHome(page: Page, route: string) {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.route("https://**/*", request => request.fulfill({
    contentType: "application/json", body: JSON.stringify({ results: [], data: [] }),
  }));
  await page.addInitScript(() => {
    localStorage.setItem("aetherio-local-mode-v1", "1");
  });
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".home-page-scale")).toBeVisible();
  await page.evaluate(async () => {
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
        poster: image, background: image, year: 2026,
      })),
    }));
    queryClient.setQueryData(query.queryKey, rows);
  });
  await expect(page.locator('[data-row-key*="/scroll-perf-"]')).toHaveCount(32);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

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

for (const [mode, route] of [["normal", "/home"], ["TV", "/big-picture"]]) {
  test(`${mode}: no mantiene cientos de capas de animación en tarjetas inactivas`, async ({ page }) => {
    await openFullHome(page, route);
    const hints = await page.locator('[data-row-key*="/scroll-perf-"]').evaluateAll(rows =>
      rows.flatMap(row => Array.from(row.querySelectorAll<HTMLElement>("*")))
        .filter(element => getComputedStyle(element).willChange.includes("transform")).length);
    // Animation layers should follow active interactions, not the catalog size.
    expect(hints).toBeLessThan(16);
  });

  test(`${mode}: la rueda usa scroll nativo sin una animación JavaScript bloqueante`, async ({ page }) => {
    await openFullHome(page, route);
    const prevented = await page.locator(".media-card-frame").first().evaluate(element => {
      const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
      element.dispatchEvent(wheel);
      return wheel.defaultPrevented;
    });
    expect(prevented).toBe(false);
    // Use a real visible card, not a viewport coordinate that may still be
    // covered by Big Picture's entrance layer or floating navigation.
    await page.locator(".media-card-frame").first().hover();
    const shell = page.locator("[data-aetherio-scroll-shell]").first();
    const before = await shell.evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, 480);
    await expect.poll(() => shell.evaluate(element => element.scrollTop)).toBeGreaterThan(before + 200);
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
