import type { MediaItem } from "../types/ui";
import { getScopedStorageKey } from "./localProfiles";

export interface SavedLibraryItem extends MediaItem {
  addedAt: number;
}

const LIBRARY_KEY = "aetherio-saved-library-v1";
export const LIBRARY_CHANGED_EVENT = "aetherio-library-changed";

export function readSavedLibrary(): SavedLibraryItem[] {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(LIBRARY_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is SavedLibraryItem => (
          typeof item?.id === "string"
          && typeof item?.type === "string"
          && typeof item?.name === "string"
          && typeof item?.addedAt === "number"
        ))
      : [];
  } catch {
    return [];
  }
}

export function isInLibrary(type: string, id: string) {
  const key = mediaKey(type, id);
  return readSavedLibrary().some(item => mediaKey(item.type, item.id) === key);
}

export function addToLibrary(item: MediaItem) {
  const items = readSavedLibrary();
  const key = mediaKey(item.type, item.id);
  const next: SavedLibraryItem = {
    ...item,
    type: normalizeType(item.type),
    addedAt: Date.now(),
  };
  const index = items.findIndex(current => mediaKey(current.type, current.id) === key);
  if (index >= 0) items[index] = { ...items[index], ...next };
  else items.unshift(next);
  writeSavedLibrary(items);
}

export function removeFromLibrary(type: string, id: string) {
  const key = mediaKey(type, id);
  writeSavedLibrary(readSavedLibrary().filter(item => mediaKey(item.type, item.id) !== key));
}

export function toggleLibraryItem(item: MediaItem) {
  if (isInLibrary(item.type, item.id)) {
    removeFromLibrary(item.type, item.id);
    return false;
  }
  addToLibrary(item);
  return true;
}

function writeSavedLibrary(items: SavedLibraryItem[]) {
  localStorage.setItem(getScopedStorageKey(LIBRARY_KEY), JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
}

function mediaKey(type: string, id: string) {
  return `${normalizeType(type)}:${id}`;
}

function normalizeType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "tv" || normalized === "show" || normalized === "anime" ? "series" : normalized;
}
