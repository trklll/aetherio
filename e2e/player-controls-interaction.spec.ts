import { expect, test, type Page } from "@playwright/test";

async function openPlayer(page: Page, position = 120) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("https://**/*", async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.includes("/season/1")) {
      body = { episodes: [1, 2, 3].map(n => ({ episode_number: n, name: `Episodio ${n}`, air_date: "2025-01-01", runtime: 24 })) };
    } else if (url.pathname.includes("/external_ids")) {
      body = { imdb_id: "tt071001" };
    } else if (/\/tv\/71001$/.test(url.pathname)) {
      body = { id: 71001, name: "Serie de prueba", seasons: [{ season_number: 1 }], external_ids: { imdb_id: "tt071001" } };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(({ position }) => {
    const w = window as any;
    let id = 1;
    let tick = 0;
    const state = { position, calls: [] as { cmd: string; args: any }[] };
    w.__controlTest = state;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => id++,
      unregisterCallback: () => {},
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (path: string) => path,
      plugins: {},
      async invoke(cmd: string, args: any) {
        state.calls.push({ cmd, args });
        if (cmd === "mpv_status") return {
          timePos: state.position + tick++ * 0.1, duration: 1000, pause: false,
          fileLoaded: true, videoWidth: 1920, videoHeight: 1080,
          tracks: [
            { id: 1, type: "audio", title: "English", lang: "eng", selected: true },
            { id: 2, type: "sub", title: "Español", lang: "spa", selected: true },
          ],
        };
        if (cmd === "mpv_command" && args?.command?.[0] === "seek") state.position = Number(args.command[1]);
        if (cmd === "playback_capabilities") return { mpvBundled: true };
        if (cmd === "fetch_introdb_segments") return { intro: { start_sec: 100, end_sec: 180 }, outro: { start_sec: 980, end_sec: 1000 } };
        if (cmd.startsWith("plugin:event|")) return id++;
        return null;
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-playback-preferences", JSON.stringify({
      autoPlayNextEpisode: false, skipSegmentsEnabled: true, animeSkipEnabled: false, showLoadingOverlay: false,
    }));
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      id: "controls-fixture", name: "Serie de prueba", addonName: "Prueba", url: "https://cdn.example/test.mkv", behaviorHints: {},
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: "Serie de prueba", resumeTime: position }));
  }, { position });
  await page.goto("/player?type=series&id=tmdb%3A71001&season=1&ep=2");
  await page.addStyleTag({ content: "html, body { background: #101014 !important; }" });
  await expect(page.locator("[data-player-controls-glass]")).toHaveAttribute("data-player-controls-variant", "pc-modern");
  await expect(page.locator("[data-player-timeline]")).toHaveValue(/^[1-9]\d*(?:\.\d+)?$/);
  await page.mouse.move(640, 300);
}

test("PC: cerrar cada menú con ratón restaura el vidrio, sin acumular botones blancos", async ({ page }) => {
  await openPlayer(page);
  const restingBackground = await page.locator("[data-player-playpause]").evaluate(node => getComputedStyle(node).backgroundColor);
  for (const menuId of ["subtitles", "audio", "speed", "video-enhancements"]) {
    const button = page.locator(`[data-menu-id='${menuId}'] > button`);
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.mouse.click(640, 220);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).not.toHaveAttribute("data-bar-active", "true");
    await expect(button).toHaveCSS("background-color", restingBackground, { timeout: 2000 });
  }
  await page.screenshot({ path: "artifacts/player-controls/menus-closed.png" });
});

test("PC: un clic real en Saltar intro llega al botón y envía el salto a MPV", async ({ page }) => {
  await openPlayer(page);
  const skip = page.getByRole("button", { name: "Saltar intro", exact: true });
  await expect(skip).toBeVisible();
  // Inspeccionar el hit-test real evita aprobar una acción tapada por la barra.
  await expect.poll(() => skip.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === node || node.contains(hit);
  })).toBe(true);
  const before = await page.evaluate(() => (window as any).__controlTest.calls.length);
  await skip.click();
  await expect.poll(() => page.evaluate(before => (window as any).__controlTest.calls.slice(before)
    .some((call: any) => call.cmd === "mpv_command" && call.args?.command?.[0] === "seek" && call.args.command[1] === 180.15), before)).toBe(true);
  await expect(skip).toHaveCount(0);
});

test("PC: Siguiente episodio responde al clic real sin depender de la cuenta atrás", async ({ page }) => {
  await openPlayer(page, 990);
  const next = page.locator("[data-post-play-action='play']");
  await expect(next).toBeVisible({ timeout: 30_000 });
  await next.click();
  await expect(page).toHaveURL(/\/detail\/series\//, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window.history.state as any)?.usr?.episodeRequest?.ep)).toBe(3);
});
