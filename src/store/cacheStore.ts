import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CatalogRowData, MediaItem } from "../types/ui";
import { getScopedStorageKey } from "../utils/localProfiles";

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
      partialize: state => ({ home: state.home }),
    }
  )
);

export function isFreshHomeCache(updatedAt: number) {
  return updatedAt > 0 && Date.now() - updatedAt < HOME_CACHE_MAX_AGE;
}
