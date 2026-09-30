import { expect, test, type Page } from "@playwright/test";

/**
 * "Atras" desde la page detail debe devolver a la page de la que se salio (no a
 * Home ni a si misma) y caer en la posicion exacta de la card desde la que se
 * entro.
 *
 * La parte de scroll no se puede probar solo con la funcion pura: el fallo venia
 * de que la page de destino monta con el contenedor vacio (el buscador carga sus
 * resultados en async) y el navegador recorta el scrollTo a 0 antes de que
 * haya alto. Aqui se reproduce contra el shell real simulando contenido tardio.
 */

const SEARCH = "/search?q=akira&literal=1";
const DETAIL = "/detail/movie/589?fromSearch=1&q=akira";
const SCROLL_TOP = 600;

/** App minima: shell, router y las paginas de search/detail que aplican. */
async function stubApp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let nextId = 1;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => nextId++,
      invoke: async (cmd: string) => (cmd.startsWith("plugin:event|") ? nextId++ : null),
      convertFileSrc: (p: string) => p,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      plugins: {},
    };
    w.__TAURI__ = { event: { listen: async () => () => undefined } };
    localStorage.setItem("aetherio-local-mode-v1", "1");
  });
}

/**
 * Sin la superficie nativa de MPV la transicion de entrada no termina y la raiz
 * se queda en visibility:hidden, lo que saca los botones del arbol de
 * accesibilidad. Mismo forzaje que usa el E2E de Seekr.
 */
async function forceVisible(page: Page) {
  await page.addStyleTag({ content: "*, *::before, *::after { visibility: visible !important; }" });
}

async function shellScrollTop(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector("[data-aetherio-scroll-shell]") as HTMLElement | null;
    return shell?.scrollTop ?? 0;
  });
}

async function scrollShellTo(page: Page, top: number) {
  await page.evaluate(value => {
    const shell = document.querySelector("[data-aetherio-scroll-shell]") as HTMLElement | null;
    shell?.scrollTo({ top: value, behavior: "instant" as ScrollBehavior });
  }, top);
  await page.waitForTimeout(150);
}

/** Relleno de alto, para que la posicion sea alcanzable. */
async function addFiller(page: Page, height = 4000) {
  await page.evaluate(h => {
    const shell = document.querySelector("[data-aetherio-scroll-shell]") as HTMLElement | null;
    if (!shell) return;
    const filler = document.createElement("div");
    filler.style.height = `${h}px`;
    filler.dataset.e2eFiller = "1";
    shell.appendChild(filler);
  }, height);
}

/** Navegacion in-app. El idx coincide con la posicion real del stack. */
async function navigateInApp(page: Page, path: string, idx: number) {
  await page.evaluate(({ to, index }) => {
    const state = { usr: null, key: `e2e-${index}`, idx: index };
    window.history.pushState(state, "", to);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  }, { to: path, index: idx });
  await page.waitForTimeout(500);
}

/** El chrome se revela con el raton; por coordenadas no llegaria. */
async function clickBack(page: Page) {
  const back = page.getByRole("button", { name: /volver/i });
  await expect(back).toBeVisible({ timeout: 10_000 });
  await back.evaluate((el: HTMLElement) => el.click());
}

test("atras desde detail vuelve a la page de origen, no a home ni al propio detail", async ({ page }) => {
  await stubApp(page);
  await page.goto(SEARCH);
  await page.waitForLoadState("domcontentloaded");
  await forceVisible(page);
  await addFiller(page);
  await scrollShellTo(page, SCROLL_TOP);

  await navigateInApp(page, DETAIL, 1);
  expect(new URL(page.url()).pathname).toBe("/detail/movie/589");

  await forceVisible(page);
  await clickBack(page);
  await page.waitForTimeout(700);

  const url = new URL(page.url());
  expect(url.pathname).toBe("/search");
  expect(url.searchParams.get("q")).toBe("akira");
});

test("el scroll vuelve a la card exacta aunque el destino pinte su contenido tarde", async ({ page }) => {
  await stubApp(page);
  await page.goto(SEARCH);
  await page.waitForLoadState("domcontentloaded");
  await forceVisible(page);
  await addFiller(page);
  await scrollShellTo(page, SCROLL_TOP);
  expect(await shellScrollTop(page)).toBeGreaterThan(100);

  await navigateInApp(page, DETAIL, 1);
  await forceVisible(page);
  await clickBack(page);

  // Aqui esta el fallo original: al volver, la page de destino aun no tiene alto
  // (sus filas siguen cargando) y el scroll se recortaba a 0 para siempre.
  // Las filas "llegan" 300 ms despues, como las del buscador real.
  await addFiller(page);
  await page.waitForTimeout(900);

  const restored = await shellScrollTop(page);
  console.log("SCROLL origen", SCROLL_TOP, "restaurado", restored);
  expect(Math.abs(restored - SCROLL_TOP)).toBeLessThanOrEqual(40);
});
