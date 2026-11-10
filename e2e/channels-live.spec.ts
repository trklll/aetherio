import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

test.setTimeout(60_000);
const mediaDir = path.resolve("test-results/channels-live-media");

test.beforeAll(() => {
  mkdirSync(mediaDir, { recursive: true });
  const converted = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", "public/assets/streaming-platforms/apple-tv-plus-intro.mp4", "-t", "4", "-an", "-vf", "scale=480:-2", "-c:v", "libx264", "-preset", "ultrafast", "-g", "24", "-hls_time", "1", "-hls_list_size", "0", "-hls_segment_filename", path.join(mediaDir, "segment-%d.ts"), path.join(mediaDir, "preview.m3u8")]);
  if (converted.status !== 0) throw new Error(`Could not prepare existing-video HLS fixture: ${converted.stderr}`);
});

async function openChannels(page: Page, tv = false, fixture = true) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = async () => undefined;
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-local-profiles-v1", JSON.stringify([{ id: "channels-live-test", name: "Usuario", createdAt: 1, updatedAt: 1 }]));
    localStorage.setItem("aetherio-active-profile-id", "channels-live-test");
  });
  if (fixture) {
    const fixtureNow = Date.now();
    await page.route(/https:\/\/(?:live\.iptv-free\.com|live\.hacks\.tools|raw\.githubusercontent\.com\/u-din)\//, route => route.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: [
      '#EXTM3U url-tvg="https://guide.example/guide.xml"',
      '#EXTINF:-1 tvg-id="test.es" tvg-language="Spanish" group-title="Deportes",Canal de prueba A', "https://stream.example/preview.m3u8",
      '#EXTINF:-1 tvg-id="other.es" tvg-language="Spanish" group-title="Cine",Canal de prueba B', "https://stream.example/failure.m3u8",
    ].join("\n") }));
    await page.route(/https:\/\/(?:epgshare01\.online|i\.mjh\.nz|guide\.example)\//, route => {
      const xmlDate = (offset: number) => new Date(fixtureNow + offset).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
      return route.fulfill({ contentType: "application/xml", headers: { "Access-Control-Allow-Origin": "*" }, body: `<tv><channel id="test.es"><display-name>Canal de prueba A</display-name></channel><programme channel="test.es" start="${xmlDate(-30 * 60_000)}" stop="${xmlDate(30 * 60_000)}"><title>Programa de prueba actual</title><desc>Programación de una fuente XMLTV controlada para la prueba.</desc></programme><programme channel="test.es" start="${xmlDate(30 * 60_000)}" stop="${xmlDate(90 * 60_000)}"><title>Programa de prueba siguiente</title></programme></tv>` });
    });
    await page.route("https://stream.example/**", route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      if (file === "failure.m3u8") return route.fulfill({ status: 503, body: "offline" });
      return route.fulfill({ contentType: file.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl", headers: { "Access-Control-Allow-Origin": "*" }, body: readFileSync(path.join(mediaDir, file)) });
    });
    await page.route(/https:\/\/(?:30a-tv\.com|[^/]*\.rtve\.es)\//, route => route.abort());
  }
  await page.goto(tv ? "/big-picture/channels" : "/channels");
  // Startup's animation is independent of this route and does not settle in
  // headless Chromium; do not turn a hidden startup frame into visual evidence.
  await page.addStyleTag({ content: ".startup-app-content{visibility:visible!important;opacity:1!important;transform:none!important;pointer-events:auto!important}.startup-experience{display:none!important}" });
  await page.locator(".startup-app-content").evaluate(element => element.removeAttribute("aria-hidden"));
  await expect(page.getByRole("heading", { name: "Canales", exact: true })).toBeVisible();
}

