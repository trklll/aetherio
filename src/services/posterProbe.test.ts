import { afterEach, describe, expect, it } from "vitest";

import {
  POSTER_PROBE_FAIL_TTL_MS,
  POSTER_PROBE_MAX_CONCURRENT,
  POSTER_PROBE_TIMEOUT_MS,
  forgetPosterFailure,
  resetPosterProbeState,
  verifyPosterUrl,
} from "./posterProbe";

describe("presupuestos del probe de pósteres", () => {
  it("el timeout por póster cubre la espera en cola de un arranque en frío", () => {
    // El bug que se reporto: con 20 s por verificación, el póster #100 de ~260
    // se expiraba antes de empezar a cargar (espera ~260/6 x 2 s ≈ 90 s), se
    // marcaba como fallido y la card caía al póster de TMDB para toda la sesión.
    // Solo se veían las primeras filas. El presupuesto tiene que holgarse por
    // encima de la cola completa, no del render de un póster suelto.
    const coldStartPosters = 260;
    const renderSeconds = 2;
    const queueSeconds = (coldStartPosters / POSTER_PROBE_MAX_CONCURRENT) * renderSeconds;
    expect(POSTER_PROBE_TIMEOUT_MS / 1000).toBeGreaterThan(queueSeconds);
  });

  it("el TTL de fallo es lo bastante corto para no congelar un póster", () => {
    // 5 minutos hacía que un póster que expiró por congestión quedara en TMDB
    // durante toda la sesión. Con 15 s se reintenta en cuanto la cola baja.
    expect(POSTER_PROBE_FAIL_TTL_MS).toBeLessThanOrEqual(30 * 1000);
    expect(POSTER_PROBE_FAIL_TTL_MS).toBeGreaterThan(0);
  });

  it("la concurrencia esta en el rango util para una instancia local", () => {
    // Los pósteres se piden al proxy loopback (127.0.0.1), no a un host remoto,
    // así que el límite de 6 conexiones por host del navegador no aplica igual:
    // ahí el freno es la CPU del render. Medido: 3.5 s por póster, 148 pósteres a
    // 6 en paralelo son 86 s de splash y a 12 son 43 s.
    //
    // El techo de 24 existe para que un cambio futuro no lo suba sin límite y
    // dispare cientos de renders a la vez. SpatialPosters tiene su propio
    // limitador de 8 renders, que es el freno real.
    expect(POSTER_PROBE_MAX_CONCURRENT).toBeGreaterThanOrEqual(6);
    expect(POSTER_PROBE_MAX_CONCURRENT).toBeLessThanOrEqual(24);
  });

  it("el tiempo de cola cabe dentro del presupuesto de arranque", () => {
    // La cuenta que manda: si la cola no cabe en el presupuesto, el splash
    // entra por timeout y muestra TMDB en vez de SpatialPosters.
    const posters = 148;
    const renderSeconds = 3.5;
    const colaSegundos = (posters / POSTER_PROBE_MAX_CONCURRENT) * renderSeconds;
    const presupuestoSplash = 90;
    expect(colaSegundos).toBeLessThan(presupuestoSplash);
  });
});

describe("reintento de pósteres fallidos", () => {
  afterEach(() => resetPosterProbeState());

  it("un fallo reciente no vuelve a sondear la red hasta que expira el TTL", async () => {
    let intentos = 0;
    const loadImage = () => {
      intentos += 1;
      return Promise.reject(new Error("image-error"));
    };
    expect(await verifyPosterUrl("u-muerta", { loadImage })).toBe(false);
    expect(await verifyPosterUrl("u-muerta", { loadImage })).toBe(false);
    expect(intentos).toBe(1);
  });

  it("forgetPosterFailure fuerza el sondeo real aunque el fallo sea reciente", async () => {
    // El bucle de espera del arranque depende de esto: sin olvidar el fallo,
    // cada vuelta respondia desde el TTL y un 404 terminal agotaba el
    // presupuesto del splash esperando algo que nunca se recupera.
    let intentos = 0;
    const loadImage = () => {
      intentos += 1;
      return intentos >= 2 ? Promise.resolve() : Promise.reject(new Error("image-error"));
    };
    expect(await verifyPosterUrl("u-flaky", { loadImage })).toBe(false);
    forgetPosterFailure("u-flaky");
    expect(await verifyPosterUrl("u-flaky", { loadImage })).toBe(true);
    expect(intentos).toBe(2);
  });
});
