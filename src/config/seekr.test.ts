import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSeekrApiKey,
  isValidSeekrApiKey,
  readSeekrApiKey,
  saveSeekrApiKey,
  SEEKR_API_KEY_STORAGE_KEY,
} from "./seekr";

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

describe("clave de Seekr en almacenamiento seguro", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    // El .env.local de quien desarrolla puede traer VITE_SEEKR_API_KEY; los tests
    // no pueden depender de eso.
    vi.stubEnv("VITE_SEEKR_API_KEY", "");
    mockStorage();
  });

  it("sin clave guardada devuelve cadena vacia", async () => {
    expect(await readSeekrApiKey()).toBe("");
  });

  it("guarda y vuelve a leer la clave", async () => {
    await saveSeekrApiKey("seekr-live-1234567890");
    expect(await readSeekrApiKey()).toBe("seekr-live-1234567890");
  });

  it("normaliza espacios al guardar", async () => {
    await saveSeekrApiKey("  seekr-live-1234567890  ");
    expect(await readSeekrApiKey()).toBe("seekr-live-1234567890");
  });

  it("rechaza claves demasiado cortas, largas o con saltos de linea", async () => {
    await expect(saveSeekrApiKey("corto")).rejects.toThrow(/invalida/i);
    await expect(saveSeekrApiKey("x".repeat(513))).rejects.toThrow(/invalida/i);
    await expect(saveSeekrApiKey("seekr-live\r\nInjected: 1")).rejects.toThrow(/invalida/i);
    await expect(saveSeekrApiKey("   ")).rejects.toThrow(/invalida/i);
  });

  it("borra la clave guardada", async () => {
    await saveSeekrApiKey("seekr-live-1234567890");
    await clearSeekrApiKey();
    expect(await readSeekrApiKey()).toBe("");
  });

  it("usa la variable de entorno cuando no hay clave guardada", async () => {
    vi.stubEnv("VITE_SEEKR_API_KEY", "seekr-env-1234567890");
    expect(await readSeekrApiKey()).toBe("seekr-env-1234567890");
  });

  it("sin clave de compilacion usa la guardada en el almacen", async () => {
    await saveSeekrApiKey("seekr-live-1234567890");
    expect(await readSeekrApiKey()).toBe("seekr-live-1234567890");
  });

  it("la clave de compilacion manda sobre la guardada", async () => {
    // La de compilacion es una respuesta inmediata; consultar el Credential
    // Manager para después descartarla solo introduce un cuelgue posible.
    await saveSeekrApiKey("seekr-live-1234567890");
    vi.stubEnv("VITE_SEEKR_API_KEY", "seekr-env-1234567890");
    expect(await readSeekrApiKey()).toBe("seekr-env-1234567890");
  });

  it("valida el mismo rango que el backend de Tauri", () => {
    expect(isValidSeekrApiKey("seekr-live-1234567890")).toBe(true);
    expect(isValidSeekrApiKey("1234567")).toBe(false);
    expect(isValidSeekrApiKey("x".repeat(513))).toBe(false);
    expect(isValidSeekrApiKey("clave\ncon salto")).toBe(false);
  });

  it("usa una clave de almacenamiento distinta a las de AniList y cuenta", () => {
    expect(SEEKR_API_KEY_STORAGE_KEY).toBe("aetherio-seekr-api-key");
  });
});
