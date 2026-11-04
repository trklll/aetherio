import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLibraryReturn, readLibraryReturn, saveLibraryReturn } from "./libraryTvState";

const scope = vi.hoisted(() => ({ profile: "first" }));
vi.mock("../../utils/localProfiles", () => ({
  getScopedStorageKey: (key: string) => `${scope.profile}:${key}`,
}));

describe("library TV return state", () => {
  let values: Map<string, string>;
  let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
  const key = "first:aetherio-library-tv-return-v2";

  beforeEach(() => {
    scope.profile = "first";
    values = new Map();
    storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    };
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("document", { querySelector: vi.fn(() => ({ scrollTop: 640 })) });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("stores the card and real scroll position before opening a detail", () => {
    saveLibraryReturn({ tab: "library", itemKey: "movie:tmdb:1" });
    expect(readLibraryReturn()).toEqual({ tab: "library", itemKey: "movie:tmdb:1", scrollTop: 640 });
    clearLibraryReturn();
    expect(readLibraryReturn()).toBeNull();
  });

  it("preserves loaded discovery pages and the visible batch", () => {
    const discover = { selectionKey: "movie|popular|Drama", items: [{ id: "tmdb:2", type: "movie", name: "Drama" }],
      visibleCount: 40, page: 2, hasMore: true };
    saveLibraryReturn({ tab: "discover", itemKey: "movie:tmdb:2", discover });
    expect(readLibraryReturn()?.discover).toEqual(discover);
  });

  it("does not leak return context between profiles", () => {
    saveLibraryReturn({ tab: "library", itemKey: "movie:tmdb:1" });
    scope.profile = "second";
    expect(readLibraryReturn()).toBeNull();
    clearLibraryReturn();
    scope.profile = "first";
    expect(readLibraryReturn()?.itemKey).toBe("movie:tmdb:1");
  });

  it.each([
    "{", "null", "{}",
    JSON.stringify({ tab: "other", itemKey: "x", scrollTop: 0 }),
    JSON.stringify({ tab: "library", itemKey: 5, scrollTop: 0 }),
    JSON.stringify({ tab: "library", itemKey: "x", scrollTop: -1 }),
    JSON.stringify({ tab: "library", itemKey: "x", scrollTop: "30" }),
    JSON.stringify({ tab: "discover", itemKey: "x", scrollTop: 0, discover: { items: null } }),
    JSON.stringify({ tab: "discover", itemKey: "x", scrollTop: 0, discover: { items: [], visibleCount: "20" } }),
    JSON.stringify({ tab: "discover", itemKey: "x", scrollTop: 0, discover: { items: [], visibleCount: 20, page: null } }),
    JSON.stringify({ tab: "discover", itemKey: "x", scrollTop: 0, discover: { items: [], visibleCount: 20, page: 1 } }),
  ])("ignores malformed or stale cache: %s", raw => {
    values.set(key, raw);
    expect(readLibraryReturn()).toBeNull();
  });

  it("does not prevent navigation when browser storage is unavailable", () => {
    storage.setItem.mockImplementation(() => { throw new Error("quota"); });
    storage.getItem.mockImplementation(() => { throw new Error("blocked"); });
    storage.removeItem.mockImplementation(() => { throw new Error("blocked"); });
    expect(() => saveLibraryReturn({ tab: "library", itemKey: "movie:tmdb:1" })).not.toThrow();
    expect(readLibraryReturn()).toBeNull();
    expect(clearLibraryReturn).not.toThrow();
  });

  it("uses the top of the page when there is no scroll shell", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    saveLibraryReturn({ tab: "library", itemKey: "movie:tmdb:1" });
    expect(readLibraryReturn()?.scrollTop).toBe(0);
  });
});
