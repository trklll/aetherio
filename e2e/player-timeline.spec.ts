import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, tv: boolean, intro = false) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route("https://**/*", route => route.fulfill({
    status: 200, contentType: "application/json", body: "{}",
  }));
  await page.addInitScript(({ intro }) => {
    const w = window as any;
    let callbackId = 1;
    const state = { position: 120, paused: false, seeks: [] as number[] };
    w.__timelineTest = state;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => callbackId++,
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
      async invoke(cmd: string, args: any) {
        if (cmd === "mpv_status") return {
          timePos: state.position, duration: 3600, pause: state.paused,
          fileLoaded: true, tracks: [], videoWidth: 1920, videoHeight: 1080,
        };
        if (cmd === "mpv_command" && args?.command?.[0] === "seek") {
          const [, time, mode] = args.command;
          state.position = mode === "relative" ? state.position + time : time;
          state.seeks.push(state.position);
        }
        if (cmd === "mpv_set_property" && args?.name === "pause") state.paused = args.value;
        if (cmd === "playback_capabilities") return { mpvBundled: true };
        if (cmd === "fetch_introdb_segments") return intro ? { intro: { start_sec: 100, end_sec: 300 } } : {};
        if (cmd.startsWith("plugin:event|")) return callbackId++;
        return null;
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-playback-preferences", JSON.stringify({ skipSegmentsEnabled: intro, showLoadingOverlay: false }));
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      id: "timeline-fixture", name: "Prueba de reproducción", addonName: "Prueba",
      url: "https://cdn.example/timeline.mkv", behaviorHints: {},
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: "Prueba de reproducción", resumeTime: 120 }));
  }, { intro });
  await page.goto(`${tv ? "/big-picture" : ""}/player?type=${intro ? "series" : "movie"}&id=tt1234567${intro ? "&season=1&ep=3" : ""}`);
  await page.addStyleTag({ content: "html, body { background: #101014 !important; } *, *::before, *::after { visibility: visible !important; }" });
  await expect(page.locator("[data-player-timeline]")).toHaveValue("120", { timeout: 30_000 });
  await page.mouse.move(960, 220);
}

async function gamepad(page: Page, id: string) {
  await page.evaluate(id => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", {
    detail: { id }, cancelable: true,
  })), id);
}

const layer = (page: Page) => page.locator("[data-player-controls-glass]").locator("..");
const timeline = (page: Page) => page.locator("[data-player-timeline]");

async function expectLiveTimeline(page: Page) {
  // Simulate the following real MPV update, not an optimistic UI-only jump.
  await page.evaluate(() => { (window as any).__timelineTest.position = 185; });
  await expect(timeline(page)).toHaveValue("185");
  await expect(page.locator("[data-timeline-current-time]")).toHaveText("3:05");
  await expect(page.locator("[data-timeline-remaining-time]")).toHaveText("-56:55");
}

test("TV: cerrar la barra descarta el preview y LT/RT no congelan el tiempo", async ({ page }) => {
  await setup(page, true);
  await gamepad(page, "open-controls");
  await expect(timeline(page)).toBeFocused();
  await gamepad(page, "dpad-right");
  await expect(timeline(page)).toHaveValue("130");
  // Arriba pasa a botones y arriba de nuevo cierra, sin confirmar el preview.
  await gamepad(page, "dpad-up");
  await expect(page.locator(".bp-bar-actions button:focus")).toBeFocused();
  await gamepad(page, "dpad-up");
  await expect(layer(page)).toHaveCSS("pointer-events", "none");
  await expect(timeline(page)).toHaveValue("120");
  await gamepad(page, "rt");
  await expect(timeline(page)).toHaveValue("150");
  await gamepad(page, "lt");
  await expect(timeline(page)).toHaveValue("120");
  await expectLiveTimeline(page);
  await expect(layer(page)).toHaveCSS("pointer-events", "none");
});

test("PC: perder foco descarta el preview y las flechas ocultas siguen el reloj", async ({ page }) => {
  await setup(page, false);
  await page.keyboard.press("Tab");
  await expect(timeline(page)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(timeline(page)).toHaveValue("0");
  await timeline(page).evaluate(node => (node as HTMLElement).blur());
  await expect(timeline(page)).toHaveValue("120");
  await expect(layer(page)).toHaveCSS("pointer-events", "none");
  await page.keyboard.press("ArrowRight");
  await expect(timeline(page)).toHaveValue("130");
  await page.keyboard.press("ArrowLeft");
  await expect(timeline(page)).toHaveValue("120");
  await expectLiveTimeline(page);
  await expect(layer(page)).toHaveCSS("pointer-events", "none");
});

for (const tv of [false, true]) {
  test(`${tv ? "TV" : "PC"}: Saltar intro conserva 32px de aire al reaparecer la barra`, async ({ page }) => {
    await setup(page, tv, true);
    const skip = page.locator("[data-player-skip]");
    await expect(skip).toBeVisible();
    await expect(layer(page)).toHaveCSS("pointer-events", "none");
    for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
      await page.setViewportSize(size);
      await page.mouse.move(size.width / 2, size.height / 2);
      await expect(layer(page)).toHaveCSS("opacity", "1");
      const gap = await skip.evaluate(button => {
        const actions = document.querySelector(".bp-bar-actions")!;
        return actions.getBoundingClientRect().top - button.getBoundingClientRect().bottom;
      });
      expect(gap).toBeGreaterThanOrEqual(31);
      const screenshot = await page.screenshot({ path: `artifacts/player-timeline/${tv ? "tv" : "pc"}-${size.width}.png` });
      await test.info().attach(`skip-${size.width}`, { body: screenshot, contentType: "image/png" });
      await expect(layer(page)).toHaveCSS("pointer-events", "none");
    }
  });
}
