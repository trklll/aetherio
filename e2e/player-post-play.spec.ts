import { expect, test, type Page } from "@playwright/test";

function localDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

async function setup(page: Page, {
  movie = false,
  autoPlay = true,
  nextEpisodeAirDateOffset = -1,
  waitForPostPlay = true,
} = {}) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route("https://**/*", async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.includes("/api/tmdb/")) {
      if (url.pathname.includes("/season/1")) body = {
        episodes: [1, 2, 3].map(n => ({
          episode_number: n,
          name: `Episodio ${n}`,
          air_date: localDateOffset(n === 3 ? nextEpisodeAirDateOffset : -2),
          runtime: 24,
        })),
      };
      else if (/\/tv\/71001\/external_ids$/.test(url.pathname)) body = { imdb_id: "tt071001" };
      else if (/\/(tv|movie)\/71001$/.test(url.pathname)) body = {
        id: 71001, name: "Serie de prueba", title: "Película de prueba", seasons: [{ season_number: 1 }],
        external_ids: { imdb_id: "tt071001" },
        recommendations: { results: [{ id: 71002, title: "Otra película", poster_path: "/poster.jpg", vote_average: 8 }] },
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(({ autoPlay }) => {
    const w = window as any;
    let id = 1;
    let tick = 0;
    const state = { position: 990, paused: false, buffering: false, calls: [] as { cmd: string; args: any }[] };
    w.__postPlayTest = state;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => id++,
      unregisterCallback: () => {},
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      convertFileSrc: (p: string) => p,
      async invoke(cmd: string, args: any) {
        state.calls.push({ cmd, args });
        if (cmd === "mpv_status") return {
          timePos: state.position + (state.paused ? 0 : tick++ * 0.1), duration: 1000,
          pause: state.paused, fileLoaded: true, pausedForCache: state.buffering,
          videoWidth: 1920, videoHeight: 1080, tracks: [],
        };
        if (cmd === "playback_capabilities") return { mpvBundled: true };
        if (cmd === "fetch_introdb_segments") return { outro: { start_sec: 980, end_sec: 1000 } };
        if (cmd.startsWith("plugin:event|")) return id++;
        return null;
      },
      plugins: {},
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    localStorage.setItem("aetherio-local-mode-v1", "1");
    // Profile-scoped settings are resolved by the app; this fixture also seeds
    // the unscoped fallback for its first-run local profile.
    localStorage.setItem("aetherio-playback-preferences", JSON.stringify({ autoPlayNextEpisode: autoPlay, skipSegmentsEnabled: true }));
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      id: "post-play-fixture", name: "Prueba", url: "https://cdn.example/movie.mkv", addonName: "Prueba", behaviorHints: {},
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: "Prueba", resumeTime: 990 }));
  }, { autoPlay });
  const playerUrl = movie
    ? "/big-picture/player?type=movie&id=tmdb%3A71001"
    : "/big-picture/player?type=series&id=tmdb%3A71001&season=1&ep=2";
  await page.goto(playerUrl);
  const continueLocally = page.locator(".auth-local");
  if (await continueLocally.isVisible().catch(() => false)) {
    await continueLocally.click();
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 10_000 });
    await page.goto(playerUrl);
  }
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  if (movie) {
    await expect(page.locator("[data-upnext-panel]")).toBeVisible({ timeout: 30_000 });
  } else if (waitForPostPlay) {
    await expect(page.locator("[data-player-post-play]")).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.locator("[data-player-skip]")).toBeVisible({ timeout: 30_000 });
  }
}

async function gamepad(page: Page, id: string) {
  await page.evaluate(id => window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { detail: { id }, cancelable: true })), id);
}

async function expectEpisodeSelection(page: Page, episode: number) {
  await expect(page).toHaveURL(/\/big-picture\/detail\/series\//, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window.history.state as any)?.usr?.episodeRequest?.ep)).toBe(episode);
}

test("99% presenta el aviso, no corta; derecha y A cancelan sin activar outro", async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  const prompt = page.locator("[data-player-post-play]");
  await expect(page).toHaveURL(/\/player\?/);
  await expect(page.locator("[data-player-skip]")).toHaveCount(0);
  await prompt.locator("[data-post-play-action='play']").focus();
  await gamepad(page, "dpad-right");
  await expect(prompt.getByRole("button", { name: "Cancelar y seguir viendo" })).toBeFocused();
  await page.screenshot({ path: "artifacts/player-next-prompt/tv-cancel-focus.png" });
  await gamepad(page, "confirm");
  await expect(prompt).toHaveCount(0);
  await expect(page.locator("[data-player-skip]")).toHaveCount(0);
  await page.waitForTimeout(13_000);
  await expect(page).toHaveURL(/\/player\?/);
});

