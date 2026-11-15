import { expect, test, type Page } from "@playwright/test";

/**
 * Pantalla de pausa de Aetherio (PlayerPauseScreen).
 *
 * Por que un harness y no /player: el arranque del Player en e2e esta roto en
 * este arbol -- tanto /player como /big-picture/player rebotan al picker de
 * fuentes porque la stream de la sesion no se consume -- asi que el componente
 * se monta directo sobre el shell que lo va a contener. El harness replica ese
 * shell (`relative h-screen`, de donde el componente saca la escala) y recibe
 * los props por query string.
 *
 * Los pixeles los fija artifacts/pause-screen/measure/regress.py contra la
 * referencia aprobada; aqui va el CONTRATO.
 */

const HARNESS = "/artifacts/pause-screen/harness.html";
const PAUSE_DELAY_MS = 3000;

/**
 * La espera de fuentes NO puede ser bloqueante aqui: mientras carga Inter (o
 * va al fallback si la CDN falla) pasan segundos, y un test que mida "a los 2 s
 * no hay overlay" se mediria en realidad a los 12 s. Para el contrato no hace
 * falta; para los pixeles, si, y ahi se espera aparte.
 */
async function open(page: Page, query = "") {
  await page.goto(`${HARNESS}${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__harnessReady === true", undefined, { timeout: 20_000 });
}

async function fontsReady(page: Page) {
  await page.waitForFunction(
    () => Array.from(document.fonts).some(f => f.status === "loaded" && f.family.includes("Inter")),
    undefined,
    { timeout: 30_000 },
  ).catch(() => undefined);
}

const overlay = (page: Page) => page.locator("[data-player-pause-screen]");

test("no aparece antes del retraso y aparece despues", async ({ page }) => {
  // Retardo holgado a proposito: el reloj arranca en el goto, no despues de
  // esperar las fuentes. Con 3 s exactos el test seria una carrera.
  await open(page, "?delay=8000");
  await page.waitForTimeout(2500);
  await expect(overlay(page)).toHaveCount(0);
  await expect(overlay(page)).toBeVisible({ timeout: 15_000 });
  await expect(overlay(page)).toHaveAttribute("aria-hidden", "false");
});

test("el retraso por defecto son 3 s", async ({ page }) => {
  await open(page, "");
  await page.waitForTimeout(1500);
  expect(await overlay(page).count()).toBe(0);
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
});

test("la copia es la de producto, en espanol", async ({ page }) => {
  await open(page, "?lang=es");
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  await expect(overlay(page)).toContainText("Viendo Ahora");
  await expect(overlay(page)).toContainText("Pausado");
  await expect(overlay(page)).toContainText("Temporada 9: Ep.16");
  await expect(overlay(page)).toContainText("entrevista");
});

test("modo PC conserva el velo oscuro y omite el texto estilo Netflix", async ({ page }) => {
  await open(page, "?mode=pc");
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  await expect(overlay(page).locator("[data-player-pause-backdrop]")).toBeVisible();
  await expect(overlay(page)).not.toContainText("Viendo Ahora");
  await expect(overlay(page)).not.toContainText("Pausado");
  await expect(overlay(page)).not.toContainText("Temporada");
  await expect(overlay(page).locator("[data-player-pause-backdrop]"))
    .toHaveCSS("background-color", "rgba(0, 0, 0, 0.5)");
});

test("serie: temporada y titulo de episodio", async ({ page }) => {
  await open(page);
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  await expect(overlay(page)).toContainText("Temporada 9: Ep.16");
  await expect(overlay(page)).toContainText("Moving On");
});

test("pelicula: sin temporada ni titulo de episodio", async ({ page }) => {
  await open(page, "?series=0");
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  await expect(overlay(page)).toContainText("Viendo Ahora");
  await expect(overlay(page)).toContainText("Pausado");
  // Informacion falsa si aparece: una pelicula no tiene temporada ni episodio.
  await expect(overlay(page)).not.toContainText("Temporada");
  await expect(overlay(page)).not.toContainText("Moving On");
});

test("pelicula: la descripcion sube y el bloque queda centrado, sin hueco muerto", async ({ page }) => {
  await open(page);
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  const serie = await page.evaluate(() => {
    const r = document.querySelector("[data-player-pause-desc]")!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });

  await open(page, "?series=0");
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  const pelicula = await page.evaluate(() => {
    const root = document.querySelector("[data-player-pause-screen]")!.getBoundingClientRect();
    const desc = document.querySelector("[data-player-pause-desc]")!.getBoundingClientRect();
    return {
      descTop: desc.top,
      rootCentre: root.top + root.height / 2,
      blockCentre: desc.top + desc.height / 2,
      rootH: root.height,
    };
  });

  // Sin las dos lineas que faltan, la descripcion tiene que subir de verdad.
  expect(pelicula.descTop).toBeLessThan(serie.top - 5);
  // Y el bloque completo se recentra en el frame (no queda media pantalla de
  // vacio debajo): el centro de la descripcion cae cerca del centro del frame.
  const offset = Math.abs(pelicula.blockCentre - pelicula.rootCentre);
  expect(offset).toBeLessThan(pelicula.rootH * 0.25);
});

test("la barra de controles montada la esconde", async ({ page }) => {
  await open(page, "?controls=1");
  await page.waitForTimeout(PAUSE_DELAY_MS + 1500);
  // Puede seguir montado durante el fade de salida, pero jamas visible.
  await expect(overlay(page)).not.toBeVisible({ timeout: 10_000 });
});

test("cualquier cosa que bloquee la mantiene oculta", async ({ page }) => {
  await open(page, "?blocked=1");
  await page.waitForTimeout(PAUSE_DELAY_MS + 800);
  expect(await overlay(page).count()).toBe(0);
});

/**
 * Muestrea la opacidad del overlay cada frame durante `ms` y devuelve la
 * serie. Sirve para distinguir "aparecio de golpe" (todo el primer punto ya a 1)
 * de "entro con fade" (arranca por debajo de 1 y sube).
 */
async function serieOpacidad(page: Page, ms: number): Promise<number[]> {
  return page.evaluate(async duracion => {
    const muestras: number[] = [];
    const hasta = performance.now() + duracion;
    while (performance.now() < hasta) {
      const o = document.querySelector("[data-player-pause-screen]");
      muestras.push(o ? Number(getComputedStyle(o).opacity) : NaN);
      await new Promise(requestAnimationFrame);
    }
    return muestras;
  }, ms);
}

test("entra con fade: no aparece de golpe", async ({ page }) => {
  await open(page, "?delay=0");
  // Se espera al nodo y se muestrea ya desde dentro: el fade dura 280 ms, asi
  // que hay Samples intermedios aunque el arranque sea lento.
  await page.waitForFunction(
    () => document.querySelector("[data-player-pause-screen]") !== null,
    undefined,
    { timeout: 10_000 },
  );
  const serie = (await serieOpacidad(page, 400)).filter(n => !Number.isNaN(n));

  expect(serie.length).toBeGreaterThan(4);
  expect(Math.min(...serie), "el fade tiene que pasar por opacidades intermedias").toBeLessThan(0.95);
  expect(serie[0], "no debe empezar ya a opacidad plena").toBeLessThan(1);
  expect(Math.max(...serie), "y acaba a opacidad plena").toBe(1);
  // Monotono: cada muestra al menos tan opaca como la anterior.
  const caidas = serie.filter((v, i) => i > 0 && v < serie[i - 1] - 1e-6);
  expect(caidas, `no debe parpadear: ${caidas.length} retrocesos`).toEqual([]);
});

test("sale con fade y se desmonta cuando termina", async ({ page }) => {
  await open(page, "?delay=0");
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const o = document.querySelector("[data-player-pause-screen]");
      return o !== null && getComputedStyle(o).opacity === "1";
    },
    undefined,
    { timeout: 10_000 },
  );

  // Se esconden los controles: es lo que en el Player real devuelve el overlay.
  await page.evaluate(() => (window as unknown as { __setPauseControls: (b: boolean) => void }).__setPauseControls(true));

  const serie = (await serieOpacidad(page, 400)).filter(n => !Number.isNaN(n));
  expect(serie.length, "el nodo tiene que seguir montado durante la salida").toBeGreaterThan(4);
  expect(Math.min(...serie), "y desvanecerse hasta 0").toBeLessThan(0.05);

  // Y una vez desvanecido, se retira del DOM.
  await expect(overlay(page)).toHaveCount(0, { timeout: 3_000 });
});

test("no captura el raton", async ({ page }) => {
  await open(page);
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  const owner = await page.evaluate(() => {
    const o = document.querySelector("[data-player-pause-screen]")!;
    const r = o.getBoundingClientRect();
    const probe = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      return el === null ? "nada" : o.contains(el) ? "overlay" : "debajo";
    };
return {
        left: probe(r.left + 40, r.top + r.height / 2),
        centro: probe(r.left + r.width / 2, r.top + r.height / 2),
        abajo: probe(r.left + r.width - 60, r.bottom - 30),
      };
    });
  // "nada" tambien vale: lo que no puede pasar es que el overlay capture.
  for (const where of Object.values(owner)) expect(where).not.toBe("overlay");
});

test("escala con el alto del frame y no con el de la ventana", async ({ page }) => {
  const read = async (w: number, h: number) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
    return page.evaluate(() => {
      const root = document.querySelector("[data-player-pause-screen]")!;
      const paras = [...root.querySelectorAll("p")];
      const eyebrow = paras.find(p => (p.textContent || "").includes("Viendo Ahora"))!;
      return {
        left: eyebrow.getBoundingClientRect().left,
        rootH: root.getBoundingClientRect().height,
      };
    });
  };

  const a = await read(701, 438);
  const b = await read(1402, 876);
  console.log("ESCALA a=" + JSON.stringify(a) + " b=" + JSON.stringify(b));

  // Escala doble de alto -> doble de margen izquierdo. Si escalara por `vw`,
  // el margen se moveria y el texto se despegaría del borde del video.
  expect(b.rootH / a.rootH).toBeCloseTo(2, 1);
  expect(b.left / a.left).toBeCloseTo(2, 1);
});

test("todos los bloques caen dentro del frame en pantallas panoramicas", async ({ page }) => {
  for (const [w, h] of [[1650, 800], [2560, 1080], [3440, 1440], [960, 600]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await open(page);
    await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
    const out = await page.evaluate(() => {
      const bad: string[] = [];
      const description = document.querySelector("[data-player-pause-desc]")?.getBoundingClientRect();
      const paused = document.querySelector("[data-player-pause-label]")?.getBoundingClientRect();
      if (description && paused && Math.abs(description.right - paused.right) > 2) {
        bad.push("la descripcion no llega al margen derecho de la pantalla");
      }
      for (const el of document.querySelectorAll("[data-player-pause-screen] p, [data-player-pause-screen] span")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) {
          bad.push((el.textContent || "").slice(0, 18));
        }
      }
      return bad;
    });
    expect(out, `se sale del frame en ${w}x${h}`).toEqual([]);
  }
});

test("sin errores de consola", async ({ page }) => {
  const errs: string[] = [];
  page.on("pageerror", e => errs.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  for (const query of ["", "?lang=es", "?series=0", "?delay=0", "?controls=1"]) {
    await open(page, query);
    await page.waitForTimeout(600);
  }
  expect(errs).toEqual([]);
});

/**
 * Congela el pixel de referencia desde el COMPONENTE real, no desde el clon.
 * El gate numerico vive en measure/regress.py; aqui solo se captura.
 */
test("captura del componente a tamano de referencia", async ({ page }) => {
  await page.setViewportSize({ width: 701, height: 438 });
  // `lang=es` es obligatorio: la base congelada esta en espanol y comparar
  // glifos castellanos contra ingleses no mide nada.
  await open(page, "?delay=0&lang=es");
  await fontsReady(page);
  await expect(overlay(page)).toBeVisible({ timeout: 10_000 });
  // El overlay entra con un fade de 280 ms. Capturar a mitad de transicion
  // baja la tinta de todos los bloques por igual (~0.85x) y la puerta de pixel
  // ve un defecto que no existe.
  await page.waitForFunction(() => {
    const o = document.querySelector("[data-player-pause-screen]");
    return o !== null && getComputedStyle(o).opacity === "1";
  }, undefined, { timeout: 10_000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: "artifacts/pause-screen/measure/component_701.png" });
});
