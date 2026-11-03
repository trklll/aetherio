import { expect, test, type Page } from "@playwright/test";

/**
 * Pastilla compartida para "Saltar intro / outro" y "Siguiente episodio".
 *
 * El boton real solo existe cuando MPV devuelve un segmento (`fetch_introdb_segments`,
 * comando nativo) y el arnes no puede simularlo. El diseno vive entero en la
 * clase `.bp-skip-button` mas el `style` del componente, asi que aqui se monta
 * un boton con esas mismas clases dentro del MISMO contexto de posicionamiento
 * (dentro del contenedor `absolute inset-x-0 bottom-0` que envuelve el cristal de
 * la barra) y se mide lo que la referencia fija: caja, radio, tinta y alineacion
 * del extremo derecho con la linea de tiempo.
 *
 * Valores de referencia medidos en artifacts/player-skip/ANALYSIS.md.
 */

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
    w.__TAURI_INTERNALS__ = {
      transformCallback() { return nextId++; },
      async invoke(cmd: string) {
        if (cmd === "mpv_status") return { ...STATUS, timePos: STATUS.timePos + 1 + statusTick++ * 0.5 };
        if (cmd === "playback_capabilities") return { hardwareDecode: true, secondAudio: true };
        if (cmd === "fetch_introdb_segments") return { intro: { start_sec: 780, end_sec: 900 } };
        if (cmd.startsWith("plugin:event|")) return nextId++;
        return null;
      },
      convertFileSrc: (p: string) => p,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    localStorage.setItem("aetherio-local-mode-v1", "1");
    localStorage.setItem("aetherio-playback-preferences", JSON.stringify({ skipSegmentsEnabled: true, animeSkipEnabled: false }));
    sessionStorage.setItem("aetherio-selected-stream", JSON.stringify({
      name: "Magia asesina",
      addonName: "Fuente de prueba",
      url: "https://cdn.example/flores.mkv",
      behaviorHints: { headers: {} },
      technicalMetadata: { audioCodec: "eac3", audioChannels: 6, dynamicRange: "Dolby Atmos" },
    }));
    sessionStorage.setItem("aetherio-selected-media-meta", JSON.stringify({
      name: "Magia asesina",
      resumeTime: 806,
    }));
  });
}

const URL_BP = "/big-picture/player?type=movie&id=tmdb%3A4951";

