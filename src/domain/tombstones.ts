import { readExperienceJSON, writeExperienceJSON } from "./experienceStorage";
import { captureExperienceScope } from "../utils/localProfiles";

/**
 * Lápidas de borrado (tombstones) para propagar eliminaciones entre
 * dispositivos respaldados en Google Drive. Sin esto, un borrado en un
 * dispositivo "resucita" cuando otro dispositivo empuja su copia local.
 *
 * Reglas de fusión (por clave, última acción gana):
 * - Un tombstone borra la entrada local si `deletedAt` es posterior a la
 *   última escritura de la entrada (`updatedAt` / `addedAt`).
 * - Si la entrada volvió a crearse después del borrado, sobrevive y el
 *   tombstone se retira (queda fuera del conjunto que se vuelve a subir).
 * - Se podan por antigüedad y tope de tamaño para que no crezcan para siempre.
 */

export interface DeletionTombstone {
  key: string;
  deletedAt: number;
}

interface TombstoneFile {
  version: 1;
  tombstones: DeletionTombstone[];
}

const TOMBSTONE_VERSION = 1;
export const TOMBSTONE_MAX_ITEMS = 500;
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export function isDeletionTombstone(value: unknown): value is DeletionTombstone {
  return typeof value === "object" && value !== null
    && typeof (value as DeletionTombstone).key === "string"
    && (value as DeletionTombstone).key.trim().length > 0
    && typeof (value as DeletionTombstone).deletedAt === "number"
    && Number.isFinite((value as DeletionTombstone).deletedAt);
}

function isTombstoneFile(value: unknown): value is TombstoneFile {
  return typeof value === "object" && value !== null
    && !Array.isArray(value)
    && (value as TombstoneFile).version === TOMBSTONE_VERSION
    && Array.isArray((value as TombstoneFile).tombstones);
}

function pruneTombstones(tombstones: DeletionTombstone[]): DeletionTombstone[] {
  const oldestAllowed = Date.now() - TOMBSTONE_RETENTION_MS;
  return tombstones
    .filter(tombstone => tombstone.deletedAt >= oldestAllowed)
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, TOMBSTONE_MAX_ITEMS);
}

export function readDeletionTombstones(storageKey: string): DeletionTombstone[] {
  const result = readExperienceJSON<TombstoneFile>(captureExperienceScope(), storageKey, isTombstoneFile);
  if (!result.ok || !result.value) return [];
  return pruneTombstones(result.value.tombstones.filter(isDeletionTombstone));
}

/** Reescribe el conjunto completo de lápidas (tras fusionar o retirar). */
export function replaceDeletionTombstones(storageKey: string, tombstones: DeletionTombstone[]): void {
  writeExperienceJSON(
    captureExperienceScope(),
    storageKey,
    { version: TOMBSTONE_VERSION, tombstones: pruneTombstones(tombstones) } satisfies TombstoneFile,
  );
}

/** Registra el borrado de una entrada identificada por su clave estable. */
export function recordDeletionTombstone(storageKey: string, key: string): void {
  const next = readDeletionTombstones(storageKey).filter(tombstone => tombstone.key !== key);
  next.unshift({ key, deletedAt: Date.now() });
  replaceDeletionTombstones(storageKey, next);
}

/** Retira la lápida cuando la entrada vuelve a existir con datos más nuevos. */
export function clearDeletionTombstone(storageKey: string, key: string): void {
  const current = readDeletionTombstones(storageKey);
  if (!current.some(tombstone => tombstone.key === key)) return;
  replaceDeletionTombstones(storageKey, current.filter(tombstone => tombstone.key !== key));
}

/**
 * Fusiona lápidas remotas con las locales (por clave gana el `deletedAt` más
 * reciente) y devuelve el conjunto fusionado ya podado. La llamada escribe el
 * archivo fusionado para que el siguiente push lo replique.
 */
export function mergeDeletionTombstones(storageKey: string, remote: DeletionTombstone[]): DeletionTombstone[] {
  const byKey = new Map<string, DeletionTombstone>();
  for (const tombstone of readDeletionTombstones(storageKey)) byKey.set(tombstone.key, tombstone);
  for (const tombstone of remote) {
    if (!isDeletionTombstone(tombstone)) continue;
    const current = byKey.get(tombstone.key);
    if (!current || tombstone.deletedAt > current.deletedAt) byKey.set(tombstone.key, tombstone);
  }
  const merged = pruneTombstones(Array.from(byKey.values()));
  replaceDeletionTombstones(storageKey, merged);
  return merged;
}
