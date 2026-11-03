import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, player = false, width = 1920, height = 1080, unavailable: string[] = []) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ player, unavailable }) => {
    let nextId = 1;
    let statusTick = 1;
    const now = Date.now();
    const startsAt = new Date(now - 30 * 60_000).toISOString();
    const xmlDate = (time: number) => new Date(time).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
    const m3u = `#EXTM3U x-tvg-url="https://guide.example.com/tv.xml"
#EXTINF:-1 tvg-id="ArenaSport1.rs@HD" tvg-language="English" group-title="Fútbol",Arena Sport 1 English
https://cdn.example.com/arena-en.m3u8
#EXTINF:-1 tvg-id="Football.es" group-title="Fútbol",Fútbol TV
https://cdn.example.com/football.m3u8
#EXTINF:-1 tvg-id="Teledeporte.es" group-title="Fútbol",Teledeporte
https://cdn.example.com/teledeporte.m3u8
#EXTINF:-1 tvg-id="Fight.es" group-title="MMA",MMA TV
https://cdn.example.com/fight.m3u8
#EXTINF:-1 group-title="Noticias",Noticias TV
https://cdn.example.com/news.m3u8`;
    const xml = `<tv><programme channel="Football.es" start="${xmlDate(now - 30 * 60_000)}" stop="${xmlDate(now + 90 * 60_000)}"><title>Real Madrid vs Barcelona</title><category>Fútbol</category><live /></programme></tv>`;
    const bytes = new Uint8Array(564); bytes[0] = bytes[188] = bytes[376] = 0x47;
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    Object.assign(window, {
      __iptvCalls: calls,
      __TAURI_INTERNALS__: {
        transformCallback: () => nextId++,
        invoke: async (cmd: string, args?: Record<string, any>) => {
          calls.push({ cmd, args });
          if (cmd === "provider_http_request") {
            const url = args?.request?.url ?? "";
            if (unavailable.some(fragment => url.includes(fragment))) return { status: 404, url, bodyBase64: "", headers: {} };
            const body = url.includes("list.m3u") ? m3u : url.includes("tv.xml") ? xml
              : url.endsWith("segment.ts") ? String.fromCharCode(...bytes)
                : url.includes("cdn.example.com") ? "#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n#EXTINF:6,\nsegment.ts" : "";
            return { status: body ? 200 : 404, url, bodyBase64: btoa(unescape(encodeURIComponent(body))), headers: {} };
          }
          if (cmd === "mpv_status") return { timePos: statusTick++, duration: 0, pause: false, fileLoaded: true, videoWidth: 1920, videoHeight: 1080, tracks: [] };
          if (cmd === "playback_capabilities") return { mpvBundled: true, backend: "libmpv" };
          if (cmd === "open_mpv") return { backend: "libmpv", resolvedTarget: args?.target };
          if (cmd === "start_nuvio_sports_server") return { ready: true, running: true, port: 7310 };
          if (cmd.startsWith("plugin:event|")) return nextId++;
          return null;
        },
        convertFileSrc: (value: string) => value,
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, plugins: {},
      },
      __TAURI__: { event: { listen: async () => () => undefined } },
    });
    const profileId = "sports-iptv-e2e";
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: profileId, name: "Sports", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", profileId);
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-sports-preferences`, JSON.stringify({ version: 1, onboarding: "completed", sports: ["futbol"], followedCompetitions: [], followedClubs: [], followedNationalTeams: [], followedOrganizations: [], followedFighters: [], legacyTeamNames: [], view: "para-ti", scope: "todos" }));
    localStorage.setItem(`aetherio-profile:${profileId}:aetherio-sports-iptv`, JSON.stringify({ version: 1, lists: [{ id: "mine", name: "Mi lista", url: "https://list.example.com/list.m3u", enabled: true, epgUrls: [] }] }));
    localStorage.setItem("aetherio-live-sports-config", JSON.stringify({ enabledProviders: ["local", "iptv-sports"], refreshSeconds: 60, hideEnded: true, nativeProvidersVersion: 1, iptvProvidersVersion: 1, sportsStreamsProvidersVersion: 1 }));
    const game = { id: "iptv-game", title: "Real Madrid vs Barcelona", sport: "Football", league: "LaLiga", status: "live", startsAt, home: { name: "Real Madrid" }, away: { name: "FC Barcelona" }, sources: [{ id: "addon", label: "Addon Sports", url: "https://addon.example.com/live.m3u8" }] };
    localStorage.setItem("aetherio-live-sports-local-events", JSON.stringify([game]));
    if (player) {
      const streams = [{ id: "iptv", addonId: "iptv-sports", addonName: "IPTV", name: "Fútbol TV", title: "Fútbol TV", url: "https://cdn.example.com/football.m3u8", behaviorHints: { live: true, sourceType: "iptv", liveEventId: game.id } }, { id: "addon", addonId: "live", addonName: "Addon Sports", name: "Addon Sports", url: "https://addon.example.com/live.m3u8", behaviorHints: { live: true } }];
      sessionStorage.setItem("aetherio-selected-stream", JSON.stringify(streams[0]));
      sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({ name: game.title }));
      sessionStorage.setItem("aetherio-available-streams", JSON.stringify({ key: `live:${game.id}::`, streams }));
    }
    const fetcher = window.fetch.bind(window);
    window.fetch = (input, init) => /nuvio|stremverse|7310/.test(String(input)) ? Promise.resolve(new Response(JSON.stringify({ metas: [], sync: { state: "idle" } }))) : fetcher(input, init);
  }, { player, unavailable });
  await page.goto(player ? "/big-picture/player?type=live&id=iptv-game" : "/big-picture/sports");
  await page.addStyleTag({ content: ".startup-app-content { visibility: visible !important; opacity: 1 !important; transform: none !important; pointer-events: auto !important; }" });
}

test("la card permite elegir el addon sin imponer la fuente IPTV", async ({ page }) => {
  await setup(page);
  await expect(page.getByRole("region", { name: "Canales deportivos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Elegir fuentes para Real Madrid vs Barcelona", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Elegir fuente", exact: true });
  await expect(dialog).toContainText("Programación coincide");
  await dialog.getByRole("button", { name: /Addon Sports/ }).click();
  await expect(page).toHaveURL(/player\?type=live&id=iptv-game/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!).id)).toBe("addon");
});

test("Fuentes queda dentro de la primera card móvil sin desplazar horizontalmente la fila", async ({ page }) => {
  await setup(page, false, 390, 844);
  const row = page.locator('[data-row-key*="sports-now"]');
  await expect(row.getByRole("button", { name: "Real Madrid vs Barcelona", exact: true })).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  const sources = row.getByRole("button", { name: "Elegir fuentes para Real Madrid vs Barcelona", exact: true });
  // IntersectionObserver rounds fractional pixels after the shell's scale.
  await expect(sources).toBeInViewport({ ratio: 0.999 });
  await page.screenshot({ path: ".impeccable/review/iptv-card-sources-mobile.png" });
  await sources.click();
  const dialog = page.getByRole("dialog", { name: "Elegir fuente", exact: true });
  await expect(dialog).toContainText("Fútbol TV");
  await expect(dialog).toContainText("Addon Sports");
});

test("los canales identificados en español aparecen antes de los demás", async ({ page }) => {
  await setup(page);
  const channels = page.getByRole("region", { name: "Canales deportivos", exact: true });
  const spanish = channels.getByRole("button", { name: "Fútbol TV", exact: true });
  const english = channels.getByRole("button", { name: "Arena Sport 1 English", exact: true });
  await expect(spanish).toBeVisible();
  await expect(english).toBeVisible();
  expect((await spanish.boundingBox())!.x).toBeLessThan((await english.boundingBox())!.x);
});

test("omite canales caídos y conserva primero los canales españoles que sí responden", async ({ page }) => {
  await setup(page, false, 1920, 1080, ["football.m3u8"]);
  const channels = page.getByRole("region", { name: "Canales deportivos", exact: true });
  await expect(channels.getByRole("button", { name: "Fútbol TV", exact: true })).toHaveCount(0);
  const spanish = channels.getByRole("button", { name: "Teledeporte", exact: true });
  const english = channels.getByRole("button", { name: "Arena Sport 1 English", exact: true });
  await expect(spanish).toBeVisible();
  await expect(english).toBeVisible();
  expect((await spanish.boundingBox())!.x).toBeLessThan((await english.boundingBox())!.x);
});

test("cambiar de deporte cambia la fila y desactivar la lista retira sus fuentes del partido", async ({ page }) => {
  await setup(page);
  const channels = page.getByRole("region", { name: "Canales deportivos", exact: true });
  await expect(channels.getByRole("button", { name: "Fútbol TV", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const moduleUrl = "/src/data/sports/preferences.ts";
    const { patchSportsPreferences } = await import(moduleUrl);
    patchSportsPreferences({ sports: ["mma"] });
  });
  await expect(channels.getByRole("button", { name: "MMA TV", exact: true })).toBeVisible();
  await expect(channels.getByRole("button", { name: "Fútbol TV", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Listas IPTV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Listas IPTV", exact: true });
  await dialog.getByRole("checkbox", { name: "Activar Mi lista", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(channels).toHaveCount(0);
  await page.evaluate(async () => {
    const moduleUrl = "/src/data/sports/preferences.ts";
    const { patchSportsPreferences } = await import(moduleUrl);
    patchSportsPreferences({ sports: ["futbol"] });
  });
  await page.getByRole("button", { name: "Real Madrid vs Barcelona", exact: true }).click();
  await page.getByRole("button", { name: "Fuentes", exact: true }).click();
  const sources = page.getByRole("dialog", { name: "Fuentes", exact: true });
  await expect(sources).toContainText("Addon Sports");
  await expect(sources).not.toContainText("Fútbol TV");
});

test("rechaza una lista privada sin enviar la petición", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Listas IPTV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Listas IPTV", exact: true });
  await dialog.getByLabel("URL de la lista M3U", { exact: true }).fill("http://127.0.0.1/private.m3u");
  await dialog.getByRole("button", { name: "Añadir lista", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("pública");
  expect(await page.evaluate(() => (window as unknown as { __iptvCalls: Array<{ cmd: string; args?: { request?: { url?: string } } }> }).__iptvCalls.some(call => call.args?.request?.url?.includes("/private.m3u")))).toBe(false);
});

test("Sports muestra canales del deporte elegido y une IPTV al partido del addon", async ({ page }) => {
  await setup(page);
  const channels = page.getByRole("region", { name: "Canales deportivos", exact: true });
  await expect(channels.getByRole("button", { name: "Fútbol TV", exact: true })).toBeVisible();
  await expect(channels.getByRole("button", { name: "MMA TV", exact: true })).toHaveCount(0);
  await expect(channels).not.toContainText("Noticias TV");
  await page.locator('[data-row-key*="sports-now"]').getByRole("button", { name: "Real Madrid vs Barcelona", exact: true }).click();
  await expect(page).toHaveURL(/player\?type=live&id=iptv-game/);
  await expect(page.getByRole("button", { name: "Fuentes", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fuentes", exact: true }).click();
  const sources = page.getByRole("dialog", { name: "Fuentes", exact: true });
  await expect(sources).toContainText("IPTV");
  await expect(sources).toContainText("Fútbol TV");
  await expect(sources).toContainText("Addon Sports");
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!));
  expect(saved.behaviorHints.sourceType).toBe("iptv");
});

test("el botón Fuentes junto a mejoras funciona con teclado y cambia entre IPTV y addons", async ({ page }) => {
  await setup(page, true, 1280);
  const button = page.getByRole("button", { name: "Fuentes", exact: true });
  await expect(button).toBeVisible();
  expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(100);
  await button.focus();
  await page.keyboard.press("Enter");
  const sources = page.getByRole("dialog", { name: "Fuentes", exact: true });
  await expect(sources).toBeVisible();
  await sources.locator('[data-source-id="addon"]').click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-stream")!).id)).toBe("addon");
});

test("un canal se abre como canal lineal y la gestión de listas permite importar M3U", async ({ page }) => {
  await setup(page);
  const channels = page.getByRole("region", { name: "Canales deportivos", exact: true });
  await expect(channels).toBeVisible();
  await page.getByRole("button", { name: "Listas IPTV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Listas IPTV", exact: true });
  await expect(dialog).toContainText("Mi lista");
  await dialog.getByLabel("Nombre de la lista").fill("Mis combates");
  await dialog.getByText("Pegar M3U o importar un archivo", { exact: true }).click();
  await dialog.getByLabel("Contenido M3U").fill('#EXTM3U\n#EXTINF:-1 group-title="MMA",Combates\nhttps://cdn.example.com/combat.m3u8');
  await dialog.getByRole("button", { name: "Añadir lista", exact: true }).click();
  await expect(dialog).toContainText("Mis combates");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/big-picture\/sports\/?$/);
  await channels.getByRole("button", { name: "Fútbol TV", exact: true }).click();
  await expect(page).toHaveURL(/player\?type=live&id=iptv-channel/);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("aetherio-selected-media-meta")!).name)).toBe("Fútbol TV");
});

test("revisión visual de canales, selección de fuentes e importación en escritorio y móvil", async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, false, 1440, 900);
  const channels = page.getByRole("region", { name: "Canales deportivos", exact: true });
  await expect(channels.getByRole("button", { name: "Fútbol TV", exact: true })).toBeVisible();
  await channels.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".impeccable/review/iptv-channels-desktop.png" });
  await page.getByRole("button", { name: "Elegir fuentes para Real Madrid vs Barcelona", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Elegir fuente", exact: true })).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/iptv-card-sources-desktop.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Listas IPTV", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Listas IPTV", exact: true });
  await expect(settings).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/iptv-settings-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/iptv-settings-mobile.png" });
  await page.keyboard.press("Escape");
  await channels.scrollIntoViewIfNeeded();
  await page.screenshot({ path: ".impeccable/review/iptv-channels-mobile.png" });
  await setup(page, true, 1910, 1080);
  const toggle = page.getByRole("button", { name: "Fuentes", exact: true });
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.screenshot({ path: ".impeccable/review/iptv-player-user-1910.png" });
  await toggle.click();
  await expect(page.getByRole("dialog", { name: "Fuentes", exact: true }).locator('[data-source-id="addon"]')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: ".impeccable/review/iptv-player-1280.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/iptv-player-mobile.png" });
});
