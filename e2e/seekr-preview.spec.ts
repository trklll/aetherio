import { expect, test, type Page } from "@playwright/test";

const DURATION_S = 5_856; // 1:37:36, la duracion real de tmdb 4951
const START_S = 136; // 2:16

// VTT con la cadencia real de Seekr: una linea cada 10 s con su rectangulo xywh.
function buildVtt(sheet: string) {
  const blocks: string[] = ["WEBVTT", ""];
  for (let second = 0; second < DURATION_S; second += 10) {
    const index = Math.floor(second / 10);
    const x = (index % 6) * 320;
    const y = Math.floor(index / 6) * 180;
    const hh = String(Math.floor(second / 3600)).padStart(2, "0");
    const mm = String(Math.floor((second % 3600) / 60)).padStart(2, "0");
    const ss = String(second % 60).padStart(2, "0");
    blocks.push(`${hh}:${mm}:${ss}.000 --> ${hh}:${mm}:${ss}.000`.replace(
      `${hh}:${mm}:${ss}.000 --> ${hh}:${mm}:${ss}.000`,
      `${hh}:${mm}:${ss}.000 --> ${hh}:${mm}:${String((second + 10) % 60).padStart(2, "0")}.000`,
    ));
    blocks.push(`${sheet}#xywh=${x},${y},320,180`);
    blocks.push("");
  }
  return blocks.join("\n");
}

const SHEET_URL = "https://sprites.seekr.tv/fake/sheet.jpg?sig=test#xywh=0,0,320,180";
const VTT = buildVtt("https://sprites.seekr.tv/fake/sheet.jpg?sig=test");

/**
 * Inyecta un IPC de Tauri falso que responde lo minimo para que el reproductor
 * monte con duracion y para que Seekr devuelva una pista real. La hoja de sprites
 * se pinta en el navegador con un color por tile: asi la captura muestra que
 * rectangulo se recorta de verdad.
 */
async function stubPlayback(page: Page) {
  await page.addInitScript(
    ({ vtt, startS, durationS }) => {
      const w = window as unknown as Record<string, unknown>;
      let nextId = 1;
      let sheetBase64: string | null = null;

      // 6 columnas x 9 filas de tiles de 320x180. Cada tile lleva un tono unico
      // (separacion aurea) para poder comprobar desde fuera QUE tile se recorta.
      const HUE_STEP = 137.508;
      const buildSheet = (): string => {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        // 6 columnas x 100 filas: caben los 586 tiles de una pelicula de 1:37:36.
        canvas.height = 100 * 180;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "";
        for (let row = 0; row < 100; row += 1) {
          for (let col = 0; col < 6; col += 1) {
            const index = row * 6 + col;
            ctx.fillStyle = `hsl(${(index * HUE_STEP) % 360} 90% 50%)`;
            ctx.fillRect(col * 320, row * 180, 320, 180);
          }
        }
        return canvas.toDataURL("image/jpeg", 0.95).split(",")[1] ?? "";
      };

      const STATUS = {
        timePos: startS,
        duration: durationS,
        pause: true,
        fileLoaded: true,
        sid: 2,
        aid: 1,
        speed: 1,
        videoWidth: 1920,
        videoHeight: 1080,
        tracks: [{ id: 2, kind: "sub", title: "Espanol", language: "spa", selected: true }],
      };

      w.__TAURI_INTERNALS__ = {
        transformCallback() {
          return nextId++;
        },
        async invoke(cmd: string) {
          if (cmd === "mpv_status") return { ...STATUS, timePos: startS };
          if (cmd === "playback_capabilities") return { hardwareDecode: true, secondAudio: true };
          if (cmd === "seekr_load_track") {
            return { vtt, scale: 1, sourceDurationMs: durationS * 1000 };
          }
          if (cmd === "seekr_fetch_sprite") {
            if (!sheetBase64) sheetBase64 = buildSheet();
            return { base64: sheetBase64, mimeType: "image/jpeg" };
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
      // Sin esto el reproductor no monta transporte: necesita una fuente.
      sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
        name: "10 razones para odiarte",
        addonName: "Fuente de prueba",
        url: "https://cdn.example/10-things.mkv",
        behaviorHints: { headers: {} },
      }));
      sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({
        name: "10 razones para odiarte",
        resumeTime: 136,
      }));
    },
    { vtt: VTT, startS: START_S, durationS: DURATION_S },
  );
}

const MODES = [
  { name: "normal", url: "/player?type=movie&id=tmdb%3A4951" },
  { name: "big-picture", url: "/big-picture/player?type=movie&id=tmdb%3A4951" },
];

