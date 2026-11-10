import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addToLibrary,
  isInLibrary,
  readSavedLibrary,
  tryAddToLibrary,
  tryRemoveFromLibrary,
} from "./library";
import type { MediaItem } from "../types/ui";

function createStorage() {
  const values = new Map<string, string>();
  let failingKey: string | null = null;
  let failNext = false;
  return {
    values,
    failOnce(key: string) { failingKey = key; failNext = true; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (failNext && key === failingKey) {
        failNext = false;
        throw new DOMException("quota", "QuotaExceededError");
      }
      values.set(key, String(value));
    },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    get length() { return values.size; },
  } as Storage & { values: Map<string, string>; failOnce(key: string): void };
}

const item = (type: string, id: string): MediaItem => ({ id, type, name: `${type}-${id}` });

describe("library persistence adapters", () => {
  let storage: ReturnType<typeof createStorage>;
  let dispatchEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = createStorage();
    dispatchEvent = vi.fn();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { dispatchEvent, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      constructor(type: string) { this.type = type; }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps movie and series with the same provider id as separate library records", () => {
    addToLibrary(item("movie", "tmdb:123"));
    addToLibrary(item("series", "tmdb:123"));

    expect(readSavedLibrary()).toHaveLength(2);
    expect(isInLibrary("movie", "tmdb:123")).toBe(true);
    expect(isInLibrary("series", "tmdb:123")).toBe(true);
  });

  it("does not collapse two anime deliveries that have distinct MAL ids", () => {
    addToLibrary(item("anime", "mal:101"));
    addToLibrary(item("anime", "mal:202"));
    expect(readSavedLibrary().map(saved => saved.id)).toEqual(["mal:202", "mal:101"]);
  });

  it("returns a typed failure without emitting a success event when storage rejects a write", () => {
    storage.failOnce("aetherio-saved-library-v1");

    const result = tryAddToLibrary(item("movie", "tmdb:123"));
    expect(result).toMatchObject({ ok: false, code: "storage-unavailable" });
    expect(readSavedLibrary()).toEqual([]);
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).not.toContain("aetherio-library-changed");
  });

  it("rejects invalid identities instead of sharing a blank key", () => {
    const result = tryAddToLibrary({ id: "", type: "", name: "Sin identidad" });
    expect(result).toEqual({ ok: false, code: "invalid-identity" });
    expect(readSavedLibrary()).toEqual([]);
  });

  it("treats non-normalizable identities as not in the library instead of throwing", () => {
    addToLibrary(item("movie", "tmdb:123"));

    expect(isInLibrary("live", "bein:1")).toBe(false);
    expect(isInLibrary("sports-replay", "match-1")).toBe(false);
    expect(isInLibrary("movie", "")).toBe(false);
    expect(isInLibrary("movie", "tmdb:123")).toBe(true);
  });

  it("keeps the legacy void writer and provides a result from the try variant", () => {
    expect(tryAddToLibrary(item("movie", "tmdb:456")).ok).toBe(true);
    expect(addToLibrary(item("series", "tmdb:456"))).toBeUndefined();
    expect(tryRemoveFromLibrary("movie", "tmdb:456").ok).toBe(true);
    expect(readSavedLibrary().map(saved => saved.type)).toEqual(["series"]);
  });
});
