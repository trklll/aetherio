import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getLastAppMode,
  isBigPicturePath,
  resolveAppModeForPath,
  setLastAppMode,
  shouldShowBigPictureBrandOnStartup,
} from "./appMode.ts";
import * as localProfiles from "./localProfiles.ts";

const KEY = "aetherio-last-app-mode-v1";

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

describe("appMode (recuerda el último modo)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", createStorage());
    vi.spyOn(localProfiles, "getActiveProfileId").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin dato guardado devuelve null", () => {
    expect(getLastAppMode()).toBeNull();
  });

  it("persiste y lee el último modo del perfil", () => {
    setLastAppMode("big-picture", "perfil-1");
    expect(getLastAppMode("perfil-1")).toBe("big-picture");
    setLastAppMode("normal", "perfil-1");
    expect(getLastAppMode("perfil-1")).toBe("normal");
  });

  it("el modo es del perfil: entrar en otro no lo hereda", () => {
    setLastAppMode("big-picture", "perfil-1");
    setLastAppMode("normal", "perfil-2");

    expect(getLastAppMode("perfil-1")).toBe("big-picture");
    expect(getLastAppMode("perfil-2")).toBe("normal");
  });

  it("sin perfil al que atribuírselo no escribe nada", () => {
    // El global es la semilla de la migración: si se escribiera sin dueño,
    // contaminaría a todos los perfiles que aún no tienen memoria propia.
    setLastAppMode("big-picture");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("con perfil activo, escribir sin id explícito va a ese perfil", () => {
    vi.spyOn(localProfiles, "getActiveProfileId").mockReturnValue("perfil-1");
    setLastAppMode("big-picture");
    expect(getLastAppMode("perfil-1")).toBe("big-picture");
  });

  it("un perfil sin memoria propia hereda la semilla global (migración)", () => {
    localStorage.setItem(KEY, "big-picture");
    expect(getLastAppMode("perfil-2")).toBe("big-picture");

    // …pero en cuanto el perfil guarda lo suyo, deja de mirar la semilla.
    setLastAppMode("normal", "perfil-2");
    expect(getLastAppMode("perfil-2")).toBe("normal");
    expect(getLastAppMode("perfil-3")).toBe("big-picture");
  });

  it("ignora valores corruptos", () => {
    localStorage.setItem(`${KEY}:perfil-1`, "tv");
    expect(getLastAppMode("perfil-1")).toBeNull();
    localStorage.setItem(KEY, "tv");
    expect(getLastAppMode()).toBeNull();
  });

  it("detecta rutas big picture", () => {
    expect(isBigPicturePath("/big-picture")).toBe(true);
    expect(isBigPicturePath("/big-picture/detail/movie/x")).toBe(true);
    expect(isBigPicturePath("/home")).toBe(false);
  });

  it("consolida big-picture y normal, ignora transitorias", () => {
    expect(resolveAppModeForPath("/big-picture")).toBe("big-picture");
    expect(resolveAppModeForPath("/big-picture/settings")).toBe("big-picture");
    expect(resolveAppModeForPath("/home")).toBe("normal");
    expect(resolveAppModeForPath("/channels")).toBe("normal");
    expect(resolveAppModeForPath("/big-picture/channels")).toBe("big-picture");
    expect(resolveAppModeForPath("/detail/movie/tt123")).toBe("normal");
    expect(resolveAppModeForPath("/")).toBeNull();
    expect(resolveAppModeForPath("/profiles")).toBeNull();
    expect(resolveAppModeForPath("/quick-start/profile")).toBeNull();
  });

  it("programa la marca solo al arrancar desde la raíz en una sesión Big Picture con perfil", () => {
    expect(shouldShowBigPictureBrandOnStartup("/", "big-picture", true)).toBe(true);
    expect(shouldShowBigPictureBrandOnStartup("/", "normal", true)).toBe(false);
    expect(shouldShowBigPictureBrandOnStartup("/", "big-picture", false)).toBe(false);
    expect(shouldShowBigPictureBrandOnStartup("/home", "big-picture", true)).toBe(false);
    expect(shouldShowBigPictureBrandOnStartup("/profiles", "big-picture", true)).toBe(false);
  });
});