/** Inyecta un boton con las clases reales en el contenedor de la barra. */
async function mountProbeButton(page: Page, label = "Saltar intro") {
  await expect(page.locator("[data-player-controls-glass]")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(text => {
    const glass = document.querySelector("[data-player-controls-glass]");
    const host = glass?.parentElement;
    if (!host) throw new Error("no se encontro el contenedor de la barra");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.playerSkip = "true";
    button.dataset.probe = "true";
    button.className = "bp-skip-button absolute z-40 flex items-center justify-center whitespace-nowrap gsap-transition";
    button.style.right = "clamp(28px, 6.4vw, 132px)";
    button.style.bottom = "clamp(160px, 23vh, 280px)";
    button.textContent = text;
    host.appendChild(button);
  }, label);
  await page.waitForTimeout(250);
}

test("el boton de saltar cumple la referencia", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubPlayback(page);
  await page.goto(URL_BP);
  await page.waitForTimeout(2500);
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.waitForTimeout(700);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await mountProbeButton(page);

  const probe = page.locator("[data-probe='true']");
  await expect(probe).toBeVisible();

  const measured = await probe.evaluate(node => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const glass = document.querySelector("[data-player-controls-glass]")!;
    const timeline = glass.querySelector("input[type='range']") as HTMLInputElement | null;
    const timelineBox = timeline?.getBoundingClientRect() ?? null;
    return {
      width: box.width,
      height: box.height,
      right: window.innerWidth - box.right,
      radius: Number.parseFloat(style.borderTopLeftRadius),
      fontSize: Number.parseFloat(style.fontSize),
      fontWeight: style.fontWeight,
      background: style.backgroundColor,
      color: style.color,
      borderTopWidth: style.borderTopWidth,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      timelineRight: timelineBox ? window.innerWidth - timelineBox.right : null,
    };
  });

  // Proporcion igual a la referencia y compartida por todas las acciones.
  const ratio = measured.width / measured.height;
  expect(ratio).toBeGreaterThan(3.9);
  expect(ratio).toBeLessThan(4.1);

  // El padding conserva aire en las etiquetas cortas y deja espacio al CTA largo.
  expect(measured.paddingLeft / measured.height).toBeGreaterThan(0.2);
  expect(measured.paddingLeft / measured.height).toBeLessThan(0.3);

  // Radio: rectangulo muy redondeado, NO un circulo (seria height/2).
  expect(measured.radius / measured.height).toBeGreaterThan(0.18);
  expect(measured.radius / measured.height).toBeLessThan(0.45);

  // Cuerpo de texto ~0.37 x alto, peso fuerte, tinta negra sobre blanco.
  expect(measured.fontSize / measured.height).toBeGreaterThan(0.3);
  expect(measured.fontSize / measured.height).toBeLessThan(0.55);
  expect(Number(measured.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(measured.background).toBe("rgb(255, 255, 255)");
  expect(measured.color).toBe("rgb(0, 0, 0)");
  expect(measured.borderTopWidth).toBe("0px");

  // Alineacion: el extremo derecho coincide con el de la linea de tiempo.
  if (measured.timelineRight !== null) {
    expect(Math.abs(measured.right - measured.timelineRight)).toBeLessThanOrEqual(2);
  }

  await page.screenshot({ path: "artifacts/player-skip/measure/skip-1920x1080.png" });

  // El foco tiene que leerse: anillo por fuera de la pastilla.
  await probe.evaluate(node => (node as HTMLButtonElement).focus());
  await page.waitForTimeout(150);
  const focused = await probe.evaluate(node => {
    const style = getComputedStyle(node);
    return { shadow: style.boxShadow, transform: style.transform };
  });
  expect(focused.shadow).toContain("rgba(255, 255, 255, 0.6) 0px 0px 0px 3px");
  expect(focused.transform).not.toBe("none");
  await page.screenshot({ path: "artifacts/player-skip/measure/skip-focus.png" });
});

test("las etiquetas comparten forma y caben en viewport estrecho", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubPlayback(page);
  await page.goto(URL_BP);
  await page.waitForTimeout(2500);
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await mountProbeButton(page, "Saltar intro");

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 360, height: 720 }]) {
    await page.setViewportSize(viewport);
    const boxes = await page.locator("[data-probe='true']").evaluate(node => {
      const button = node as HTMLButtonElement;
      const style = getComputedStyle(button);
      const labels = ["Saltar intro", "Saltar outro", "Siguiente episodio"];
      return labels.map(label => {
        button.textContent = label;
        const rect = button.getBoundingClientRect();
        const textRange = document.createRange();
        textRange.selectNodeContents(button);
        const textWidth = textRange.getBoundingClientRect().width;
        return {
          height: rect.height,
          width: rect.width,
          radius: Number.parseFloat(style.borderTopLeftRadius),
          innerWidth: rect.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight),
          textWidth,
          overflows: rect.width > window.innerWidth,
        };
      });
    });
    // Las tres etiquetas comparten exactamente la caja y se mantienen dentro
    // de su area de texto; solo cambia la copia.
    for (const box of boxes) {
      expect(box.height).toBeGreaterThan(50);
      expect(box.height).toBeLessThan(80);
      expect(box.radius / box.height).toBeLessThan(0.45);
      expect(box.textWidth).toBeLessThanOrEqual(box.innerWidth + 1);
      expect(box.overflows).toBe(false);
      expect(box.width).toBeCloseTo(boxes[0].width, 1);
      expect(box.height).toBeCloseTo(boxes[0].height, 1);
    }
  }
});

test("Saltar intro no se solapa con las acciones en rutas normal y TV, ni a 720p", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubPlayback(page);
  await page.route(/\/media\?/, route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("https://arm.haglund.dev/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  const assertClearGap = async () => {
    const geometry = await page.locator("[data-player-skip]").evaluate(button => {
      const skip = button.getBoundingClientRect();
      const actions = document.querySelector(".bp-bar-actions")?.getBoundingClientRect();
      if (!actions) throw new Error("no se encontró la fila de acciones");
      const overlapWidth = Math.max(0, Math.min(skip.right, actions.right) - Math.max(skip.left, actions.left));
      const overlapHeight = Math.max(0, Math.min(skip.bottom, actions.bottom) - Math.max(skip.top, actions.top));
      return { gap: actions.top - skip.bottom, overlaps: overlapWidth > 0 && overlapHeight > 0 };
    });
    expect(geometry.overlaps).toBe(false);
    expect(geometry.gap).toBeGreaterThanOrEqual(12);
  };

  for (const route of ["/big-picture/player", "/player"]) {
    await page.goto(`${route}?type=series&id=tt1234567&season=1&ep=3`);
    await page.waitForTimeout(2500);
    await page.mouse.move(960, 540);
    await expect(page.locator("[data-player-skip]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".bp-title")).toHaveText("Magia asesina");
    await page.waitForTimeout(100);
    await assertClearGap();

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(async () => {
      const geometry = await page.locator("[data-player-skip]").evaluate(button => {
        const skip = button.getBoundingClientRect();
        const actions = document.querySelector(".bp-bar-actions")?.getBoundingClientRect();
        return actions ? actions.top - skip.bottom : -Infinity;
      });
      return geometry;
    }).toBeGreaterThanOrEqual(12);
    await assertClearGap();
    await page.setViewportSize({ width: 1920, height: 1080 });
  }
});
