import { beforeEach, describe, expect, it } from "vitest";
import {
  getKnownSpatialAvailability,
  probeSpatialInstance,
  resetSpatialAvailability,
} from "./spatialInstance";

const BASE = "http://localhost:3000";

/** fetch falso que cuenta llamadas y recuerda la URL pedida. */
function fakeFetch(status: number) {
  const state = { calls: 0, lastUrl: "" };
  const fn = (async (input: RequestInfo | URL) => {
    state.calls += 1;
    state.lastUrl = String(input);
    return new Response("{}", { status });
  }) as typeof fetch;
  return { fn, state };
}

/** fetch que falla como cuando no hay nada escuchando en el puerto. */
const downFetch = (async () => {
  throw new TypeError("Failed to fetch");
}) as typeof fetch;

beforeEach(() => resetSpatialAvailability());

describe("probeSpatialInstance", () => {
  it("da por buena la instancia si responde", async () => {
    const { fn, state } = fakeFetch(200);
    await expect(probeSpatialInstance(BASE, fn)).resolves.toBe(true);
    expect(state.lastUrl).toBe(`${BASE}/manifest.json`);
  });

  it("acepta cualquier respuesta HTTP como prueba de que hay algo escuchando", async () => {
    // Un 404 tambien significa que el puerto esta abierto.
    await expect(probeSpatialInstance(BASE, fakeFetch(404).fn)).resolves.toBe(true);
  });

  it("da por caída la instancia si no hay nada escuchando", async () => {
    await expect(probeSpatialInstance(BASE, downFetch)).resolves.toBe(false);
  });

  it("cachea el resultado y no vuelve a preguntar en cada card", async () => {
    const { fn, state } = fakeFetch(200);
    await probeSpatialInstance(BASE, fn);
    await probeSpatialInstance(BASE, fn);
    await probeSpatialInstance(BASE, fn);
    expect(state.calls).toBe(1);
  });

  it("deduplica sondeos concurrentes de la misma instancia", async () => {
    const { fn, state } = fakeFetch(200);
    const results = await Promise.all([
      probeSpatialInstance(BASE, fn),
      probeSpatialInstance(BASE, fn),
      probeSpatialInstance(BASE, fn),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(state.calls).toBe(1);
  });

  it("sondea por instancia: cambiar de URL no hereda el resultado anterior", async () => {
    await expect(probeSpatialInstance(BASE, fakeFetch(200).fn)).resolves.toBe(true);
    const other = "http://otra:3000";
    expect(getKnownSpatialAvailability(other)).toBeNull();
    await expect(probeSpatialInstance(other, fakeFetch(200).fn)).resolves.toBe(true);
  });

  it("reset fuerza a volver a preguntar", async () => {
    const { fn, state } = fakeFetch(200);
    await probeSpatialInstance(BASE, fn);
    resetSpatialAvailability(BASE);
    expect(getKnownSpatialAvailability(BASE)).toBeNull();
    await probeSpatialInstance(BASE, fn);
    expect(state.calls).toBe(2);
  });
});
