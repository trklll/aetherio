import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRAILER_PROBE_MIN_WIDTH,
  filterPlayableTrailers,
  forgetTrailerFailure,
  probeTrailerKey,
  resetTrailerProbeState,
  youtubeTrailerThumbnail,
} from "./trailerProbe";

const VALID_KEY = "dQw4w9WgXcQ";
const OTHER_VALID_KEY = "jNQXAC9IVRw";

describe("probe de trailers de YouTube", () => {
  beforeEach(() => resetTrailerProbeState());

  it("acepta una clave cuyo hqdefault tiene tamaño real", async () => {
    const loadImage = vi.fn(async () => ({ width: 480, height: 360 }));
    await expect(probeTrailerKey(VALID_KEY, { loadImage })).resolves.toBe(true);
    expect(loadImage).toHaveBeenCalledWith(youtubeTrailerThumbnail(VALID_KEY, "hq"));
  });

  it("rechaza el placeholder de 120x90 aunque la imagen cargue", async () => {
    const loadImage = vi.fn(async () => ({ width: 120, height: 90 }));
    await expect(probeTrailerKey(VALID_KEY, { loadImage })).resolves.toBe(false);
  });

  it("rechaza claves con formato inválido sin tocar la red", async () => {
    const loadImage = vi.fn(async () => ({ width: 480, height: 360 }));
    await expect(probeTrailerKey("corta", { loadImage })).resolves.toBe(false);
    await expect(probeTrailerKey("", { loadImage })).resolves.toBe(false);
    await expect(probeTrailerKey(123 as unknown as string, { loadImage })).resolves.toBe(false);
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("trata un error de carga como trailer no disponible", async () => {
    const loadImage = vi.fn(async () => {
      throw new Error("404");
    });
    await expect(probeTrailerKey(VALID_KEY, { loadImage })).resolves.toBe(false);
  });

  it("deduplica sondeos concurrentes de la misma clave", async () => {
    let calls = 0;
    const loadImage = vi.fn(async () => {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { width: 480, height: 360 };
    });
    const [first, second] = await Promise.all([
      probeTrailerKey(VALID_KEY, { loadImage }),
      probeTrailerKey(VALID_KEY, { loadImage }),
    ]);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(calls).toBe(1);
  });

  it("corta por timeout cuando la imagen no responde", async () => {
    const loadImage = vi.fn(() => new Promise<{ width: number; height: number }>(() => undefined));
    await expect(probeTrailerKey(VALID_KEY, { loadImage, timeoutMs: 10 })).resolves.toBe(false);
  });

  it("no reintenta una clave fallida hasta olvidar el fallo", async () => {
    const failing = vi.fn(async () => ({ width: 120, height: 90 }));
    await expect(probeTrailerKey(VALID_KEY, { loadImage: failing })).resolves.toBe(false);
    await expect(probeTrailerKey(VALID_KEY, { loadImage: failing })).resolves.toBe(false);
    expect(failing).toHaveBeenCalledTimes(1);

    forgetTrailerFailure(VALID_KEY);
    const working = vi.fn(async () => ({ width: 480, height: 360 }));
    await expect(probeTrailerKey(VALID_KEY, { loadImage: working })).resolves.toBe(true);
    expect(working).toHaveBeenCalledTimes(1);
  });
});

describe("filtro de trailers reproducibles", () => {
  beforeEach(() => resetTrailerProbeState());

  it("quita claves muertas y conserva los streams sin key", async () => {
    const loadImage = vi.fn(async (url: string) => (
      url.includes(VALID_KEY)
        ? { width: 480, height: 360 }
        : { width: TRAILER_PROBE_MIN_WIDTH - 1, height: 90 }
    ));
    const trailers = [
      { key: VALID_KEY, name: "Válido" },
      { key: OTHER_VALID_KEY, name: "Muerto" },
      { name: "Stream del addon", stream: { id: "s1" } },
    ];

    const result = await filterPlayableTrailers(trailers, { loadImage });

    expect(result.map(item => item.name)).toEqual(["Válido", "Stream del addon"]);
  });
});
