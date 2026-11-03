import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, autoRecover = true, initiallyLoaded = true) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ autoRecover, initiallyLoaded }) => {
    localStorage.setItem("aetherio-local-mode-v1", "1");
    let id = 1;
    let loaded = initiallyLoaded;
    let time = 1;
    let failure: Record<string, unknown> | null = null;
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, { event: string; handler: number }>();
    const opens: Record<string, unknown>[] = [];
    Object.assign(window, {
      __recovery: {
        opens,
        get listeners() { return listeners.size; },
        emit(payload: Record<string, unknown>) {
          if (payload.event === "end-file" && payload.endReason === "error") { loaded = false; time = 0; failure = payload; }
          for (const [eventId, listener] of listeners) if (listener.event === "mpv-event") callbacks.get(listener.handler)?.({ event: "mpv-event", id: eventId, payload });
        },
      },
      __TAURI_INTERNALS__: {
        transformCallback(callback: (event: unknown) => void) { const key = id++; callbacks.set(key, callback); return key; },
        unregisterCallback(key: number) { callbacks.delete(key); },
        async invoke(command: string, args?: Record<string, any>) {
          if (command === "plugin:event|listen") { const key = id++; listeners.set(key, { event: args?.event, handler: args?.handler }); return key; }
          if (command === "plugin:event|unlisten") { listeners.delete(args?.eventId); return; }
          if (command === "open_mpv") {
            opens.push(args ?? {});
            loaded = opens.length === 1 ? initiallyLoaded : autoRecover;
            failure = null;
            time = loaded ? 1 : 0;
            (window as any).__recovery.emit({ event: "start-file" });
            return { backend: "libmpv", resolvedTarget: args?.target };
          }
          if (command === "mpv_status") return { timePos: loaded ? time++ : 0, duration: 0, pause: !loaded, fileLoaded: loaded, videoWidth: loaded ? 1920 : null, videoHeight: loaded ? 1080 : null, tracks: [], playbackFailure: failure };
          if (command === "playback_capabilities") return { mpvBundled: true, backend: "libmpv" };
          if (command.startsWith("plugin:event|")) return id++;
          return null;
        },
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {},
      },
    });
    const streams = [
      { id: "iptv", addonId: "iptv-sports", addonName: "IPTV", name: "Mi canal", url: "https://cdn.example.com/live.m3u8", behaviorHints: { live: true, sourceType: "iptv", proxyHeaders: { request: { Referer: "https://watch.example.com/", "User-Agent": "Mi TV" } } } },
      { id: "alternative", addonId: "live", addonName: "Addon Sports", name: "Alternativa", url: "https://addon.example.com/live.m3u8", behaviorHints: { live: true } },
    ];
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify(streams[0]));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: "Mi canal" }));
    sessionStorage.setItem("aetherio-available-streams", JSON.stringify({ key: "live:recovery::", streams }));
  }, { autoRecover, initiallyLoaded });
  await page.goto("/big-picture/player?type=live&id=recovery");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
  await expect.poll(() => page.evaluate(() => (window as any).__recovery.opens.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__recovery.listeners)).toBeGreaterThan(0);
}

async function fail(page: Page, httpStatus: number) {
  await page.evaluate(httpStatus => (window as any).__recovery.emit({ event: "end-file", endReason: "error", errorCode: -13, httpStatus }), httpStatus);
}

test("un 404 se explica y permite otra fuente sin bucle de reintentos", async ({ page }) => {
  await setup(page);
  await page.clock.install();
  await fail(page, 404);
  await expect(page.getByText(/El servidor respondió HTTP 404/)).toBeVisible();
  await page.clock.fastForward(6000);
  expect(await page.evaluate(() => (window as any).__recovery.opens.length)).toBe(1);
  await page.screenshot({ path: ".impeccable/review/iptv-error-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/iptv-error-mobile.png" });
  await page.getByRole("button", { name: "Elegir otra fuente", exact: true }).click();
  await page.getByRole("dialog", { name: "Fuentes", exact: true }).locator('[data-source-id="alternative"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__recovery.opens.at(-1)?.target)).toBe("https://addon.example.com/live.m3u8");
});

test("un corte temporal vuelve a abrir la misma fuente con sus cabeceras y sin reanudar VOD", async ({ page }) => {
  await setup(page);
  await fail(page, 503);
  await expect.poll(() => page.evaluate(() => (window as any).__recovery.opens.length)).toBe(2);
  const request = await page.evaluate(() => (window as any).__recovery.opens[1]);
  expect(request).toMatchObject({ live: true, target: "https://cdn.example.com/live.m3u8", headers: { Referer: "https://watch.example.com/", "User-Agent": "Mi TV" } });
  expect(request.startTime).toBeUndefined();
  await expect(page.getByRole("button", { name: "Reintentar reproducción", exact: true })).toHaveCount(0);
});

test("una fuente inestable agota dos recuperaciones sin crear un bucle", async ({ page }) => {
  await setup(page, false);
  for (let attempt = 0; attempt < 2; attempt++) {
    await fail(page, 503);
    await expect.poll(() => page.evaluate(() => (window as any).__recovery.opens.length)).toBe(attempt + 2);
  }
  await fail(page, 503);
  await expect(page.getByText(/HTTP 503/)).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(10_000);
  expect(await page.evaluate(() => (window as any).__recovery.opens.length)).toBe(3);
});

test("detener o redirigir un stream no se confunde con un fallo", async ({ page }) => {
  await setup(page);
  for (const endReason of ["stop", "quit", "redirect"]) {
    await page.evaluate(endReason => (window as any).__recovery.emit({ event: "end-file", endReason, errorCode: 0 }), endReason);
  }
  await expect(page.getByRole("button", { name: "Reintentar reproducción", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__recovery.opens.length)).toBe(1);
});

test("un arranque IPTV lento no falla antes de que termine el margen nativo", async ({ page }) => {
  await setup(page, false, false);
  await page.clock.install();
  await page.clock.fastForward(13_000);
  await expect(page.getByRole("button", { name: "Reintentar reproducción", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__recovery.opens.length)).toBe(1);
});
