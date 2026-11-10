import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PLAYBACK_PREFERENCES,
  getPlaybackPreferences,
  PLAYBACK_PREFERENCES_STORAGE_KEY,
} from "./playbackPreferences";

function mockStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  };
  vi.stubGlobal("localStorage", storage);
  return store;
}

describe("defaults de seleccion de stream (instalacion limpia / nuevos usuarios)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockStorage();
  });

  it("instalacion limpia: Reutilizar ultimo enlace ON + Modo Manual", () => {
    const prefs = getPlaybackPreferences();
    expect(prefs.reuseLastLink).toBe(true);
    expect(prefs.sourceSelectionMode).toBe("manual");
  });

  it("constantes DEFAULT coinciden con la captura de Ajustes", () => {
    expect(DEFAULT_PLAYBACK_PREFERENCES.reuseLastLink).toBe(true);
    expect(DEFAULT_PLAYBACK_PREFERENCES.sourceSelectionMode).toBe("manual");
  });

  it("prefs legacy sin esas claves: se rellenan con los defaults", () => {
    mockStorage({
      [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ firstAudioLanguage: "eng" }),
    });
    const prefs = getPlaybackPreferences();
    expect(prefs.reuseLastLink).toBe(true);
    expect(prefs.sourceSelectionMode).toBe("manual");
    expect(prefs.firstAudioLanguage).toBe("eng");
  });

  it("valor de modo invalido: se normaliza a manual", () => {
    mockStorage({
      [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ sourceSelectionMode: "auto" }),
    });
    expect(getPlaybackPreferences().sourceSelectionMode).toBe("manual");
  });

  it("usuario existente que eligio primera fuente: se respeta su eleccion", () => {
    mockStorage({
      [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ sourceSelectionMode: "first", reuseLastLink: false }),
    });
    const prefs = getPlaybackPreferences();
    expect(prefs.sourceSelectionMode).toBe("first");
    expect(prefs.reuseLastLink).toBe(false);
  });

  it("la recuperación automática de fuentes está desactivada por defecto, también en perfiles existentes", () => {
    expect(DEFAULT_PLAYBACK_PREFERENCES.automaticSourceRecovery).toBe(false);
    expect(getPlaybackPreferences().automaticSourceRecovery).toBe(false);
    mockStorage({
      [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ firstAudioLanguage: "eng", sourceSelectionMode: "first" }),
    });
    expect(getPlaybackPreferences().automaticSourceRecovery).toBe(false);
  });

  it("conserva una elección explícita de recuperación automática", () => {
    mockStorage({
      [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ automaticSourceRecovery: true }),
    });
    expect(getPlaybackPreferences().automaticSourceRecovery).toBe(true);
  });
});

describe("Auto Sync automatico", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockStorage();
  });

  it("por defecto sincroniza todos los titulos automaticamente", () => {
    expect(getPlaybackPreferences().autoSubtitleSync).toBe("on");
    expect(DEFAULT_PLAYBACK_PREFERENCES.autoSubtitleSync).toBe("on");
  });

  it("las preferencias legacy sin la clave quedan en modo siempre", () => {
    mockStorage({ [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ firstAudioLanguage: "eng" }) });
    expect(getPlaybackPreferences().autoSubtitleSync).toBe("on");
  });

  it("respeta los tres modos validos y descarta los demas", () => {
    for (const mode of ["on", "off", "learned"] as const) {
      mockStorage({ [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ autoSubtitleSync: mode }) });
      expect(getPlaybackPreferences().autoSubtitleSync).toBe(mode);
    }
    mockStorage({ [PLAYBACK_PREFERENCES_STORAGE_KEY]: JSON.stringify({ autoSubtitleSync: "siempre" }) });
    expect(getPlaybackPreferences().autoSubtitleSync).toBe("on");
  });
});
