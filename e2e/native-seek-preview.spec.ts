import { expect, test, type Page } from "@playwright/test";

const START_SECONDS = 136;
const DURATION_SECONDS = 5_856;

async function stubPlayback(page: Page) {
  await page.addInitScript(({ startSeconds, durationSeconds }) => {
    const w = window as unknown as Record<string, unknown>;
    const previewRequests: number[] = [];
    const playbackCommands: unknown[][] = [];
    const previewTestState = { previewRequests, playbackCommands };
    let nextId = 1;
    let statusTick = 0;
    const status = {
      timePos: startSeconds,
      duration: durationSeconds,
      pause: false,
      fileLoaded: true,
      demuxerCacheDuration: 600,
      sid: 2,
      aid: 1,
      speed: 1,
      videoWidth: 1920,
      videoHeight: 1080,
      fileSizeBytes: 1_200_000_000,
      tracks: [{ id: 2, kind: "sub", type: "sub", title: "Español", language: "spa", lang: "spa", selected: true }],
    };

    w.__AETHERIO_PREVIEW_TEST__ = previewTestState;
    w.__TAURI_INTERNALS__ = {
      transformCallback() {
        return nextId++;
      },
      async invoke(command: string, args?: Record<string, unknown>) {
        if (command === "mpv_status") return { ...status, timePos: startSeconds + 1 + statusTick++ * 0.5 };
        if (command === "playback_capabilities") return { hardwareDecode: true, secondAudio: true };
        if (command === "seek_preview_frame") {
          const timeSeconds = Number(args?.timeSeconds) || 0;
          previewRequests.push(timeSeconds);
          return { dataUrl: "unused" };
        }
        if (command === "mpv_command") {
          if (Array.isArray(args?.command)) playbackCommands.push(args.command as unknown[]);
          return null;
        }
        if (command === "mpv_set_property") return null;
        if (command.startsWith("plugin:event|")) return nextId++;
        return null;
      },
      convertFileSrc: (path: string) => path,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    localStorage.setItem("aetherio-local-mode-v1", "1");
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      name: "10 razones para odiarte",
      addonName: "Fuente de prueba",
      url: "https://cdn.example/10-things.mkv",
      behaviorHints: { headers: {} },
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({
      name: "10 razones para odiarte",
      resumeTime: startSeconds,
    }));
  }, { startSeconds: START_SECONDS, durationSeconds: DURATION_SECONDS });
}

const MODES = [
  { name: "normal", url: "/player?type=movie&id=tmdb%3A4951" },
  { name: "big-picture", url: "/big-picture/player?type=movie&id=tmdb%3A4951" },
];

for (const mode of MODES) {
  test(`scrub sin miniaturas y seek confirmado (${mode.name})`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await stubPlayback(page);
    await page.goto(mode.url, { waitUntil: "domcontentloaded" });
    const controls = page.locator("[data-player-controls-glass]");
    await expect(controls).toBeVisible({ timeout: 30_000 });
    const viewport = page.viewportSize();
    if (viewport) {
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
    }
    await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
    await expect(controls).toBeVisible({ timeout: 30_000 });

    const timeline = page.locator("[data-player-timeline]");
    await expect(timeline).toBeVisible({ timeout: 15_000 });
    const timelineBuffer = await timeline.evaluate(element => {
      const style = (element as HTMLElement).style;
      return {
        progress: Number.parseFloat(style.getPropertyValue("--player-progress")),
        buffered: Number.parseFloat(style.getPropertyValue("--player-buffered")),
      };
    });
    expect(timelineBuffer.buffered).toBeGreaterThan(timelineBuffer.progress);
    const box = await timeline.boundingBox();
    if (!box) throw new Error("el timeline no tiene caja");

    const initialValue = await timeline.evaluate(element => Number((element as HTMLInputElement).value));
    const hoverX = box.x + box.width * 0.52;
    await page.mouse.move(hoverX, box.y + box.height / 2);
    const preview = page.locator("[data-native-seek-preview]");
    await expect(preview).toHaveCount(0);
    const valueAfterHover = await timeline.evaluate(element => Number((element as HTMLInputElement).value));
    expect(Math.abs(valueAfterHover - initialValue)).toBeLessThanOrEqual(2);
    await page.waitForTimeout(1_600);
    const previewRequestsBeforeScrub = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { previewRequests: number[] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.previewRequests.length ?? 0;
    });
    expect(previewRequestsBeforeScrub).toBe(0);

    const seekCountBeforeScrub = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    });
    await page.mouse.down();
    const targetX = box.x + box.width * 0.72;
    await page.mouse.move(targetX, box.y + box.height / 2, { steps: 4 });
    await expect(preview).toHaveCount(0);
    await expect.poll(() => timeline.evaluate(element => Number((element as HTMLInputElement).value)))
      .toBeGreaterThan(DURATION_SECONDS * 0.65);
    const seeksBeforeConfirm = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    });
    expect(seeksBeforeConfirm).toBe(seekCountBeforeScrub);

    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    })).toBeGreaterThan(seekCountBeforeScrub);
    await expect(preview).toHaveCount(0);
    const previewRequestsAfterScrub = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { previewRequests: number[] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.previewRequests.length ?? 0;
    });
    expect(previewRequestsAfterScrub).toBe(0);

    const seekCountBeforeKeyboard = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    });
    await timeline.focus();
    await page.keyboard.press("ArrowRight");
    await expect(preview).toHaveCount(0);
    const seeksBeforeEscape = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    });
    expect(seeksBeforeEscape).toBe(seekCountBeforeKeyboard);
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    const seeksAfterEscape = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    });
    expect(seeksAfterEscape).toBe(seekCountBeforeKeyboard);

    await page.keyboard.press("ArrowLeft");
    await expect(preview).toHaveCount(0);
    const seeksBeforeEnter = await page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    });
    expect(seeksBeforeEnter).toBe(seekCountBeforeKeyboard);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => {
      const state = (window as unknown as { __AETHERIO_PREVIEW_TEST__?: { playbackCommands: unknown[][] } }).__AETHERIO_PREVIEW_TEST__;
      return state?.playbackCommands.filter(command => command[0] === "seek").length ?? 0;
    })).toBeGreaterThan(seeksBeforeEnter);
    await expect(preview).toHaveCount(0);
  });
}
