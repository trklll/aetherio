import type { MediaItem } from "../types/ui";
import { captureExperienceScope, getScopedStorageKey } from "./localProfiles";
import { MediaIdentityError, mediaRefFromLegacy, mediaRefKey } from "../domain/mediaIdentity";
import { recoverExperienceJournal, writeExperienceJSON } from "../domain/experienceStorage";
import { storageFailure, type StorageResult } from "../domain/storageResult";

export interface SavedLibraryItem extends MediaItem {
  addedAt: number;
}

const LIBRARY_KEY = "aetherio-saved-library-v1";
export const LIBRARY_CHANGED_EVENT = "aetherio-library-changed";

export function readSavedLibrary(): SavedLibraryItem[] {
  try {
    recoverExperienceJournal();
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
  // Identidades no normalizables (p. ej. "live"/"sports-replay" en tarjetas de
  // deportes) nunca están en la biblioteca: un crash aquí rompería cada render.
  let key: string;
  try {
    key = mediaKey(type, id);
  } catch {
    return false;
  }
  return readSavedLibrary().some(item => {
    try { return mediaKey(item.type, item.id) === key; }
    catch { return false; }
  });
}

export function addToLibrary(item: MediaItem) {
  tryAddToLibrary(item);
}

export function tryAddToLibrary(item: MediaItem): StorageResult {
  let key: string;
  try {
    key = mediaKey(item.type, item.id);
  } catch (error) {
    return storageFailure(error instanceof MediaIdentityError ? "invalid-identity" : "invalid-data", error);
  }
  const items = readSavedLibrary();
  const next: SavedLibraryItem = {
    ...item,
    type: normalizeType(item.type),
    addedAt: Date.now(),
  };
  const index = items.findIndex(current => {
    try { return mediaKey(current.type, current.id) === key; }
    catch { return false; }
  });
  if (index >= 0) items[index] = { ...items[index], ...next };
  else items.unshift(next);
  return writeSavedLibrary(items);
}

export function removeFromLibrary(type: string, id: string) {
  tryRemoveFromLibrary(type, id);
}

export function tryRemoveFromLibrary(type: string, id: string): StorageResult {
  let key: string;
  try {
    key = mediaKey(type, id);
  } catch (error) {
    return storageFailure(error instanceof MediaIdentityError ? "invalid-identity" : "invalid-data", error);
  }
  return writeSavedLibrary(readSavedLibrary().filter(item => {
    try { return mediaKey(item.type, item.id) !== key; }
    catch { return true; }
  }));
}

export function toggleLibraryItem(item: MediaItem) {
  if (isInLibrary(item.type, item.id)) {
    removeFromLibrary(item.type, item.id);
    return false;
  }
  addToLibrary(item);
  return true;
}

function writeSavedLibrary(items: SavedLibraryItem[]): StorageResult {
  return writeExperienceJSON(captureExperienceScope(), LIBRARY_KEY, items, [LIBRARY_CHANGED_EVENT]);
}

function mediaKey(type: string, id: string) {
  return mediaRefKey(mediaRefFromLegacy({ type, id }));
}

function normalizeType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "tv" || normalized === "show" ? "series" : normalized;
}
