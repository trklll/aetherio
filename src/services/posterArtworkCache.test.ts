import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SPATIAL_POSTER_SETTINGS } from "../config/spatialPosters";
import { resetPosterProbeState } from "./posterProbe";
import {
  flushPosterArtworkCacheForTests,
  getReadyPosterArtwork,
  isPosterArtworkFailed,
  posterArtworkKey,
  preloadPosterArtwork,
  resetPosterArtworkCacheForTests,
} from "./posterArtworkCache";

let loads = 0;
let profileId = "profile-a";
let storage: Map<string, string>;

function readStorage(key: string): string | null {
  if (key.endsWith(":active")) return profileId;
  if (key.endsWith(":migrated")) return "1";
  return storage.get(key) ?? null;
}

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
  storage = new Map();
  resetPosterProbeState();
  resetPosterArtworkCacheForTests();
  vi.stubGlobal("Image", TestImage);
  vi.stubGlobal("localStorage", {
    getItem: readStorage,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
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

  // El bug que se arregla con esto: sin registro persistido, cada arranque
  // re-verificaba por red las ~400 URLs de Home y el splash se comia ~100 s
  // aunque los PNG ya estuvieran en el cache del proxy.
  it("tras un reinicio no vuelve a pedir por red lo que ya estaba verificado", async () => {
    const url = "http://127.0.0.1:3000/api/poster/movie/11?lang=es";
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    const signature = "sig-home";

    await preloadPosterArtwork(url, settings, signature);
    flushPosterArtworkCacheForTests();
    expect(loads).toBe(1);

    // Simula cerrar y abrir la app: se pierde el Map en memoria, el registro de
    // disco queda.
    resetPosterArtworkCacheForTests();

    expect(await preloadPosterArtwork(url, settings, signature)).toBe(url);
    expect(getReadyPosterArtwork(url, settings, signature)).toBe(url);
    expect(loads).toBe(1);
  });

  it("un cambio de ajustes rehace el render porque la URL cambia", async () => {
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    // En la app real la firma viaja dentro de la query (estilos, badges, región),
    // así que cambiar preferencias produce otra URL y otro archivo en el proxy.
    const conBadge = "http://127.0.0.1:3000/api/poster/movie/11?lang=es&badge=rating";
    const sinBadge = "http://127.0.0.1:3000/api/poster/movie/11?lang=es";

    await preloadPosterArtwork(conBadge, settings, "sig-1");
    flushPosterArtworkCacheForTests();
    resetPosterArtworkCacheForTests();

    // El registro tiene `conBadge`, no `sinBadge`: se re-renderiza.
    await preloadPosterArtwork(sinBadge, settings, "sig-2");
    expect(loads).toBe(2);
  });

  it("no confía en el registro si la URL no es del proxy local", async () => {
    const url = "https://example.com/remote-poster.jpg";
    await preloadPosterArtwork(url, DEFAULT_SPATIAL_POSTER_SETTINGS, "sig");
    flushPosterArtworkCacheForTests();
    // Reinicio real: se pierde tambien la cache en memoria del probe.
    resetPosterProbeState();
    resetPosterArtworkCacheForTests();

    // Fuera del proxy no hay forma de preguntar por el archivo sin generarlo, asi
    // que se re-verifica en vez de asumir que sigue ahi: un host externo puede
    // haber borrado el recurso.
    await preloadPosterArtwork(url, DEFAULT_SPATIAL_POSTER_SETTINGS, "sig");
    expect(loads).toBe(2);
  });

  it("conserva la firma completa en la clave guardada para no colisionar entre ajustes", async () => {
    const url = "http://127.0.0.1:3000/api/poster/movie/11?lang=es";
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    await preloadPosterArtwork(url, settings, "sig-1");
    flushPosterArtworkCacheForTests();

    const stored = storage.get("aetherio.spatial-posters.ready.v1") ?? "";
    // La clave guardada lleva `firma::ruta canónica`: al resolver, `split("::")`
    // debe dar la ruta completa, no un fragmento. Una URL con `?a=1&b=2` es el
    // caso que rompe si se parte por cualquier separador.
    expect(stored).toContain("sig-1::/api/poster/movie/11?lang=es");
    expect(Object.keys(JSON.parse(stored).ready)).toHaveLength(1);
  });

  // El proxy Rust escucha en un puerto efímero distinto en cada arranque. Antes
  // la clave persistida incluía ese puerto, así que ningún veredicto sobrevivía
  // al reinicio y todo se re-verificaba por red.
  it("no vuelve a verificar si solo cambió el puerto efímero del proxy", async () => {
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    const signature = "sig-home";
    const firstSession = "http://127.0.0.1:50001/api/poster/movie/11?lang=es";
    const secondSession = "http://127.0.0.1:50002/api/poster/movie/11?lang=es";

    await preloadPosterArtwork(firstSession, settings, signature);
    flushPosterArtworkCacheForTests();
    expect(loads).toBe(1);

    // Reinicio: mismo query, puerto nuevo. Se resuelve con la URL de esta sesión.
    resetPosterArtworkCacheForTests();
    expect(await preloadPosterArtwork(secondSession, settings, signature)).toBe(secondSession);
    expect(loads).toBe(1);
  });

  it("migra las claves guardadas por versiones anteriores al cargar el registro", async () => {
    const settings = DEFAULT_SPATIAL_POSTER_SETTINGS;
    const signature = "sig-home";
    storage.set("aetherio.spatial-posters.ready.v1", JSON.stringify({
      v: 1,
      ready: {
        [`${signature}::http://127.0.0.1:39999/api/poster/movie/11?lang=es`]: Date.now(),
      },
      failed: {},
    }));

    const url = "http://127.0.0.1:50002/api/poster/movie/11?lang=es";
    expect(await preloadPosterArtwork(url, settings, signature)).toBe(url);
    expect(loads).toBe(0);
  });
});
