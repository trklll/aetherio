import { expect, test, type Page } from "@playwright/test";

/**
 * Capturas de la barra de Big Picture con el diseño nuevo (referencia Apple TV).
 *
 * No hace falta MPV: se inyecta un IPC falso de reproducción
 * con pistas de audio reales (rotulo con tecnologia + technicalMetadata del
 * .json de la stream) para poder abrir los menus contextuales.
 */
async function stubPlayback(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let nextId = 1;
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
        { id: 3, type: "audio", title: "Espanol - DTS-HD", lang: "spa" },
        { id: 4, type: "audio", title: "Espanol AD", lang: "spa" },
        { id: 5, type: "audio", title: "Commentary 2.0", lang: "eng" },
      ],
    };
    w.__TAURI_INTERNALS__ = {
      transformCallback() { return nextId++; },
      async invoke(cmd: string, args?: Record<string, unknown>) {
        if (cmd === "mpv_status") return { ...STATUS, timePos: STATUS.timePos + 1 };
        if (cmd === "playback_capabilities") return { hardwareDecode: true, secondAudio: true };
        if (cmd.startsWith("plugin:event|")) return nextId++;
        // El shader de MPV es quien difumina el video: sin el no hay blur que
        // ver. Se guarda la ultima llamada para poder verificarlo.
        if (cmd === "set_mpv_controls_blur") {
          (w.__blurCalls as unknown[]).push(args ?? {});
        }
        return null;
      },
      convertFileSrc: (p: string) => p,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__blurCalls = [];
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

/**
 * El panel de fuentes se ofrecia solo si habia una instantanea en sessionStorage,
 * y esa instantanea no estava atada al medio: se veian las fuentes de otro titulo
 * o no se veia el boton aunque la reproduccion funcionara. Ahora el boton
 * aparece siempre que el medio pueda tener alternativas y la lista se resuelve
 * al abrir; una instantanea de otro medio se descarta.
 */
async function stubForeignStreamsSnapshot(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("aetherio-available-streams", JSON.stringify({
      key: "movie:tmdb:9999::",
      streams: [
        { id: "otro-1", name: "Fuente ajena 1", addonName: "Ajena", url: "https://cdn.example/otro-1.mkv" },
        { id: "otro-2", name: "Fuente ajena 2", addonName: "Ajena", url: "https://cdn.example/otro-2.mkv" },
      ],
    }));
  });
}

const URL_NORMAL = "/player?type=movie&id=tmdb%3A4951";
const URL_BP = "/big-picture/player?type=movie&id=tmdb%3A4951";

test("el panel de fuentes se ofrece sin depender de la instantanea ajena", async ({ page }) => {
  test.setTimeout(90_000);
  await stubForeignStreamsSnapshot(page);
  await stubPlayback(page);
  await page.goto(URL_NORMAL);
  await page.waitForTimeout(2500);
  const size = page.viewportSize();
  if (size) {
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.waitForTimeout(700);
  }
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });

  const fuentes = page.getByRole("button", { name: "Fuentes", exact: true }).first();
  await expect(fuentes).toBeVisible({ timeout: 15_000 });

  // El clic va por JS: sin MPV el overlay de carga queda encima y se quedaria
  // con el clic (force no salta el hit-test).
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")]
      .find(node => node.textContent?.trim() === "Fuentes");
    (button as HTMLButtonElement | undefined)?.click();
  });
  const panel = page.locator("[data-player-side-panel]").first();
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel).not.toContainText("Fuente ajena");
  const stray = await page.locator("text=Fuente ajena").count();
  expect(stray).toBe(0);
});

test("Fuentes se mantiene en modo normal y se oculta en modo TV", async ({ page }) => {
  test.setTimeout(90_000);
  await stubPlayback(page);
  await page.goto(URL_BP);
  await page.waitForTimeout(2500);
  const size = page.viewportSize();
  if (size) await page.mouse.move(size.width / 2, size.height / 2);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });

  await expect(page.locator(".bp-bar-actions").getByRole("button", { name: "Fuentes", exact: true })).toHaveCount(0);
});

test("modo TV abre la fila horizontal de episodios, no el panel lateral", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/tmdb/tv/1/season/1**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      episodes: [
        { episode_number: 1, name: "Primer episodio", air_date: "2026-01-01" },
        { episode_number: 2, name: "Episodio actual", air_date: "2026-01-08" },
      ],
    }),
  }));
  await page.route("**/api/tmdb/tv/1?**", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ episode_run_time: [24], seasons: [{ season_number: 1 }] }),
  }));
  await stubPlayback(page);
  await page.goto("/big-picture/player?type=series&id=tmdb%3A1&season=1&ep=2");
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });

  await expect.poll(() => page.locator("[data-bp-episodes-label]").count()).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("aetherio-gamepad-action", { detail: { id: "y" } }));
  });

  const row = page.locator("[data-bp-episode-row]");
  await expect(row).toHaveAttribute("aria-hidden", "false");
  await expect(row.getByRole("button", { name: /Episodio 2/ })).toBeVisible();
  await expect(page.locator("[data-player-side-panel]")).toHaveCount(0);
});

