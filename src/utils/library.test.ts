import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLibraryTombstones,
  isInLibrary,
  mergeSavedLibraryItems,
  readSavedLibrary,
  tryAddToLibrary,
  tryRemoveFromLibrary,
} from "./library";

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

function stubExperienceGlobals() {
  vi.stubGlobal("localStorage", createStorage());
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("CustomEvent", class {
    type: string;

    constructor(type: string) {
      this.type = type;
    }
  });
}

const item = { type: "series", id: "tmdb:42", name: "Serie de prueba" };

/** Formato real de mediaRefKey: JSON.stringify([kind, namespace, addonId, id]). */
function libraryKey(id: string) {
  return JSON.stringify(["series", "tmdb", "", id]);
}
describe("library tombstones", () => {
  beforeEach(stubExperienceGlobals);
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a removed title deleted when a remote push resurrects it", () => {
    tryAddToLibrary(item);
    expect(tryRemoveFromLibrary(item.type, item.id).ok).toBe(true);
    expect(readSavedLibrary()).toHaveLength(0);

    // Otro dispositivo empuja su copia con el título añadido antes del borrado:
    // la unión lo resucita y la lápida local lo vuelve a quitar.
    mergeSavedLibraryItems([{ ...item, addedAt: Date.now() - 60_000 }]);
    expect(readSavedLibrary()).toHaveLength(1);

    applyLibraryTombstones([{ key: libraryKey("42"), deletedAt: Date.now() }]);
    expect(readSavedLibrary()).toHaveLength(0);
  });

  it("lets a title re-added after its deletion survive remote tombstones", async () => {
    tryAddToLibrary({ ...item, id: "tmdb:43" });
    expect(tryRemoveFromLibrary("series", "tmdb:43").ok).toBe(true);

    // Re-añadido posterior al borrado (el borrado fue antes de esta espera).
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(tryAddToLibrary({ ...item, id: "tmdb:43" }).ok).toBe(true);
    expect(isInLibrary("series", "tmdb:43")).toBe(true);

    // Lápida remota anterior al re-añadido: el título sobrevive.
    applyLibraryTombstones([{ key: libraryKey("43"), deletedAt: Date.now() - 15 }]);
    expect(isInLibrary("series", "tmdb:43")).toBe(true);
  });

  it("removes a title when the remote tombstone is newer than its addedAt", () => {
    tryAddToLibrary({ ...item, id: "tmdb:44" });
    const [saved] = readSavedLibrary();
    if (!saved) throw new Error("Expected saved item");

    applyLibraryTombstones([{ key: libraryKey("44"), deletedAt: saved.addedAt + 5000 }]);
    expect(readSavedLibrary()).toHaveLength(0);
  });
});
