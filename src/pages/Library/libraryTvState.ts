import type { MediaItem } from "../../types/ui";
import { getScopedStorageKey } from "../../utils/localProfiles";

export interface DiscoverReturnState {
  selectionKey: string;
  items: MediaItem[];
  visibleCount: number;
  page: number;
  hasMore: boolean;
}

export interface LibraryReturnState {
  tab: "library" | "discover";
  itemKey: string;
  scrollTop: number;
  discover?: DiscoverReturnState;
}

const RETURN_KEY = "aetherio-library-tv-return-v2";

export function readLibraryReturn(): LibraryReturnState | null {
  try {
    const raw = sessionStorage.getItem(getScopedStorageKey(RETURN_KEY));
    if (!raw) return null;
    const state = JSON.parse(raw) as LibraryReturnState;
    if ((state.tab !== "library" && state.tab !== "discover") || typeof state.itemKey !== "string") return null;
    if (!Number.isFinite(state.scrollTop) || state.scrollTop < 0) return null;
    if (state.discover && (!Array.isArray(state.discover.items) || !Number.isFinite(state.discover.visibleCount)
      || !Number.isFinite(state.discover.page) || typeof state.discover.selectionKey !== "string")) return null;
    return state;
  } catch {
    return null;
  }
}

export function clearLibraryReturn() {
  try { sessionStorage.removeItem(getScopedStorageKey(RETURN_KEY)); } catch { /* best effort */ }
}

export function saveLibraryReturn(state: Omit<LibraryReturnState, "scrollTop">) {
  try {
    const shell = document.querySelector<HTMLElement>("[data-aetherio-big-picture] [data-aetherio-scroll-shell]");
    sessionStorage.setItem(getScopedStorageKey(RETURN_KEY), JSON.stringify({ ...state, scrollTop: shell?.scrollTop ?? 0 }));
  } catch {
    // Abrir la ficha nunca depende de que haya espacio en sessionStorage.
  }
}
