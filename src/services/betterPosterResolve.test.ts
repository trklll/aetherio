import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  betterMetaTypeFor,
  parseTmdbId,
  readCachedImdb,
  resolveTmdbToImdb,
} from "./betterPosterResolve";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

function metaResponse(imdbId: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ meta: { id: imdbId, type: "series" } }),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // El módulo usa window.setTimeout/clearTimeout (timeouts de red). En node
  // se delega al temporizador global (mockeado por fake timers aquí).
  vi.stubGlobal("window", {
    setTimeout: (...args: [handler: () => void, timeout?: number]) =>
      globalThis.setTimeout(args[0], args[1]),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
  });
  vi.stubGlobal("localStorage", createStorage());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
});

describe("parseTmdbId / betterMetaTypeFor / readCachedImdb", () => {
  it("parsea tmdb:123 y rechaza el resto", () => {
    expect(parseTmdbId("tmdb:123")).toBe(123);
    expect(parseTmdbId("tt123")).toBeNull();
    expect(parseTmdbId("tmdb:0")).toBeNull();
    expect(parseTmdbId(undefined)).toBeNull();
  });

  it("mapea tipos de medio", () => {
    expect(betterMetaTypeFor("movie")).toBe("movie");
    expect(betterMetaTypeFor("series")).toBe("series");
    expect(betterMetaTypeFor("tv")).toBe("series");
  });

  it("caché vacía devuelve null", () => {
    expect(readCachedImdb("series", 424242)).toBeNull();
  });
});

describe("resolveTmdbToImdb", () => {
  it("resuelve vía meta de btttr y cachea el acierto", async () => {
    const fetchMock = vi.fn(async () => metaResponse("tt9988776"));
    vi.stubGlobal("fetch", fetchMock);
    // Sin key TMDB en este entorno, external_ids se salta y solo hay 1 fetch (meta).
    await expect(resolveTmdbToImdb("series", 991001)).resolves.toBe("tt9988776");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readCachedImdb("series", 991001)).toBe("tt9988776");
    await expect(resolveTmdbToImdb("series", 991001)).resolves.toBe("tt9988776");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un fallo transitorio se reintenta tras el TTL (no queda envenenado)", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveTmdbToImdb("series", 992002)).resolves.toBeNull();
    const afterFirst = fetchMock.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Dentro del TTL no se reintenta.
    await expect(resolveTmdbToImdb("series", 992002)).resolves.toBeNull();
    expect(fetchMock.mock.calls.length).toBe(afterFirst);

    // Tras el TTL se vuelve a intentar (antes era null permanente en sesión).
    vi.setSystemTime(new Date("2026-02-01T00:06:00Z"));
    await expect(resolveTmdbToImdb("series", 992002)).resolves.toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("deduplica resoluciones concurrentes del mismo id", async () => {
    const fetchMock = vi.fn(async () => metaResponse("tt5544332"));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([
      resolveTmdbToImdb("movie", 993003),
      resolveTmdbToImdb("movie", 993003),
    ]);
    expect(a).toBe("tt5544332");
    expect(b).toBe("tt5544332");
  });
});
