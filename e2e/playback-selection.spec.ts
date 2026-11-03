import { expect, test, type Page } from "@playwright/test";

const SERIES = "tmdb%3A999999";

async function installPlaybackFixture(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let nextId = 1;
    let statusTick = 0;
    const params = new URLSearchParams(location.search);
    const episode = params.get("ep") ?? "1";
    const source = params.get("mockSource") ?? "1";
    const spanishId = episode === "2" ? 41 : source === "2" ? 17 : 3;
    const englishId = episode === "2" ? 40 : source === "2" ? 16 : 2;
    const STATUS = {
      timePos: 40,
      duration: 1800,
      pause: false,
      fileLoaded: true,
      sid: 9,
      aid: englishId,
      speed: 1,
      videoWidth: 1920,
      videoHeight: 1080,
      tracks: [
        { id: 9, kind: "sub", type: "sub", title: "English", lang: "eng", selected: true },
        { id: spanishId, type: "audio", title: "Español Latino", lang: "spa" },
        { id: englishId, type: "audio", title: "English", lang: "eng", selected: true },
      ],
    };
    w.__calls = [];
    w.__TAURI_INTERNALS__ = {
      transformCallback() { return nextId++; },
      async invoke(cmd: string, args?: Record<string, unknown>) {
        (w.__calls as unknown[]).push({ cmd, args });
        if (cmd === "mpv_status") return { ...STATUS, timePos: STATUS.timePos + statusTick++ * 0.25 };
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
    localStorage.setItem("aetherio-playback-preferences", JSON.stringify({
      firstAudioLanguage: "eng",
      secondAudioLanguage: "",
      preferredSubtitleLanguage: "eng",
    }));
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      id: `fixture-${source}-${episode}`,
      name: "Serie de prueba",
      addonName: "Fuente de prueba",
      url: `https://cdn.example/serie-${source}-${episode}.mkv`,
      behaviorHints: { headers: {} },
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({
      name: "Serie de prueba",
      resumeTime: 0,
    }));
  });
}

async function openEpisode(page: Page, episode: number, source = 1) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/player?type=series&id=${SERIES}&season=1&ep=${episode}&mockSource=${source}`);
  await page.waitForTimeout(2500);
  await page.mouse.move(960, 540);
  await page.waitForTimeout(700);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await expect(page.locator("[data-player-controls-glass]")).toBeVisible({ timeout: 30_000 });
}

async function calls(page: Page) {
  return page.evaluate(() => (window as unknown as { __calls: Array<{ cmd: string; args?: Record<string, unknown> }> }).__calls);
}

test("recuerda audio por semántica entre fuentes y episodios, y conserva subtítulos apagados", async ({ page }) => {
  test.setTimeout(90_000);
  await installPlaybackFixture(page);
  await openEpisode(page, 1);

  await page.getByRole("button", { name: "Audio" }).click();
  await page.getByRole("menuitem", { name: /Español Latino/i }).click();
  await expect.poll(async () => (await calls(page)).some(call =>
    call.cmd === "mpv_set_property" && call.args?.name === "aid" && call.args?.value === 3)).toBe(true);

  await page.getByRole("button", { name: "Subtítulos" }).click();
  await page.getByRole("menuitem", { name: "Apagado" }).click();

  const saved = await page.evaluate(() => ({
    entries: Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)];
    })),
  }));
  const selectionKey = Object.keys(saved.entries).find(key => key.endsWith("aetherio-title-playback-selections-v1"));
  const preferencesKey = Object.keys(saved.entries).find(key => key.endsWith("aetherio-playback-preferences"));
  const raw = selectionKey ? saved.entries[selectionKey] : null;
  expect(raw, JSON.stringify(saved.entries)).toBeTruthy();
  expect(raw).not.toContain("track:3");
  expect(raw).not.toContain("https://cdn.example");
  const preferences = JSON.parse(preferencesKey ? saved.entries[preferencesKey]! : "{}");
  expect(preferences.firstAudioLanguage).toBe("eng");
  const store = JSON.parse(raw!);
  expect(Object.values(store.episodes)[0]).toMatchObject({
    audio: { language: "spa", title: "espanol latino" },
    subtitle: { subtitleMode: "off" },
  });

  await openEpisode(page, 1, 2);
  await expect.poll(async () => (await calls(page)).some(call =>
    call.cmd === "mpv_set_property" && call.args?.name === "aid" && call.args?.value === 17)).toBe(true);
  await expect.poll(async () => (await calls(page)).some(call =>
    call.cmd === "mpv_set_property" && call.args?.name === "sid" && call.args?.value === "no")).toBe(true);
  expect((await calls(page)).some(call => call.cmd === "mpv_command"
    && Array.isArray(call.args?.command)
    && call.args?.command[0] === "sub-add")).toBe(false);

  await openEpisode(page, 2, 1);
  await expect.poll(async () => (await calls(page)).some(call =>
    call.cmd === "mpv_set_property" && call.args?.name === "aid" && call.args?.value === 41)).toBe(true);
  await expect.poll(async () => (await calls(page)).some(call =>
    call.cmd === "mpv_set_property" && call.args?.name === "sid" && call.args?.value === "no")).toBe(true);
});

test("recuperación automática aparece apagada en ajustes de escritorio", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aetherio-local-mode-v1", "1"));
  await page.goto("/settings?tab=playback");
  const toggle = page.getByRole("switch", { name: "Probar otra fuente automáticamente" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => page.evaluate(() => {
    const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .find(candidate => candidate.endsWith("aetherio-playback-preferences"));
    const prefs = JSON.parse(key ? localStorage.getItem(key) ?? "{}" : "{}");
    return prefs.automaticSourceRecovery;
  })).toBe(true);

  await page.goto("/big-picture/settings?tab=playback");
  const bigPictureToggle = page.getByRole("switch", { name: "Probar otra fuente automáticamente" });
  await expect(bigPictureToggle).toBeVisible();
  await expect(bigPictureToggle).toHaveAttribute("aria-checked", "true");
  await bigPictureToggle.click();
  await expect(bigPictureToggle).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => page.evaluate(() => {
    const key = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
      .find(candidate => candidate.endsWith("aetherio-playback-preferences"));
    const prefs = JSON.parse(key ? localStorage.getItem(key) ?? "{}" : "{}");
    return prefs.automaticSourceRecovery;
  })).toBe(false);
});
