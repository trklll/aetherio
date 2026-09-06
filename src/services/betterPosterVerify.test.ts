import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBetterPosterVerified,
  resetBetterPosterVerifyState,
  verifyBetterPosterUrl,
} from "./betterPosterVerify";

beforeEach(() => {
  resetBetterPosterVerifyState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("verifyBetterPosterUrl", () => {
  it("true cuando la imagen carga, y no re-verifica (caché)", async () => {
    const loadImage = vi.fn(async (_url: string) => {});
    const url = "https://btttr.cc/poster-g/imdb/poster-default/tt1.jpg?lang=es-ES";
    await expect(verifyBetterPosterUrl(url, { loadImage })).resolves.toBe(true);
    expect(isBetterPosterVerified(url)).toBe(true);
    await expect(verifyBetterPosterUrl(url, { loadImage })).resolves.toBe(true);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("false cuando la imagen falla, sin reintentar dentro del TTL", async () => {
    const loadImage = vi.fn(async (_url: string) => { throw new Error("404"); });
    const url = "https://btttr.cc/poster-g/imdb/poster-default/tt404.jpg";
    await expect(verifyBetterPosterUrl(url, { loadImage })).resolves.toBe(false);
    await expect(verifyBetterPosterUrl(url, { loadImage })).resolves.toBe(false);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("reintenta tras caducar el TTL de fallo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const loadImage = vi.fn(async (_url: string) => { throw new Error("429"); });
    const url = "https://btttr.cc/poster-g/imdb/poster-default/tt429.jpg";
    await expect(verifyBetterPosterUrl(url, { loadImage })).resolves.toBe(false);
    expect(loadImage).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    await expect(verifyBetterPosterUrl(url, { loadImage })).resolves.toBe(false);
    expect(loadImage).toHaveBeenCalledTimes(2);
  });

  it("false si agota el presupuesto (cuelgue sin onload/onerror)", async () => {
    const loadImage = vi.fn((_url: string) => new Promise<void>(() => {}));
    const url = "https://btttr.cc/poster-g/imdb/poster-default/tt8.jpg";
    await expect(verifyBetterPosterUrl(url, { loadImage, timeoutMs: 30 })).resolves.toBe(false);
    expect(isBetterPosterVerified(url)).toBe(false);
  });

  it("deduplica verificaciones concurrentes de la misma URL", async () => {    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const loadImage = vi.fn(() => gate.then(() => {}));
    const url = "https://btttr.cc/poster-g/imdb/poster-default/tt7.jpg";
    const first = verifyBetterPosterUrl(url, { loadImage });
    const second = verifyBetterPosterUrl(url, { loadImage });
    release();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("false sin llamar al cargador si no hay URL", async () => {
    const loadImage = vi.fn(async (_url: string) => {});
    await expect(verifyBetterPosterUrl(undefined, { loadImage })).resolves.toBe(false);
    await expect(verifyBetterPosterUrl("", { loadImage })).resolves.toBe(false);
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("limita la concurrencia para no saturar la conexión (anti-ráfaga)", async () => {
    let active = 0;
    let maxActive = 0;
    const loadImage = vi.fn(async (_url: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active -= 1;
    });
    const urls = Array.from(
      { length: 20 },
      (_, index) => `https://btttr.cc/poster-g/imdb/poster-default/ttL${index}.jpg`,
    );
    const results = await Promise.all(urls.map(url => verifyBetterPosterUrl(url, { loadImage })));
    expect(results.every(Boolean)).toBe(true);
    expect(loadImage).toHaveBeenCalledTimes(20);
    expect(maxActive).toBeLessThanOrEqual(6);
    expect(maxActive).toBeGreaterThan(1);
  });
});
