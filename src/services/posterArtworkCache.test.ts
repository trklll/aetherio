import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SPATIAL_POSTER_SETTINGS } from "../config/spatialPosters";
import { resetPosterProbeState } from "./posterProbe";
import { getReadyPosterArtwork, isPosterArtworkFailed, posterArtworkKey, preloadPosterArtwork } from "./posterArtworkCache";

let loads = 0;
let profileId = "profile-a";

class TestImage {
  naturalWidth = 500;
  naturalHeight = 750;
  complete = false;
  decoding = "async";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(value: string) {
    loads += 1;
    queueMicrotask(() => {
      if (value.includes("fail")) this.onerror?.();
      else { this.complete = true; this.onload?.(); }
    });
  }

  decode() { return Promise.resolve(); }
}

beforeEach(() => {
  loads = 0;
  profileId = "profile-a";
  resetPosterProbeState();
  vi.stubGlobal("Image", TestImage);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => key.endsWith(":active") ? profileId : key.endsWith(":migrated") ? "1" : null,
    setItem: () => undefined,
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("posterArtworkCache", () => {
  it("deduplica la carga del poster final y reutiliza la imagen lista", async () => {
    const url = "https://example.com/poster-a.jpg";
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    const first = preloadPosterArtwork(url, settings);
    const second = preloadPosterArtwork(url, settings);
    expect(first).toBe(second);
    expect(await first).toBe(url);
    expect(await preloadPosterArtwork(url, settings)).toBe(url);
    expect(getReadyPosterArtwork(url, settings)).toBe(url);
    expect(loads).toBe(1);
  });

  it("separa la caché por URL y por firma de ajustes", () => {
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    const base = posterArtworkKey("https://example.com/a.jpg", settings, "sig-1");
    expect(posterArtworkKey("https://example.com/b.jpg", settings, "sig-1")).not.toBe(base);
    // Cambiar estilos/badges/región debe invalidar lo ya verificado.
    expect(posterArtworkKey("https://example.com/a.jpg", settings, "sig-2")).not.toBe(base);
  });

  it("un fallo no queda cacheado como poster listo", async () => {
    const url = "https://example.com/fail.jpg";
    expect(await preloadPosterArtwork(url, DEFAULT_SPATIAL_POSTER_SETTINGS)).toBeNull();
    expect(getReadyPosterArtwork(url, DEFAULT_SPATIAL_POSTER_SETTINGS)).toBeUndefined();
    expect(isPosterArtworkFailed(url, DEFAULT_SPATIAL_POSTER_SETTINGS)).toBe(true);
  });
});