async function openBar(page: Page) {
  page.on("pageerror", e => console.log("PAGE ERROR", String(e).slice(0, 400)));
  page.on("console", m => {
    if (m.type() === "error") console.log("CONSOLE ERROR", m.text().slice(0, 400));
  });
  await stubPlayback(page);
  await page.goto(URL_BP);
  await page.waitForTimeout(2500);
  const size = page.viewportSize();
  if (size) {
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.waitForTimeout(700);
    await page.mouse.move(size.width / 2, size.height / 2 + 6);
  }
  // Sin la superficie nativa de MPV la raiz se queda en visibility:hidden.
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  // Sin MPV detras, el velo se mediria sobre negro y no se apreciaria el
  // degradado. Se pinta de blanco el primer ancestro opaco de la barra (el mismo
  // bg-black que en Tauri deja ver la superficie nativa) para poder juzgarlo.
  await page.evaluate(() => {
    let node = document.querySelector("[data-player-controls-glass]")?.parentElement ?? null;
    while (node) {
      const background = getComputedStyle(node).backgroundColor;
      const alpha = Number(background.slice(4, background.indexOf(")")).split(",")[3] ?? "1");
      if (background !== "rgba(0, 0, 0, 0)" && alpha > 0.05) {
        node.style.background = "linear-gradient(180deg,#0d2a4d 0%,#1d5c3a 38%,#8fce6d 62%,#f2f7d8 100%)";
        return;
      }
      node = node.parentElement;
    }
  });
  await page.waitForTimeout(400);
}

test("barra de Big Picture: capturas del diseño nuevo", async ({ page }) => {
  test.setTimeout(90_000);
  await openBar(page);

  const bar = page.locator("[data-player-controls-glass]");
  // Margen alto: el test anterior abre el panel de fuentes, que dispara la
  // resolucion de streams y deja la pagina siguiente arrancando mas lento.
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/bp-controls/measure/bar-bp.png" });

  // Big Picture no difumina la barra completa: solo recorta blur GPU alrededor
  // de cada control. El fondo de la barra conserva la sombra (blurAlpha 0).
  const blur = await page.evaluate(() => {
    const calls = (window as unknown as { __blurCalls?: Record<string, unknown>[] }).__blurCalls ?? [];
    return calls.map(call => ({
      blurAlpha: Number(call.blurAlpha ?? 0),
      controlAlpha: Number(call.controlAlpha ?? 0),
      controlSurfaces: Array.isArray(call.controlSurfaces) ? call.controlSurfaces.length : 0,
    }));
  });
  expect(blur.length).toBeGreaterThan(0);
  expect(Math.max(...blur.map(call => call.blurAlpha))).toBeLessThanOrEqual(0.01);
  expect(blur.some(call => call.controlAlpha > 0.01 && call.controlSurfaces > 0)).toBe(true);

  // Sin backdrop-filter, sin bordes y sin inset: cualquier recorte o linea de
  // 1px devuelve el corte recto. La sombra es un degradado que vive en el pseudo
  // (sube por encima de la caja); si se quedara dentro, en la franja del titulo
  // no se veria nada.
  const surface = await bar.evaluate(node => {
    const style = getComputedStyle(node);
    const veil = node.querySelector<HTMLElement>(".bp-player-shadow");
    const veilStyle = veil ? getComputedStyle(veil) : null;
    return {
      backdropFilter: style.backdropFilter,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      backgroundImage: style.backgroundImage,
      veilImage: veilStyle?.backgroundImage ?? "none",
      veilTop: veilStyle?.top ?? "0px",
      veilHeight: veilStyle?.height ?? "0px",
      veilPointerEvents: veilStyle?.pointerEvents ?? "auto",
    };
  });
  expect(surface.backdropFilter).toBe("none");
  expect(surface.borderTopWidth).toBe("0px");
  expect(surface.boxShadow).toBe("none");
  expect(surface.backgroundImage).toBe("none");
  expect(surface.veilImage).toContain("linear-gradient");
  expect(surface.veilImage).toMatch(/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)\s*100%/);
  expect(surface.veilPointerEvents).toBe("none");
  // La sombra tiene que ser mas alta que la propia barra: si el pseudo se
  // limitara a la caja, el titulo se quedaria sin apoyo.
  const barBox = await bar.evaluate(node => node.getBoundingClientRect().height);
  const veilHeight = Number.parseFloat(surface.veilHeight);
  expect(veilHeight).toBeGreaterThan(barBox * 1.5);
  expect(Number.parseFloat(surface.veilTop)).toBeLessThan(0);

  // Menu de audio: insignia de tecnologia en la cabecera de la seccion.
  // El clic va por JS: sin MPV el overlay de carga queda encima y se quedaria
  // con el clic (force no salta el hit-test).
  await page.evaluate(() => {
    (document.querySelector('[data-menu-id="audio"] button') as HTMLButtonElement | null)?.click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/bp-controls/measure/bar-audio-menu.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Menu de subtitulos: "Sincronizar" arriba y luego las pistas.
  await page.evaluate(() => {
    (document.querySelector('[data-menu-id="subtitles"] button') as HTMLButtonElement | null)?.click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: "artifacts/bp-controls/measure/bar-subs-menu.png" });
});
test("material y separacion de los controles de la barra", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubPlayback(page);
  await page.goto(URL_BP);
  await page.waitForTimeout(2500);
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.waitForTimeout(700);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
  await page.waitForTimeout(300);

  const row = page.locator(".bp-bar-actions");
  await expect(row).toBeVisible();

  // Party fuera de la barra.
  await expect(page.locator('[data-menu-id="party"]')).toHaveCount(0);

  const buttons = row.locator("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(3);
  await expect(row.getByRole("button", { name: "Fuentes", exact: true })).toHaveCount(0);

  // Separacion: la unidad del `gap` de flex son los hijos ([data-player-menu]),
  // no los botones que hay dentro. Se mide en los dos sitios para que un cambio
  // en el envoltorio no vuelva a esconder el ajuste.
  const spacing = await row.evaluate(node => {
    const style = getComputedStyle(node);
    const children = [...node.children].map(child => child.getBoundingClientRect());
    const buttons = [...node.querySelectorAll("button")].map(child => child.getBoundingClientRect());
    const gaps = (boxes: DOMRect[]) => boxes.slice(1).map((box, i) => box.x - (boxes[i].x + boxes[i].width));
    return {
      gap: Number.parseFloat(style.gap),
      childGaps: gaps(children),
      buttonGaps: gaps(buttons),
    };
  });
  expect(spacing.gap).toBeGreaterThanOrEqual(6);
  expect(spacing.gap).toBeLessThanOrEqual(12);
  for (const gap of [...spacing.childGaps, ...spacing.buttonGaps]) {
    expect(gap).toBeGreaterThanOrEqual(6);
  }

  // Superficie translucida con el filtro del navegador como fallback; en MPV
  // el blur de verdad se verifica en las máscaras GPU de los controles.
  const material = await buttons.first().evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopWidth, filter: style.backdropFilter };
  });
  expect(material.filter).not.toBe("none");
  expect(material.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(material.border)).toBeGreaterThan(0);

  await page.locator("[data-player-controls-glass]").screenshot({
    path: "artifacts/bp-controls/measure/bar-actions.png",
  });

  // Menu de filtros con la misma piel que audio/subtitulos.
  await page.evaluate(() => {
    (document.querySelector('[data-menu-id="video-enhancements"] button') as HTMLButtonElement | null)?.click();
  });
  await page.waitForTimeout(700);
  const menu = page.locator("[data-context-variant='apple']").last();
  await expect(menu).toBeVisible();
  const menuStyle = await menu.evaluate(node => {
    const style = getComputedStyle(node);
    return { filter: style.backdropFilter, radius: style.borderTopLeftRadius, font: style.fontSize };
  });
  // Sin backdrop-filter: el desenfoque lo hace el shader de MPV sobre este rect.
  expect(menuStyle.filter).toBe("none");
  expect(Number.parseFloat(menuStyle.radius)).toBeGreaterThanOrEqual(20);
  await page.screenshot({ path: "artifacts/bp-controls/measure/bar-enhancements-menu.png" });
});