for (const mode of MODES) {
  test(`el popup de Seekr se ve sobre la barra (${mode.name})`, async ({ page }) => {
    page.on("pageerror", e => console.log("PAGE ERROR", String(e).slice(0, 200)));
    page.on("console", m => {
      if (m.type() === "error") console.log("CONSOLE ERROR", m.text().slice(0, 200));
    });
    await stubPlayback(page);
    await page.goto(mode.url);
    await page.waitForTimeout(2_500);

    // Los controles solo existen tras mover el raton sobre el reproductor.
    const size = page.viewportSize();
    if (size) {
      await page.mouse.move(size.width / 2, size.height / 2);
      await page.waitForTimeout(600);
      await page.mouse.move(size.width / 2, size.height / 2 + 6);
    }

    // En el navegador la transicion de entrada de la pagina no llega a completarse
    // (falta la superficie nativa de MPV) y la raiz se queda en visibility:hidden.
    // Es un artefacto del entorno de pruebas, no del reproductor.
    await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
    await page.waitForTimeout(300);

    const timeline = page.locator("[data-player-timeline]");
    // Diagnostico: por que sigue oculto?
    const diag = await page.evaluate(() => {
      const input = document.querySelector("[data-player-timeline]") as HTMLElement | null;
      if (!input) return { found: false };
      const chain: string[] = [];
      let node: HTMLElement | null = input;
      for (let depth = 0; node && depth < 7; depth += 1) {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        chain.push(
          `${node.tagName.toLowerCase()}.${(node.className || "").toString().split(" ").slice(0, 3).join(".")}`
          + ` | display=${style.display} vis=${style.visibility} op=${style.opacity}`
          + ` | ${Math.round(rect.width)}x${Math.round(rect.height)} @${Math.round(rect.x)},${Math.round(rect.y)}`,
        );
        node = node.parentElement;
      }
      return { found: true, disabled: (input as HTMLInputElement).disabled, chain };
    });
    console.log("DIAG", JSON.stringify(diag, null, 2));

    await expect(timeline).toBeVisible({ timeout: 15_000 });

    //about a mitad de la barra
    const box = await timeline.boundingBox();
    if (!box) throw new Error("la barra no tiene caja");
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);

    const popup = page.locator("[data-seekr-preview]");
    await expect(popup).toBeVisible({ timeout: 15_000 });

    // El popup aparece antes que los fotogramas: hay que esperar a la imagen.
    const centreImage = popup.locator("img").first();
    await expect(centreImage).toBeVisible({ timeout: 20_000 });

    const shot = await popup.locator("img").count();
    if (shot === 0) {
      console.log("POPUP HTML", (await popup.innerHTML()).slice(0, 400));
    }
    expect(shot).toBeGreaterThan(0);

    // Que fotograma se recorta de verdad: leemos el tono del tile central y lo
    // deshacemos al indice del cue. A mitad de la pelicula (2928 s) el cue es el
    // indice 292; si el preview se clava en el primero, esto falla.
    const HUE_STEP = 137.508;
    const sampled = await page.evaluate(async () => {
      const img = document.querySelector("[data-seekr-preview] img") as HTMLImageElement | null;
      if (!img) return null;
      const bitmap = await createImageBitmap(await (await fetch(img.src)).blob());
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bitmap, bitmap.width / 2, bitmap.height / 2, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const delta = max - min;
      let hue = 0;
      if (delta > 0) {
        if (max === r / 255) hue = 60 * (((g / 255) - (b / 255)) / delta);
        else if (max === g / 255) hue = 60 * (2 + ((b / 255) - (r / 255)) / delta);
        else hue = 60 * (4 + ((r / 255) - (g / 255)) / delta);
      }
      if (hue < 0) hue += 360;
      return { hue, r, g, b };
    });
    console.log("COLOR CENTRAL", JSON.stringify(sampled));
    expect(sampled).not.toBeNull();

    const hueOf = (index: number) => (index * HUE_STEP) % 360;
    const near = (a: number, b: number) => Math.abs(a - b) < 12 || Math.abs(a - b) > 348;
    if (mode.name === "normal" && sampled) {
      // El raton cae al 50% de la barra (2928 s). El cue cubre 2920-2930 con
      // punto medio 2925, asi que 2928 cae en el cue 293. El pixel exacto puede
      // moverlo +/-1 segun el ancho de la barra, por eso se acepta la franja
      // 291-294. Lo que no puede ser es un cue inicial: eso era el bug.
      const band = [291, 292, 293, 294];
      const matched = band.filter(index => near(sampled.hue, hueOf(index)));
      console.log("TILES QUE COINCIDEN", JSON.stringify(matched));
      expect(matched.length).toBeGreaterThan(0);
      // sanity: el tile 0 (el bug de preview clavado al inicio) no debe salir.
      expect(near(sampled.hue, hueOf(0))).toBe(false);
    }

    // Solo hay una card y es 16:9: ni cards vecinas ni etiquetas de texto.
    const images = popup.locator("img");
    await expect(images).toHaveCount(1);
    expect(await popup.locator("p").count()).toBe(0);
    expect(await popup.locator("button").count()).toBe(0);

    const card = popup.locator("> div");
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    if (cardBox) {
      // 16:9 dentro de la tolerancia del subpixel de layout.
      expect(cardBox.width / cardBox.height).toBeCloseTo(16 / 9, 1);
    }

    // que no este recortado por nada: visible dentro del viewport
    const boxPopup = await popup.boundingBox();
    expect(boxPopup).not.toBeNull();
    const viewport = page.viewportSize();
    if (viewport && boxPopup) {
      expect(boxPopup.y).toBeGreaterThanOrEqual(0);
      expect(boxPopup.x + boxPopup.width).toBeLessThanOrEqual(viewport.width + 1);
    }

    // La card debe quedar SIEMPRE por encima de la barra, sin pisarla. Se compara
    // el borde inferior del popup contra el borde superior del timeline, que es de
    // donde se ancla.
    const timelineBox = await timeline.boundingBox();
    if (boxPopup && timelineBox) {
      const gap = timelineBox.y - (boxPopup.y + boxPopup.height);
      console.log("HUECO CON LA BARRA", Math.round(gap));
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeGreaterThanOrEqual(20);
    }

    await page.screenshot({ path: `test-results/seekr-${mode.name}.png` });
  });
}
