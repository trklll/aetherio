import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_SYNC_TITLES_STORAGE_KEY,
  buildAutoSyncTitleKey,
  clearAutoSyncTitleMode,
  getAutoSyncTitleMode,
  setAutoSyncTitleMode,
  shouldAutoSyncTitle,
} from "./autoSyncPreference";

function mockStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  });
  return store;
}

describe("clave de titulo para Auto Sync", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockStorage();
  });

  it("normaliza peliculas por tmdb e imdb", () => {
    expect(buildAutoSyncTitleKey({ type: "movie", id: "tmdb:603" })).toBe("movie:tmdb:603");
    expect(buildAutoSyncTitleKey({ type: "movie", id: "tt0133093" })).toBe("movie:tt0133093");
  });

  it("incluye temporada y capitulo en series", () => {
    expect(buildAutoSyncTitleKey({ type: "tv", id: "tmdb:1396", season: 1, episode: 2 })).toBe("episode:tmdb:1396:1:2");
    expect(buildAutoSyncTitleKey({ type: "anime", id: "tt0903747", season: 3, episode: 7 })).toBe("episode:tt0903747:3:7");
  });

  it("devuelve cadena vacia cuando no hay titulo identificable", () => {
    expect(buildAutoSyncTitleKey(null)).toBe("");
    expect(buildAutoSyncTitleKey(undefined)).toBe("");
    expect(buildAutoSyncTitleKey({ type: "movie", id: "no-id" })).toBe("");
  });
});

describe("preferencia de Auto Sync por titulo", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockStorage();
  });

  it("sin decision guardada el modo aprendido no dispara", () => {
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:603" });
    expect(getAutoSyncTitleMode(key)).toBeNull();
    expect(shouldAutoSyncTitle("learned", key, new Set())).toBe(false);
  });

  it("un titulo sincronizado queda activo para las siguientes reproducciones", () => {
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:603" });
    setAutoSyncTitleMode(key, "on");
    expect(getAutoSyncTitleMode(key)).toBe("on");
    expect(shouldAutoSyncTitle("learned", key, new Set())).toBe(true);
  });

  it("un titulo marcado como no no vuelve a dispararse en modo aprendido", () => {
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:604" });
    setAutoSyncTitleMode(key, "off");
    expect(shouldAutoSyncTitle("learned", key, new Set())).toBe(false);
    expect(shouldAutoSyncTitle("on", key, new Set())).toBe(true);
  });

  it("el modo global apagado gana siempre", () => {
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:605" });
    setAutoSyncTitleMode(key, "on");
    expect(shouldAutoSyncTitle("off", key, new Set())).toBe(false);
  });

  it("no reintenta el mismo titulo mas de una vez por sesion", () => {
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:606" });
    setAutoSyncTitleMode(key, "on");
    const attempted = new Set([key]);
    expect(shouldAutoSyncTitle("learned", key, attempted)).toBe(false);
  });

  it("se puede olvidar la decision de un titulo", () => {
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:607" });
    setAutoSyncTitleMode(key, "on");
    clearAutoSyncTitleMode(key);
    expect(getAutoSyncTitleMode(key)).toBeNull();
  });

  it("un titulo vacio nunca dispara", () => {
    expect(shouldAutoSyncTitle("on", "", new Set())).toBe(false);
  });

  it("sobrevive a un almacenamiento corrupto", () => {
    mockStorage({ [AUTO_SYNC_TITLES_STORAGE_KEY]: "{no es json" });
    const key = buildAutoSyncTitleKey({ type: "movie", id: "tmdb:608" });
    expect(getAutoSyncTitleMode(key)).toBeNull();
    expect(() => setAutoSyncTitleMode(key, "on")).not.toThrow();
    expect(getAutoSyncTitleMode(key)).toBe("on");
  });

  it("descarta entradas con valores invalidos", () => {
    mockStorage({ [AUTO_SYNC_TITLES_STORAGE_KEY]: JSON.stringify({ "movie:tmdb:1": "quizá", "movie:tmdb:2": "on" }) });
    expect(getAutoSyncTitleMode("movie:tmdb:1")).toBeNull();
    expect(getAutoSyncTitleMode("movie:tmdb:2")).toBe("on");
  });

  it("acota el numero de titulos recordados", () => {
    for (let index = 0; index < 260; index += 1) {
      setAutoSyncTitleMode(`movie:tmdb:${index}`, "on");
    }
    const stored = JSON.parse(localStorage.getItem(AUTO_SYNC_TITLES_STORAGE_KEY) ?? "{}");
    expect(Object.keys(stored).length).toBeLessThanOrEqual(200);
    expect(getAutoSyncTitleMode("movie:tmdb:259")).toBe("on");
    expect(getAutoSyncTitleMode("movie:tmdb:0")).toBeNull();
  });
});