test("el menu de subtitulos entra en la geometria del blur", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await stubPlayback(page);
  await page.goto(URL_BP);
  await page.waitForTimeout(2500);
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.waitForTimeout(700);
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });

  // Audio y velocidad ya recibian el desenfoque del shader; el de subtitulos se
  // quedaba fuera porque se excluia con `openMenu === "subtitles"`, que tambien
  // es cierto con la simple lista de pistas abierta.
  for (const menu of ["audio", "speed", "subtitles"]) {
    if (menu !== "audio") {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => {
      ((window as unknown as { __blurCalls?: unknown[] }).__blurCalls ??= []).length = 0;
    });
    await page.evaluate(id => {
      (document.querySelector(`[data-menu-id="${id}"] button`) as HTMLButtonElement | null)?.click();
    }, menu);
    // Sondeo: el commit del blur va con temporizador + rAF y el menu se abre por
    // portal, asi que una sola lectura puede pillarla a mitad.
    await expect.poll(async () => page.evaluate(() => {
      const open = document.querySelectorAll("[data-player-floating-panel-glass]").length;
      if (!open) return 0;
      const calls = (window as unknown as { __blurCalls?: Record<string, unknown>[] }).__blurCalls ?? [];
      return calls.some(call => call.enabled === true
        && call.subtitlePanelEnabled === true
        && Number(call.subtitleBlurAlpha ?? 0) > 0.01
        && Number(call.subtitlePanelRight ?? 0) - Number(call.subtitlePanelLeft ?? 0) > 100)
        ? 1
        : -1;
    }), { timeout: 15_000, message: `menu ${menu}: el panel deberia entrar en la geometria del blur` })
      .toBe(1);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    (document.querySelector('[data-menu-id="subtitles"] button') as HTMLButtonElement | null)?.click();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "artifacts/bp-controls/measure/bar-subs-menu.png" });
});