test("el botón Play abre el siguiente episodio", async ({ page }) => {
  await setup(page);
  const play = page.locator("[data-post-play-action='play']");
  await expect(play.locator("svg")).toHaveCount(1);
  await expect.poll(() => play.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(153, 153, 155)");
  const progress = play.locator(".player-next-prompt__progress");
  await expect.poll(() => progress.evaluate(node => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
  await expect.poll(() => progress.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(0);
  const initialProgressWidth = await progress.evaluate(node => node.getBoundingClientRect().width);
  await page.waitForTimeout(250);
  await expect.poll(() => progress.evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(initialProgressWidth);
  const size = await play.evaluate(node => {
    const button = node as HTMLButtonElement;
    const content = button.querySelector(".player-next-prompt__content")!.getBoundingClientRect();
    const style = getComputedStyle(button);
    const scale = button.getBoundingClientRect().width / button.offsetWidth;
    return {
      width: button.getBoundingClientRect().width,
      contentWidth: content.width,
      horizontalPadding: (Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)) * scale,
    };
  });
  expect(size.width).toBeLessThanOrEqual(size.contentWidth + size.horizontalPadding + 2);
  await play.click();
  await expectEpisodeSelection(page, 3);
});

test("si el siguiente episodio se estrena otro día, conserva Saltar outro y no muestra Up Next", async ({ page }) => {
  await setup(page, { nextEpisodeAirDateOffset: 1, waitForPostPlay: false });
  await expect(page.locator("[data-player-post-play]")).toHaveCount(0);
  await expect(page.locator("[data-upnext-panel]")).toHaveCount(0);
  await expect(page.locator("[data-player-skip]")).toHaveText("Saltar outro");
});

test("el CTA conserva la pastilla y el cancelar en viewport estrecho", async ({ page }) => {
  await setup(page, { autoPlay: false });
  await page.setViewportSize({ width: 360, height: 720 });
  const play = page.locator("[data-post-play-action='play']");
  const cancel = page.locator("[data-post-play-action='cancel']");
  await expect(play).toBeVisible();
  await expect(cancel).toBeVisible();

  const layout = await play.evaluate(node => {
    const button = node as HTMLButtonElement;
    const cancelButton = button.parentElement?.querySelector<HTMLButtonElement>("[data-post-play-action='cancel']");
    const buttonRect = button.getBoundingClientRect();
    const cancelRect = cancelButton?.getBoundingClientRect();
    const scale = buttonRect.width / button.offsetWidth;
    const textRange = document.createRange();
    textRange.selectNodeContents(button.querySelector(".player-next-prompt__content")!);
    const style = getComputedStyle(button);
    return {
      width: buttonRect.width,
      height: button.offsetHeight,
      innerWidth: (button.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)) * scale,
      textWidth: textRange.getBoundingClientRect().width,
      horizontalPadding: (Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)) * scale,
      buttonRight: buttonRect.right,
      cancelLeft: cancelRect?.left ?? -Infinity,
      cancelRight: cancelRect?.right ?? Infinity,
    };
  });

  expect(layout.width).toBeLessThanOrEqual(layout.textWidth + layout.horizontalPadding + 2);
  expect(layout.textWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
  expect(layout.cancelLeft - layout.buttonRight).toBeGreaterThanOrEqual(15);
  expect(layout.cancelRight).toBeLessThanOrEqual(360);
  const timeLabels = await page.evaluate(() => {
    const current = document.querySelector("[data-timeline-current-time]")?.getBoundingClientRect();
    const remaining = document.querySelector("[data-timeline-remaining-time]")?.getBoundingClientRect();
    return { currentRight: current?.right ?? Infinity, remainingLeft: remaining?.left ?? -Infinity };
  });
  expect(timeLabels.currentRight + 4).toBeLessThanOrEqual(timeLabels.remainingLeft);
});

test("cuenta atrás da tiempo a cancelar y solo entonces navega al siguiente", async ({ page }) => {
  await setup(page);
  await page.screenshot({ path: "artifacts/player-next-prompt/tv-countdown.png" });
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/player\?/);
  await expectEpisodeSelection(page, 3);
});

test("teclado mueve el foco del aviso y permite cancelarlo", async ({ page }) => {
  await setup(page, { autoPlay: false });
  await page.locator("[data-post-play-action='play']").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: "Cancelar y seguir viendo" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-player-post-play]")).toHaveCount(0);
});

test("película abre directamente la pantalla de recomendación al alcanzar el umbral", async ({ page }) => {
  await setup(page, { movie: true });
  await expect(page.locator("[data-player-post-play]")).toHaveCount(0);
  await expect(page.locator("[data-upnext-panel]")).toBeVisible();
  await expect(page).toHaveURL(/\/player\?/);
  const play = page.locator("[data-upnext-action='play']");
  const details = page.locator("[data-upnext-action='details']");
  await expect(play).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(details).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/big-picture\/detail\/movie\/tmdb%3A71002/);
});
