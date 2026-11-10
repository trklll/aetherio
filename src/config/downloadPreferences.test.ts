import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOWNLOADS_ENABLED_CHANGED_EVENT,
  DOWNLOADS_ENABLED_STORAGE_KEY,
  getDownloadsEnabled,
  saveDownloadsEnabled,
} from "./downloadPreferences";

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

describe("preferencia de descargas", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockStorage();
  });

  it("mantiene las descargas desactivadas en una instalación limpia", () => {
    expect(getDownloadsEnabled()).toBe(false);
  });

  it("solo acepta una activación explícita y conserva el valor", () => {
    saveDownloadsEnabled(true);

    expect(localStorage.getItem(DOWNLOADS_ENABLED_STORAGE_KEY)).toBe("true");
    expect(getDownloadsEnabled()).toBe(true);

    saveDownloadsEnabled(false);
    expect(getDownloadsEnabled()).toBe(false);
  });

  it("trata valores almacenados inválidos como desactivados", () => {
    mockStorage({ [DOWNLOADS_ENABLED_STORAGE_KEY]: "yes" });

    expect(getDownloadsEnabled()).toBe(false);
  });

  it("emite un evento para actualizar las superficies abiertas", () => {
    const listener = vi.fn();
    const target = new EventTarget();
    class TestCustomEvent<T> extends Event {
      detail: T;

      constructor(type: string, init: { detail: T }) {
        super(type);
        this.detail = init.detail;
      }
    }
    vi.stubGlobal("window", target);
    vi.stubGlobal("CustomEvent", TestCustomEvent);
    window.addEventListener(DOWNLOADS_ENABLED_CHANGED_EVENT, listener);

    saveDownloadsEnabled(true);

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as TestCustomEvent<boolean>).detail).toBe(true);
    window.removeEventListener(DOWNLOADS_ENABLED_CHANGED_EVENT, listener);
  });
});
