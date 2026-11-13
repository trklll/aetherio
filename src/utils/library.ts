import type { LibraryStatus, MediaItem } from "../types/ui";
import { captureExperienceScope, getScopedStorageKey } from "./localProfiles";
import { MediaIdentityError, mediaRefFromLegacy, mediaRefKey } from "../domain/mediaIdentity";
import { recoverExperienceJournal, writeExperienceJSON } from "../domain/experienceStorage";
import {
  clearDeletionTombstone,
  isDeletionTombstone,
  mergeDeletionTombstones,
  recordDeletionTombstone,
  replaceDeletionTombstones,
} from "../domain/tombstones";
import { storageFailure, type StorageResult } from "../domain/storageResult";

export interface SavedLibraryItem extends MediaItem {
  addedAt: number;
}

const LIBRARY_KEY = "aetherio-saved-library-v1";
const TOMBSTONES_KEY = "aetherio-library-tombstones-v1";
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

export function getSavedLibraryRating(type: string, id: string): number | null {
  let key: string;
  try {
    key = mediaKey(type, id);
  } catch {
    return null;
  }
  const item = readSavedLibrary().find(saved => {
    try { return mediaKey(saved.type, saved.id) === key; }
    catch { return false; }
  });
  return typeof item?.userRating === "number" && Number.isFinite(item.userRating)
    ? item.userRating
    : null;
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
    libraryStatus: item.libraryStatus === "watched" ? "watched" : "to_watch",
    addedAt: Date.now(),
  };
  const index = items.findIndex(current => {
    try { return mediaKey(current.type, current.id) === key; }
    catch { return false; }
  });
  if (index >= 0) items[index] = { ...items[index], ...next };
  else items.unshift(next);
  const result = writeSavedLibrary(items);
  if (result.ok) clearDeletionTombstone(TOMBSTONES_KEY, key);
  return result;
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
  const result = writeSavedLibrary(readSavedLibrary().filter(item => {
    try { return mediaKey(item.type, item.id) !== key; }
    catch { return true; }
  }));
  if (result.ok) recordDeletionTombstone(TOMBSTONES_KEY, key);
  return result;
}

export function toggleLibraryItem(item: MediaItem) {
  if (isInLibrary(item.type, item.id)) {
    removeFromLibrary(item.type, item.id);
    return false;
  }
  addToLibrary(item);
  return true;
}

/**
 * Fusiona una biblioteca remota (respaldo de Google Drive): unión por
 * identidad normalizada; en duplicados gana el añadido más reciente. La baja
 * de un título no se propaga entre dispositivos en este MVP (la unión la
 * resucita), misma limitación que tienen los respaldos de solo unión.
 */
export function mergeSavedLibraryItems(remoteItems: SavedLibraryItem[]) {
  if (!Array.isArray(remoteItems) || !remoteItems.length) return;
  const byKey = new Map<string, SavedLibraryItem>();
  for (const item of readSavedLibrary()) {
    try { byKey.set(mediaKey(item.type, item.id), item); }
    catch { continue; }
  }
  let changed = false;
  for (const item of remoteItems) {
    if (typeof item?.id !== "string" || typeof item?.type !== "string" || typeof item?.name !== "string") continue;
    if (typeof item?.addedAt !== "number" || !Number.isFinite(item.addedAt)) continue;
    let key: string;
    try { key = mediaKey(item.type, item.id); }
    catch { continue; }
    const normalized: SavedLibraryItem = { ...item, type: normalizeType(item.type) };
    const current = byKey.get(key);
    if (!current || item.addedAt > current.addedAt) {
      byKey.set(key, current ? { ...current, ...normalized } : normalized);
      changed = true;
    }
  }
  if (!changed) return;
  const next = Array.from(byKey.values()).sort((a, b) => b.addedAt - a.addedAt);
  writeSavedLibrary(next);
}

