import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  getLastAppMode,
  isBigPicturePath,
  resolveAppModeForPath,
  setLastAppMode,
  shouldShowBigPictureBrandOnStartup,
} from "./appMode.ts";

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
  });

  it("sin dato guardado devuelve null", () => {
    expect(getLastAppMode()).toBeNull();
  });

  it("persiste y lee el último modo", () => {
    setLastAppMode("big-picture");
    expect(getLastAppMode()).toBe("big-picture");
    setLastAppMode("normal");
    expect(getLastAppMode()).toBe("normal");
  });

  it("ignora valores corruptos", () => {
    localStorage.setItem("aetherio-last-app-mode-v1", "tv");
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
