import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { CatalogRowData, MediaItem } from "../types/ui.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

interface HomeCacheSnapshot {
  rows: CatalogRowData[];
  heroItems: MediaItem[];
  rowsSignature: string;
  heroSignature: string;
  rowsUpdatedAt: number;
  heroUpdatedAt: number;
}

interface CacheStore {
  home: HomeCacheSnapshot | null;
  setHomeRows: (rows: CatalogRowData[], signature: string) => void;
  setHomeHero: (heroItems: MediaItem[], signature: string) => void;
  clearHome: () => void;
}

export const HOME_CACHE_MAX_AGE = 1000 * 60 * 60 * 24;
// The starter Home currently includes the base, anime-decade and ten
// streaming-provider rails. Keep the complete set across app restarts.
const HOME_CACHE_MAX_ROWS = 32;
const HOME_CACHE_MAX_ROW_ITEMS = 16;
const HOME_CACHE_MAX_HERO_ITEMS = 16;

const safeLocalStorage: StateStorage = {
  getItem: name => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      if (isQuotaExceededError(error)) {
        try {
          localStorage.removeItem(name);
        } catch {
          // The cache is optional; failing to clear it should not break rendering.
        }
        console.warn("[AETHERIO:CACHE] home cache skipped because localStorage quota is full");
        return;
      }
      console.warn("[AETHERIO:CACHE] home cache persist failed", error);
    }
  },
  removeItem: name => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Optional cache cleanup.
    }
  },
};

export const useCacheStore = create<CacheStore>()(
  persist(
    (set, get) => ({
      home: null,
      setHomeRows: (rows, signature) => {
        const current = get().home;
        set({
          home: {
            rows,
            heroItems: current?.heroItems ?? [],
            rowsSignature: signature,
            heroSignature: current?.heroSignature ?? "",
            rowsUpdatedAt: Date.now(),
            heroUpdatedAt: current?.heroUpdatedAt ?? 0,
          },
        });
      },
      setHomeHero: (heroItems, signature) => {
        const current = get().home;
        set({
          home: {
            rows: current?.rows ?? [],
            heroItems,
            rowsSignature: current?.rowsSignature ?? "",
            heroSignature: signature,
            rowsUpdatedAt: current?.rowsUpdatedAt ?? 0,
            heroUpdatedAt: Date.now(),
          },
        });
      },
      clearHome: () => set({ home: null }),
    }),
    {
      name: getScopedStorageKey("aetherio-home-cache-v1"),
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: state => ({ home: compactHomeCache(state.home) }),
    }
  )
);

export function isFreshHomeCache(updatedAt: number) {
  return updatedAt > 0 && Date.now() - updatedAt < HOME_CACHE_MAX_AGE;
}

function compactHomeCache(home: HomeCacheSnapshot | null): HomeCacheSnapshot | null {
  if (!home) return null;
  return {
    ...home,
    rows: home.rows.slice(0, HOME_CACHE_MAX_ROWS).map(row => ({
      ...row,
      items: row.items.slice(0, HOME_CACHE_MAX_ROW_ITEMS),
    })),
    heroItems: home.heroItems.slice(0, HOME_CACHE_MAX_HERO_ITEMS),
  };
}

function isQuotaExceededError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}
