import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60_000);

interface StartupCall {
  command: string;
  args?: { name?: string; value?: unknown; command?: unknown[]; visible?: boolean };
}

interface StartupFixture {
  calls: StartupCall[];
  opens: number;
  surfaceVisible: boolean;
  position: number;
  paused: boolean;
  finishOpen: () => void;
  load: (position: number) => void;
}

async function setup(page: Page, route: string, resumeTime = 0, previousPosition = 1440) {
  await page.route("https://**/*", route => route.fulfill({
    contentType: "application/json", body: "{}",
  }));
  await page.addInitScript(({ resumeTime, previousPosition }) => {
    let callbackId = 1;
    let loaded = previousPosition > 0;
    let opened = false;
    let resolveOpen: ((value: unknown) => void) | undefined;
    // stop_mpv can leave the previous core's cached position behind. It is not
    // progress for the title being opened, even when the snapshot says loaded.
    const fixture = {
      calls: [] as StartupCall[],
      opens: 0,
      surfaceVisible: false,
      position: previousPosition,
      paused: true,
      finishOpen() {
        opened = true;
        loaded = false;
        fixture.position = 0;
        fixture.paused = true;
        fixture.surfaceVisible = false;
        resolveOpen?.({ backend: "libmpv", embedded: true });
      },
      load(position: number) {
        loaded = true;
        fixture.position = position;
      },
    };
    Object.assign(window, {
      __startupTest: fixture,
      __TAURI_INTERNALS__: {
        transformCallback: () => callbackId++,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        plugins: {},
        async invoke(command: string, args?: StartupCall["args"]) {
          fixture.calls.push({ command, args });
          if (command === "open_mpv") {
            fixture.opens += 1;
            return new Promise(resolve => { resolveOpen = resolve; });
          }
          if (command === "mpv_status") {
            if (opened && loaded && !fixture.paused) fixture.position += 0.3;
            return {
              timePos: fixture.position, duration: 1800, pause: fixture.paused,
              fileLoaded: loaded, tracks: [], speed: 1,
              videoWidth: loaded ? 1920 : null, videoHeight: loaded ? 1080 : null,
            };
          }
          if (command === "mpv_set_property" && args?.name === "pause" && opened) {
            fixture.paused = Boolean(args.value);
          }
          if (command === "mpv_command" && args?.command?.[0] === "seek") {
            fixture.position = Number(args.command[1]);
          }
          if (command === "set_mpv_surface_visible") fixture.surfaceVisible = Boolean(args?.visible);
          if (command === "playback_capabilities") return { mpvBundled: true, backend: "libmpv" };
          if (command.startsWith("plugin:event|")) return callbackId++;
          return null;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    });
    localStorage.setItem("aetherio-local-mode-v1", "1");
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      id: "startup-fixture", addonName: "Prueba", name: "Medio nuevo",
      url: "https://cdn.example/startup.mkv", behaviorHints: {},
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: "Medio nuevo", resumeTime }));
  }, { resumeTime, previousPosition });
  await page.goto(`${route}?type=movie&id=tmdb%3A71003`);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __startupTest: StartupFixture }).__startupTest.opens)).toBe(1);
}

async function finishOpen(page: Page, position: number) {
  await page.evaluate(() => (window as unknown as { __startupTest: StartupFixture }).__startupTest.finishOpen());
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __startupTest: StartupFixture }).__startupTest.calls.some(call =>
      call.command === "mpv_set_property" && call.args?.name === "pause"))).toBe(true);
  await page.evaluate(position => (window as unknown as { __startupTest: StartupFixture }).__startupTest.load(position), position);
}

async function savedProgress(page: Page) {
  return page.evaluate(() => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
    .filter(key => key.endsWith("aetherio-continue-watching-v1"))
    .flatMap(key => JSON.parse(localStorage.getItem(key) ?? "[]") as { id: string; currentTime: number }[])
    .filter(entry => entry.id === "tmdb:71003"));
}

for (const [mode, route] of [["normal", "/player"], ["TV", "/big-picture/player"]]) {
  test(`${mode}: no guarda ni muestra el 80% de la sesión anterior durante la apertura`, async ({ page }) => {
    await setup(page, route);
    await page.clock.install();
    await page.clock.runFor(900);
    expect(await savedProgress(page)).toEqual([]);
    expect(await page.evaluate(() =>
      (window as unknown as { __startupTest: StartupFixture }).__startupTest.surfaceVisible)).toBe(false);

    await finishOpen(page, 0);
    await page.clock.runFor(900);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __startupTest: StartupFixture }).__startupTest.surfaceVisible)).toBe(true);
    const seeks = await page.evaluate(() =>
      (window as unknown as { __startupTest: StartupFixture }).__startupTest.calls
        .filter(call => call.command === "mpv_command" && call.args?.command?.[0] === "seek"));
    expect(seeks).toEqual([]);
  });

  test(`${mode}: una posición inicial positiva en pausa no bloquea el primer arranque`, async ({ page }) => {
    await setup(page, route, 0, 0);
    await finishOpen(page, 1 / 12);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __startupTest: StartupFixture }).__startupTest.paused)).toBe(false);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __startupTest: StartupFixture }).__startupTest.surfaceVisible)).toBe(true);
    expect((await savedProgress(page)).every(entry => entry.currentTime < 12)).toBe(true);
  });

  test(`${mode}: conserva una reanudación válida sin confundirla con el primer fotograma`, async ({ page }) => {
    await setup(page, route, 360, 0);
    await finishOpen(page, 1 / 12);
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __startupTest: StartupFixture }).__startupTest.surfaceVisible)).toBe(true);
    const state = await page.evaluate(() => {
      const fixture = (window as unknown as { __startupTest: StartupFixture }).__startupTest;
      return { paused: fixture.paused, position: fixture.position,
        seeks: fixture.calls.filter(call => call.command === "mpv_command" && call.args?.command?.[0] === "seek") };
    });
    expect(state.paused).toBe(false);
    expect(state.position).toBeGreaterThanOrEqual(360);
    expect(state.position).toBeLessThan(380);
    expect(state.seeks.length).toBeGreaterThan(0);
    expect(state.seeks.every(call => call.args?.command?.[1] === 360)).toBe(true);
  });
}
