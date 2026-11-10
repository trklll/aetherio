import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

async function openFlagProbe(page: Page, material = false) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const metrics = { contexts: 0, released: 0, draws: [] as number[] };
    Object.assign(window, { flagMetrics: metrics });
    const seen = new WeakSet<WebGLRenderingContext>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      const context = getContext.apply(this, args);
      if (args[0] === "webgl" && context && !seen.has(context as WebGLRenderingContext)) {
        const gl = context as WebGLRenderingContext;
        seen.add(gl);
        metrics.contexts += 1;
        this.addEventListener("webglcontextlost", () => { metrics.released += 1; });
        const draw = gl.drawElements.bind(gl);
        gl.drawElements = (...drawArgs) => { metrics.draws.push(performance.now()); if (metrics.draws.length > 300) metrics.draws.shift(); draw(...drawArgs); };
      }
      return context;
    } as typeof getContext;
  });
  await page.route("**/__sports-flag-probe*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { mountSportsFlagProbe } = await import('/e2e/fixtures/SportsFlagProbe.tsx');
    mountSportsFlagProbe();
  </script></body></html>` }));
  await page.route("**/teamlogo/**", route => route.abort());
  await page.goto(`/__sports-flag-probe${material ? "?material=1" : ""}`);
  await expect(page.locator('[data-probe-match="0"] .sports-flag')).toHaveAttribute("data-flag-ready", "true", { timeout: 30_000 });
  await expect(page.locator('[data-probe-match="0"] .sports-flag')).toHaveAttribute("data-flag-motion", material ? "still" : "running");
}

test("muchos partidos no acumulan contextos de bandera", async ({ page }) => {
  await openFlagProbe(page);
  for (let index = 1; index <= 12; index += 1) {
    await page.getByRole("button", { name: `Partido ${index + 1}`, exact: true }).click();
    await expect(page.locator(`[data-probe-match="${index}"] .sports-flag`)).toHaveAttribute("data-flag-motion", "running");
  }
  await expect(page.locator(".sports-flag__canvas:visible")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const metrics = (window as unknown as { flagMetrics: { contexts: number; released: number } }).flagMetrics;
    return metrics.contexts - metrics.released;
  })).toBe(1);
  const metrics = await page.evaluate(() => {
    const { contexts, released } = (window as unknown as { flagMetrics: { contexts: number; released: number } }).flagMetrics;
    return { contexts, released };
  });
  console.log(`FLAG_CONTEXTS ${JSON.stringify(metrics)}`);
  expect(metrics.contexts - metrics.released).toBe(1);
});

test("capturas del relieve de tela", async ({ page }, testInfo) => {
  await openFlagProbe(page);
  await page.locator('nav[aria-label="Partidos de prueba"]').evaluate(element => (element as HTMLElement).style.visibility = "hidden");
  for (const [width, height, name] of [[1440, 1000, "desktop"], [390, 844, "narrow"]] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: testInfo.outputPath(`cloth-${name}.png`) });
  }
});

test("la animación se limita al viewport y los previews no duplican tablas", async ({ page }) => {
  await openFlagProbe(page);
  const bounds = await page.locator(".sports-flag__canvas:visible").evaluate(element => ({ height: element.getBoundingClientRect().height, viewport: innerHeight }));
  console.log(`FLAG_BOUNDS ${JSON.stringify(bounds)}`);
  expect(bounds.height).toBeLessThanOrEqual(bounds.viewport);
  await expect(page.locator("table")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.locator(".sports-flag__canvas:visible").evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(0);
});

test("preview y detalle son idénticos en la misma pose, a Full HD nativo", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openFlagProbe(page, true);
  const canvas = page.locator(".sports-flag__canvas");
  expect(await canvas.evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height }))).toEqual({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "Iniciar tela" }).evaluate(element => (element as HTMLElement).style.opacity = "0");
  const preview = await canvas.screenshot({ path: testInfo.outputPath("preview-native.png") });
  const staticDraws = await page.evaluate(() => (window as unknown as { flagMetrics: { draws: number[] } }).flagMetrics.draws.length);
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => (window as unknown as { flagMetrics: { draws: number[] } }).flagMetrics.draws.length)).toBe(staticDraws);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Iniciar tela" }).click();
  await expect(page.locator(".sports-flag")).toHaveAttribute("data-flag-motion", "still");
  const detail = await canvas.screenshot({ path: testInfo.outputPath("detail-native.png") });
  expect(detail.equals(preview)).toBe(true);
});

test("cadencia real de dibujo con 24 partidos y tabla larga", async ({ page }) => {
  await openFlagProbe(page);
  const cadence = await page.evaluate(async () => {
    const metrics = (window as unknown as { flagMetrics: { draws: number[] } }).flagMetrics;
    metrics.draws.length = 0;
    const start = performance.now();
    let frames = 0;
    await new Promise<void>(resolve => {
      const sample = (time: number) => { frames += 1; if (time - start < 1_500) requestAnimationFrame(sample); else resolve(); };
      requestAnimationFrame(sample);
    });
    const intervals = metrics.draws.slice(1).map((time, index) => time - metrics.draws[index]).sort((a, b) => a - b);
    return { frames, draws: metrics.draws.length, p95: intervals[Math.floor((intervals.length - 1) * .95)] ?? Infinity };
  });
  console.log(`FLAG_DRAW_CADENCE ${JSON.stringify(cadence)}`);
  expect(cadence.draws).toBeGreaterThan(45);
  expect(cadence.draws).toBeGreaterThanOrEqual(cadence.frames - 2);
  expect(cadence.p95).toBeLessThan(34);
});

test("el ondeo permanece dentro de la ventana sin exponer el borde de la tela", async ({ page }) => {
  await openFlagProbe(page);
  const uncovered = await page.locator(".sports-flag__canvas:visible").evaluate(async element => {
    const canvas = element as HTMLCanvasElement;
    await new Promise<void>(resolve => {
      let frames = 0;
      const next = () => { if (++frames < 60) requestAnimationFrame(next); else resolve(); };
      requestAnimationFrame(next);
    });
    const gl = canvas.getContext("webgl")!;
    const clear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    const count = gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE) / 2;
    gl.clearColor(1, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let uncovered = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 255) uncovered += 1;
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    return uncovered;
  });
  expect(uncovered).toBe(0);
});
