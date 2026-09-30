import { describe, expect, it } from "vitest";

import {
  POSTER_PROBE_FAIL_TTL_MS,
  POSTER_PROBE_MAX_CONCURRENT,
  POSTER_PROBE_TIMEOUT_MS,
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

  it("la concurrencia no supera lo que el navegador permite por host", () => {
    // El navegador abre 6 conexiones por host (HTTP/1.1). Passarse solo hace
    // que las peticiones esperen en la cola del navegador.
    expect(POSTER_PROBE_MAX_CONCURRENT).toBeLessThanOrEqual(6);
    expect(POSTER_PROBE_MAX_CONCURRENT).toBeGreaterThan(0);
  });
});
