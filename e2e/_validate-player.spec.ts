import { expect, test, type Page } from "@playwright/test";

async function stubPlayback(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let nextId = 1;
    let statusTick = 0;
    const STATUS = {
      timePos: 806,
      duration: 3646,
      pause: false,
      fileLoaded: true,
      sid: 2,
      aid: 1,
      speed: 1,
      videoWidth: 1920,
      videoHeight: 1080,
      tracks: [
        { id: 2, kind: "sub", type: "sub", title: "Engles", lang: "eng", selected: true },
        { id: 1, type: "audio", title: "English - Dolby Atmos 5.1", lang: "eng" },
      ],
    };
    w.__calls = [];
    w.__TAURI_INTERNALS__ = {
      transformCallback() { return nextId++; },
      async invoke(cmd: string, args?: Record<string, unknown>) {
        (w.__calls as unknown[]).push({ cmd, args });
        if (cmd === "mpv_status") return { ...STATUS, timePos: STATUS.timePos + 1 + statusTick++ * 0.5 };
        if (cmd === "playback_capabilities") return { hardwareDecode: true, secondAudio: true };
        if (cmd === "tmdb_text_cache_get" && String(args?.key).startsWith("/tv/999999")) {
          const data = String(args?.key).includes("/season/1")
            ? { episodes: [1, 2, 3].map(episode_number => ({ episode_number, name: `Episodio ${episode_number}`, runtime: 24 })) }
            : { name: "Serie de prueba", seasons: [{ season_number: 1 }], images: { logos: [] } };
          return { data, expiresAt: Date.now() + 3600000 };
        }
        if (cmd.startsWith("plugin:event|")) return nextId++;
        return null;
      },
      convertFileSrc: (p: string) => p,
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
      technicalMetadata: { audioCodec: "eac3", audioChannels: 6, dynamicRange: "Dolby Atmos" },
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({
      name: "10 razones para odiarte",
      resumeTime: 806,
    }));
  });
}

const URL_PC = "/player?type=movie&id=tmdb%3A4951";

type Call = { cmd: string; args?: { name?: string; value?: unknown; command?: unknown[] } };

async function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => (window as unknown as { __calls: Call[] }).__calls);
}

async function openBar(page: Page, url = URL_PC) {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubPlayback(page);
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.mouse.move(960, 540);
  await page.waitForTimeout(700);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await expect(page.locator("[data-player-controls-glass]")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const controlsLayer = (page: Page) =>
  page.locator("[data-player-controls-glass]").locator("xpath=..");

test("flechas directas sin barra visible y sin abrirla", async ({ page }) => {
  await openBar(page);
  const root = page.locator("[data-player-direct-input]");
  await expect(root).toHaveAttribute("data-player-direct-input", "true");

  await page.mouse.move(960, 220);
  await page.waitForTimeout(3800);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(600);
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "none");

  const before = (await calls(page)).length;
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);

  const after = (await calls(page)).slice(before);
  const seek = after.find(call => call.cmd === "mpv_command" && call.args?.command?.[0] === "seek");
  expect(seek?.args?.command).toEqual(["seek", 10, "relative"]);
  const volume = after.filter(call => call.cmd === "mpv_set_property" && call.args?.name === "volume").at(-1);
  expect(volume?.args?.value).toBe(91);
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "none");
});

test("Tab revela y enfoca; el foco mantiene la barra al salir con raton", async ({ page }) => {
  await openBar(page);
  await page.mouse.move(960, 220);
  await page.waitForTimeout(3800);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(600);
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "none");

  await page.keyboard.press("Tab");
  await page.waitForTimeout(1500);
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "auto");
  const focusedInBar = await page.evaluate(() =>
    Boolean(document.activeElement?.closest("[data-player-controls-glass]")));
  expect(focusedInBar).toBe(true);

  await page.mouse.move(20, 20);
  await page.waitForTimeout(900);
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "auto");

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(3800);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(600);
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "none");

  const volume = page.locator("[data-player-volume]");
  await expect(volume).toHaveAttribute("tabindex", "-1");
});

test("Space en boton enfocado activa una sola vez; menus cierran el bypass", async ({ page }) => {
  await openBar(page);
  await page.mouse.move(960, 540);
  await page.waitForTimeout(300);

  const play = page.locator("[data-player-playpause]");
  await expect(play).toBeVisible();
  await play.focus();
  await play.evaluate(node => {
    (node as HTMLElement & { __clicks?: number }).__clicks = 0;
    node.addEventListener("click", () => {
      const withCount = node as HTMLElement & { __clicks?: number };
      withCount.__clicks = (withCount.__clicks ?? 0) + 1;
    });
  });
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const clicks = await play.evaluate(node => (node as HTMLElement & { __clicks?: number }).__clicks ?? 0);
  expect(clicks).toBe(1);

  const pauseCalls = (await calls(page))
    .filter(call => call.cmd === "mpv_set_property" && call.args?.name === "pause");
  expect(pauseCalls.at(-1)?.args?.value).toBe(true);

  await page.evaluate(() => {
    (document.querySelector('[data-menu-id="subtitles"] button') as HTMLButtonElement | null)?.click();
  });
  await page.waitForTimeout(500);
  const root = page.locator("[data-player-direct-input]");
  await expect(root).toHaveAttribute("data-player-direct-input", "false");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await expect(root).toHaveAttribute("data-player-direct-input", "true");
});

