import { expect, test, type Page } from "@playwright/test";

async function setupSportsPlayer(page: Page, pathname: string) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let nextId = 1;
    let statusTick = 0;
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    w.__sportsPlayerCalls = calls;
    w.__TAURI_INTERNALS__ = {
      transformCallback() { return nextId++; },
      async invoke(cmd: string, args?: Record<string, unknown>) {
        calls.push({ cmd, args });
        if (cmd === "mpv_status") return {
          // Start beyond ten seconds so the rewind remains positive; MPV's
          // command is an absolute target, not the relative -10 offset.
          timePos: 30 + statusTick++,
          duration: 0,
          demuxerCacheDuration: 2.7,
          pause: false,
          fileLoaded: true,
          sid: 2,
          aid: 1,
          speed: 1,
          videoWidth: 1920,
          videoHeight: 1080,
          tracks: [
            { id: 2, kind: "sub", type: "sub", title: "English subtitles", lang: "eng", selected: true },
            { id: 1, type: "audio", title: "English", lang: "eng", selected: true },
          ],
        };
        if (cmd === "playback_capabilities") return { hardwareDecode: true, secondAudio: true };
        if (cmd.startsWith("plugin:event|")) return nextId++;
        return null;
      },
      convertFileSrc: (value: string) => value,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    localStorage.setItem("aetherio-local-mode-v1", "1");
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      name: "Partido de prueba",
      addonName: "Canal Sports",
      url: "https://sports.test/live.m3u8",
      behaviorHints: { live: true, headers: {} },
      subtitles: [{ url: "https://sports.test/subtitles.vtt", lang: "es", title: "Español" }],
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: "Partido de prueba" }));
  });
  await page.goto(pathname);
  // The browser harness does not have the native MPV surface or splash window.
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await expect(page.locator("[data-player-controls-glass]")).toBeVisible({ timeout: 30_000 });
}

for (const [label, pathname] of [
  ["normal", "/player?type=live&id=sports-test"],
  ["Big Picture", "/big-picture/player?type=live&id=sports-test"],
] as const) {
  test(`Sports ${label}: sin selectores, timeline fija al directo y subtítulos apagados`, async ({ page }) => {
    await setupSportsPlayer(page, pathname);

    await expect(page.locator('[data-menu-id="subtitles"]')).toHaveCount(0);
    await expect(page.locator('[data-menu-id="audio"]')).toHaveCount(0);
    await expect(page.locator('[data-menu-id="speed"]')).toHaveCount(0);
    await expect(page.locator("[data-player-go-live]")).toHaveCount(0);

    const progress = page.locator('[data-player-live-progress-fill="pinned"]');
    await expect(progress).toHaveCSS("width", /.+/);
    const initialWidth = await progress.evaluate(node => (node as HTMLElement).style.width);
    expect(initialWidth).toBe("100%");
    await expect(page.locator("[data-player-live-timeline]")).not.toContainText(/\d/);
    await page.waitForTimeout(2200);
    await expect(progress).toHaveJSProperty("style.width", "100%");

    await expect.poll(() => page.evaluate(() => {
      const calls = (window as unknown as { __sportsPlayerCalls: Array<{ cmd: string; args?: { name?: string; value?: unknown } }> }).__sportsPlayerCalls;
      return calls.some(call => call.cmd === "mpv_set_property" && call.args?.name === "sid" && call.args.value === "no");
    })).toBe(true);

    if (label === "normal") {
      // The controls auto-hide after a few seconds; wake them before clicking.
      await page.mouse.move(960, 540);
      const callsBeforeSeek = await page.evaluate(() => (window as unknown as { __sportsPlayerCalls: unknown[] }).__sportsPlayerCalls.length);
      await page.locator('[aria-label="Retroceder 10 segundos"]').click();
      await expect.poll(() => page.evaluate(start => {
        const calls = (window as unknown as { __sportsPlayerCalls: Array<{ cmd: string; args?: { command?: unknown[] } }> }).__sportsPlayerCalls;
        return calls.slice(start).some(call => call.cmd === "mpv_command"
          && call.args?.command?.[0] === "seek"
          && typeof call.args.command[1] === "number"
          && call.args.command[1] > 0
          && call.args.command[2] === "absolute"
          && call.args.command[3] === "exact");
      }, callsBeforeSeek)).toBe(true);
    } else {
      const callsBeforeSeek = await page.evaluate(() => (window as unknown as { __sportsPlayerCalls: unknown[] }).__sportsPlayerCalls.length);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { detail: { id: "dpad-left" } })));
      await expect.poll(() => page.evaluate(start => {
        const calls = (window as unknown as { __sportsPlayerCalls: Array<{ cmd: string; args?: { command?: unknown[] } }> }).__sportsPlayerCalls;
        return calls.slice(start).some(call => call.cmd === "mpv_command"
          && call.args?.command?.[0] === "seek"
          && typeof call.args.command[1] === "number"
          && call.args.command[1] > 0
          && call.args.command[2] === "absolute"
          && call.args.command[3] === "exact");
      }, callsBeforeSeek)).toBe(true);
    }
  });
}