test("PC uses real sources, XMLTV and a decoding HLS preview, not the demo", async ({ page }) => {
  await openChannels(page);
  await expect(page.getByText("Programación de ejemplo")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Buscar canal" }).fill("Canal de prueba");
  await expect(page.locator("[data-live-row]")).toHaveCount(2);
  await page.getByRole("button", { name: "Seleccionar Canal de prueba A" }).click();
  await expect(page.getByRole("heading", { name: "Programa de prueba actual", exact: true })).toBeVisible();
  await expect(page.locator(".live-preview")).toHaveAttribute("data-preview-state", "playing");
  expect(await page.locator(".live-preview video").evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Activar sonido de la vista previa" })).toBeVisible();
  await page.getByRole("button", { name: "Activar sonido de la vista previa" }).click();
  expect(await page.locator(".live-preview video").evaluate((video: HTMLVideoElement) => video.muted)).toBe(false);
  await page.getByRole("button", { name: /Canal de prueba A, Programa de prueba siguiente,/ }).click();
  await expect(page.getByRole("heading", { name: "Programa de prueba siguiente", exact: true })).toBeVisible();
  await expect(page.getByText("Más tarde · La vista previa sigue en directo")).toBeVisible();
  await expect(page.locator(".live-preview")).toHaveAttribute("data-preview-state", "playing");
});

test("empty filters recover and failed previews retain a real playback action", async ({ page }) => {
  await openChannels(page);
  const search = page.getByRole("searchbox", { name: "Buscar canal" });
  await search.fill("Canal de prueba B");
  await page.getByRole("button", { name: "Seleccionar Canal de prueba B" }).click();
  await expect(page.locator(".live-preview")).toHaveAttribute("data-preview-state", "error");
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver canal", exact: true })).toBeEnabled();
  await search.fill("no existe ese canal");
  await expect(page.getByRole("heading", { name: "No encontramos ese canal" })).toBeVisible();
  await page.getByRole("button", { name: "Restablecer filtros" }).click();
  await expect(page.locator("[data-live-row]")).toHaveCount(48);
  await expect(page.getByRole("button", { name: "Ver horario anterior" })).toBeDisabled();
  await page.getByRole("button", { name: "Ver horario siguiente" }).click();
  await expect(page.getByRole("button", { name: "Ver horario anterior" })).toBeEnabled();
  await page.getByRole("button", { name: "Ahora", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ver horario anterior" })).toBeDisabled();
});

test("TV focuses real channels, follows the guide without moving preview, and opens controller search", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openChannels(page, true);
  const first = page.locator("[data-live-row] button").first();
  await first.focus();
  const before = await page.locator(".live-preview").boundingBox();
  for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowDown");
  expect(await page.locator(".live-guide__scroll").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".live-preview").boundingBox()).toEqual(before);
  await page.getByRole("button", { name: "Buscar canal", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Buscar canal" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Buscar canal" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Buscar canal", exact: true })).toBeFocused();
});

if (process.env.CHANNELS_LIVE_CAPTURE === "1") {
  test("batched visual evidence from actual included channels, without fabricated EPG", async ({ page }) => {
    mkdirSync(".impeccable/review/channels-live", { recursive: true });
    for (const [name, width, height, tv] of [["desktop", 1440, 1000, false], ["mobile", 390, 844, false], ["user-1056", 1056, 886, false], ["tv-720p", 1280, 720, true], ["tv-1080p", 1920, 1080, true], ["tv-2160p", 3840, 2160, true]] as const) {
      if (await page.evaluate(() => !!document.fullscreenElement)) await page.evaluate(() => document.exitFullscreen());
      await page.setViewportSize({ width, height });
      await openChannels(page, tv, false);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".live-preview")).toHaveAttribute("data-preview-state", /playing|error|paused/, { timeout: 30_000 });
      await page.screenshot({ path: `.impeccable/review/channels-live/${name}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (tv) {
        const bounds = await page.locator(".live-guide__scroll").boundingBox();
        expect(bounds?.height).toBeGreaterThan(80);
        expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(height);
      }
    }
  });
}