test("la pantalla de pausa sustituye la barra aunque conserve el foco", async ({ page }) => {
  await openBar(page);
  const play = page.locator("[data-player-playpause]");
  await play.focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await calls(page))
    .filter(call => call.cmd === "mpv_set_property" && call.args?.name === "pause").at(-1)?.args?.value)
    .toBe(true);

  const pauseScreen = page.locator("[data-player-pause-screen]");
  await expect(pauseScreen).toBeVisible({ timeout: 10_000 });
  await expect(controlsLayer(page)).toHaveCSS("pointer-events", "none");
});

type Rect = { left: number; top: number; right: number; bottom: number; cornerRadius: number };
type Blur = { enabled: boolean; controlAlpha: number; blurAlpha: number; subtitlePanelEnabled: boolean; subtitleBlurAlpha: number; controlSurfaces: Rect[] };
const lastBlur = (page: Page) => page.evaluate(() => {
  const history = (window as unknown as { __calls: { cmd: string; args: Blur }[] }).__calls;
  return history.filter(call => call.cmd === "set_mpv_controls_blur").at(-1)?.args;
});

test("el reproductor PC usa vidrio por control y volumen sin borde de selección", async ({ page }) => {
  await openBar(page, "/player?type=series&id=tmdb%3A999999&season=1&ep=2");
  await expect(page.locator("[data-player-controls-glass]")).toHaveAttribute("data-player-controls-variant", "pc-modern");
  await expect(page.locator("[data-bp-episodes-label]")).toBeVisible();
  const volume = page.locator("[data-player-volume]");
  await volume.hover();
  await expect.poll(async () => (await lastBlur(page))?.controlAlpha).toBeGreaterThan(0.99);

  const expectedSurfaces = await page.locator("[data-player-control-glass]").evaluateAll(elements =>
    elements.filter(element => !element.parentElement?.closest("[data-player-control-glass]")).map(element => {
      const rect = element.getBoundingClientRect();
      const scale = devicePixelRatio || 1;
      return { left: Math.round(rect.left * scale), top: Math.round(rect.top * scale), right: Math.round(rect.right * scale), bottom: Math.round(rect.bottom * scale) };
    }));
  const blur = (await lastBlur(page))!;
  expect(blur.enabled).toBe(true);
  expect(blur.blurAlpha).toBe(0);
  expect(blur.controlSurfaces).toHaveLength(expectedSurfaces.length);
  for (const expected of expectedSurfaces) {
    expect(blur.controlSurfaces.some(surface => Object.entries(expected).every(([key, value]) => Math.abs(surface[key as keyof Rect] - value) <= 2))).toBe(true);
  }
  expect(blur.controlSurfaces.some(rect => rect.right - rect.left > 100 && rect.cornerRadius >= 20)).toBe(true);

  await volume.click({ position: { x: 100, y: 10 } });
  await expect(volume).toBeFocused();
  await expect(volume).toHaveCSS("appearance", "none");
  await expect(volume).toHaveCSS("outline-style", "none");
  await expect(volume).toHaveCSS("box-shadow", "none");
  await test.info().attach("volumen-enfocado", { body: await volume.locator("..").screenshot(), contentType: "image/png" });
  await expect.poll(async () => (await calls(page)).filter(call => call.cmd === "mpv_set_property" && call.args?.name === "volume").at(-1)?.args?.value).toBeGreaterThan(100);

  const play = page.locator("[data-player-playpause]");
  const background = await play.evaluate(element => getComputedStyle(element).backgroundColor);
  const volumeBackground = await volume.locator("..").evaluate(element => getComputedStyle(element).backgroundColor);
  await page.locator('[data-menu-id="speed"] > button').click();
  await expect(page.locator('[data-menu-id="speed"] > button')).toHaveCSS("color", "rgb(11, 11, 13)");
  const menu = page.locator("[data-player-floating-panel-glass]");
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS("background-color", background);
  expect(volumeBackground).toBe(background);
  await expect.poll(async () => (await lastBlur(page))?.subtitleBlurAlpha).toBeGreaterThan(0.99);
  expect((await lastBlur(page))?.controlAlpha).toBeGreaterThan(0.99);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("el reproductor TV conserva sus controles clásicos", async ({ page }) => {
  await openBar(page, "/big-picture/player?type=series&id=tmdb%3A999999&season=1&ep=2");
  await expect(page.locator("[data-player-controls-glass]")).toHaveAttribute("data-player-controls-variant", "tv-legacy");
  await expect(page.locator("[data-bp-episodes-label]")).toHaveJSProperty("tagName", "SPAN");
  await expect(page.locator(".bp-bar-transport")).toHaveCount(0);
  await expect(page.locator("[data-player-playpause]")).toHaveCount(0);
  expect((await lastBlur(page))?.controlAlpha).toBe(0);
  expect((await lastBlur(page))?.controlSurfaces).toEqual([]);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { detail: { id: "y" } })));
  await expect(page.locator("[data-player-episode-panel-glass]")).toBeVisible();

  await page.locator('[data-menu-id="speed"] > button').click();
  await expect(page.locator("[data-player-floating-panel-glass]")).toBeVisible();
  await expect.poll(async () => (await lastBlur(page))?.subtitleBlurAlpha).toBeGreaterThan(0.99);
});