/** Import-only union: existing entries always win and are never overwritten. */
export function addMissingLibraryItems(importedItems: MediaItem[]) {
  if (!Array.isArray(importedItems) || !importedItems.length) return 0;
  const items = readSavedLibrary();
  const keys = new Set<string>();
  const indexByKey = new Map<string, number>();
  items.forEach((item, index) => {
    try {
      const key = mediaKey(item.type, item.id);
      keys.add(key);
      indexByKey.set(key, index);
    }
    catch { /* Ignore malformed legacy entries. */ }
  });
  const added: SavedLibraryItem[] = [];
  const addedKeys: string[] = [];
  const addedAt = Date.now();
  let metadataAdded = false;
  for (const item of importedItems) {
    if (!item || typeof item.id !== "string" || typeof item.type !== "string" || typeof item.name !== "string") continue;
    let key: string;
    try { key = mediaKey(item.type, item.id); }
    catch { continue; }
    if (keys.has(key)) {
      const currentIndex = indexByKey.get(key);
      const current = currentIndex == null ? undefined : items[currentIndex];
      if (current && current.userRating == null && typeof item.userRating === "number" && Number.isFinite(item.userRating)) {
        items[currentIndex!] = { ...current, userRating: item.userRating };
        metadataAdded = true;
      }
      if (current && item.libraryStatus === "watched" && current.libraryStatus !== "watched") {
        items[currentIndex!] = { ...items[currentIndex!], libraryStatus: "watched" };
        metadataAdded = true;
      } else if (current && !current.libraryStatus && item.libraryStatus === "to_watch") {
        items[currentIndex!] = { ...items[currentIndex!], libraryStatus: "to_watch" };
        metadataAdded = true;
      }
      continue;
    }
    keys.add(key);
    addedKeys.push(key);
    added.push({ ...item, type: normalizeType(item.type), addedAt });
  }
  if (!added.length && !metadataAdded) return 0;
  const result = writeSavedLibrary([...added, ...items]);
  if (!result.ok) throw new Error("No se pudo guardar la biblioteca importada.");
  for (const key of addedKeys) clearDeletionTombstone(TOMBSTONES_KEY, key);
  return added.length;
}

export function setLibraryStatus(type: string, id: string, status: LibraryStatus): boolean {
  let key: string;
  try { key = mediaKey(type, id); }
  catch { return false; }
  const items = readSavedLibrary();
  const index = items.findIndex(item => {
    try { return mediaKey(item.type, item.id) === key; }
    catch { return false; }
  });
  if (index < 0 || items[index].libraryStatus === status) return index >= 0;
  items[index] = { ...items[index], libraryStatus: status };
  return writeSavedLibrary(items).ok;
}

/** Persist TMDB artwork resolved later for an existing library entry. */
export function updateSavedLibraryArtwork(type: string, id: string, poster: string) {
  if (!poster) return false;
  const items = readSavedLibrary();
  const key = mediaKey(type, id);
  const index = items.findIndex(item => {
    try { return mediaKey(item.type, item.id) === key; }
    catch { return false; }
  });
  if (index < 0 || items[index].poster === poster) return false;
  items[index] = { ...items[index], poster, originalPoster: poster };
  return writeSavedLibrary(items).ok;
}

/**
 * Aplica lápidas remotas (Google Drive) a la biblioteca ya fusionada: un
 * borrado gana si es posterior al `addedAt` del título; un re-añadido posterior
 * sobrevive y retira la lápida para que deje de circular entre dispositivos.
 */
export function applyLibraryTombstones(remoteTombstones: unknown) {
  if (!Array.isArray(remoteTombstones)) return;
  const tombstones = mergeDeletionTombstones(TOMBSTONES_KEY, remoteTombstones.filter(isDeletionTombstone));
  if (!tombstones.length) return;
  const tombstoneByKey = new Map(tombstones.map(tombstone => [tombstone.key, tombstone] as const));

  const items = readSavedLibrary().filter(item => {
    let key: string;
    try { key = mediaKey(item.type, item.id); }
    catch { return true; }
    const tombstone = tombstoneByKey.get(key);
    if (!tombstone) return true;
    return item.addedAt > tombstone.deletedAt;
  });
  writeSavedLibrary(items);

  // Las lápidas cuyo título sobrevivió (re-añadido más nuevo) dejan de circular.
  const survivingKeys = new Set<string>();
  for (const item of items) {
    try {
      const key = mediaKey(item.type, item.id);
      const tombstone = tombstoneByKey.get(key);
      if (tombstone && item.addedAt > tombstone.deletedAt) survivingKeys.add(key);
    } catch { continue; }
  }
  if (survivingKeys.size) {
    replaceDeletionTombstones(TOMBSTONES_KEY, tombstones.filter(tombstone => !survivingKeys.has(tombstone.key)));
  }
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
