import {
  getScopedStorageKeyForScope,
  isExperienceScopeCurrent,
  type ExperienceStorageScope,
} from "../utils/localProfiles";
import { storageFailure, storageSuccess, type StorageFailureCode, type StorageResult } from "./storageResult";

export const EXPERIENCE_STORAGE_CHANGED_EVENT = "aetherio-experience-storage-changed";
export const EXPERIENCE_STORAGE_FAILED_EVENT = "aetherio-experience-storage-failed";
export const EXPERIENCE_STORAGE_JOURNAL_KEY = "aetherio-experience-write-journal-v1";

const JOURNAL_VERSION = 1;
const LEGACY_COMPATIBILITY_KEYS = new Set([
  "aetherio-saved-library-v1",
  "aetherio-continue-watching-v1",
  "aetherio-watched-history-v1",
  "aetherio-continue-watching-audio-selection-v1",
]);
const registeredKeys = new Set<string>([
  "aetherio-saved-library-v1",
  "aetherio-continue-watching-v1",
  "aetherio-watched-history-v1",
  "aetherio-continue-watching-audio-selection-v1",
  "aetherio-title-playback-selections-v1",
  "aetherio-recommendation-feedback-v1",
  "aetherio-sync-state-v1",
  "aetherio-anilist-sync-queue-v1",
  "aetherio-anime-preferences-v1",
]);

export let EXPERIENCE_STORAGE_KEYS: readonly string[] = Object.freeze(Array.from(registeredKeys));

interface JournalWrite {
  key: string;
  previous: string | null;
  next: string | null;
}

interface ExperienceWriteJournal {
  version: 1;
  status: "pending" | "committed";
  scope: Pick<ExperienceStorageScope, "accountScope" | "profileId">;
  writes: JournalWrite[];
  events: string[];
}

export type ExperienceReadResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; code: StorageFailureCode };

export function registerExperienceStorageKey(key: string): void {
  if (!isAllowedStorageKey(key)) throw new Error("Invalid experience storage key");
  registeredKeys.add(key);
  EXPERIENCE_STORAGE_KEYS = Object.freeze(Array.from(registeredKeys));
}

export function getExperienceStorageKeys(): string[] {
  return Array.from(registeredKeys);
}

export function isExperienceStorageKeyRegistered(key: string): boolean {
  return registeredKeys.has(key);
}

export function writeExperienceJSON(
  scope: ExperienceStorageScope,
  key: string,
  value: unknown,
  events: readonly string[] = [],
): StorageResult {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
    if (serialized === undefined) return fail("invalid-data");
  } catch {
    return fail("invalid-data");
  }
  return writeExperienceBatch(scope, [{ key, value: serialized }], events);
}

export function readExperienceJSON<T>(
  scope: ExperienceStorageScope,
  key: string,
  validate?: (value: unknown) => value is T,
): ExperienceReadResult<T> {
  if (!isExperienceStorageKeyRegistered(key)) return failRead("invalid-data");
  if (!isExperienceScopeCurrent(scope)) return failRead("scope-changed");
  const recovered = recoverExperienceJournal();
  if (!recovered.ok) return failRead(recovered.code);
  try {
    const raw = localStorage.getItem(getScopedStorageKeyForScope(key, scope));
    if (raw === null) return { ok: true, value: null };
    const parsed: unknown = JSON.parse(raw);
    if (hasUnknownVersion(parsed)) return failRead("unsupported-version");
    if (!isReadableValue(key, parsed)) return failRead("invalid-data");
    if (validate && !validate(parsed)) return failRead("invalid-data");
    return { ok: true, value: parsed as T };
  } catch (error) {
    return failRead("invalid-data", error);
  }
}

export function writeExperienceBatch(
  scope: ExperienceStorageScope,
  writes: readonly { key: string; value: string | null }[],
  events: readonly string[] = [],
): StorageResult {
  return writeExperienceBatchForScope(scope, scope, writes, events);
}

/** Explicit profile adoption: source scope must remain current, destination is the selected new profile. */
export function writeExperienceBatchToProfile(
  sourceScope: ExperienceStorageScope,
  targetProfileId: string,
  writes: readonly { key: string; value: string | null }[],
  events: readonly string[] = [],
): StorageResult {
  if (!targetProfileId.trim()) return fail("invalid-data");
  return writeExperienceBatchForScope(
    { ...sourceScope, profileId: targetProfileId },
    sourceScope,
    writes,
    events,
  );
}

function writeExperienceBatchForScope(
  scope: ExperienceStorageScope,
  guardScope: ExperienceStorageScope,
  writes: readonly { key: string; value: string | null }[],
  events: readonly string[],
): StorageResult {
  if (!writes.length || writes.some(write => !isExperienceStorageKeyRegistered(write.key))) {
    return fail("invalid-data");
  }
  if (writes.some(write => !isWritableValue(write.key, write.value))) return fail("invalid-data");
  if (!isExperienceScopeCurrent(guardScope)) return fail("scope-changed");
  const recovered = recoverExperienceJournal();
  if (!recovered.ok) return fail(recovered.code);
  if (!isExperienceScopeCurrent(guardScope)) return fail("scope-changed");

  const uniqueWrites = new Map<string, string | null>();
  for (const write of writes) uniqueWrites.set(write.key, write.value);
  const normalizedWrites = Array.from(uniqueWrites, ([key, value]) => ({ key, value }));
  if (normalizedWrites.length === 1) return writeOne(scope, guardScope, normalizedWrites[0], events);
  return writeMany(scope, guardScope, normalizedWrites, events);
}

export function recoverExperienceJournal(): StorageResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(EXPERIENCE_STORAGE_JOURNAL_KEY);
  } catch (error) {
    return fail("storage-unavailable", error);
  }
  if (raw === null) return storageSuccess(revision);

  let journal: ExperienceWriteJournal;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed)) return fail("journal-recovery-failed");
    if ((parsed as { version?: unknown }).version !== JOURNAL_VERSION) return fail("unsupported-version");
    if (!isJournal(parsed)) return fail("journal-recovery-failed");
    journal = parsed;
  } catch (error) {
    return fail("journal-recovery-failed", error);
  }

  try {
    if (journal.status === "pending") {
      for (const write of journal.writes) {
        if (!isExperienceStorageKeyRegistered(write.key) || !isWritableValue(write.key, write.next)) {
          return fail("journal-recovery-failed");
        }
        setRaw(getScopedStorageKeyForScope(write.key, journal.scope), write.next);
      }
      localStorage.setItem(EXPERIENCE_STORAGE_JOURNAL_KEY, JSON.stringify({ ...journal, status: "committed" }));
    }
    localStorage.removeItem(EXPERIENCE_STORAGE_JOURNAL_KEY);
  } catch (error) {
    return fail("storage-unavailable", error);
  }

  dispatchSuccessEvents(journal.events);
  return storageSuccess(nextRevision());
}

/** Simulates a fresh writer process in tests; durable localStorage is not touched. */
export function resetExperienceStorageForTests(): void {
  revision = 0;
}

let revision = 0;

function writeOne(
  scope: ExperienceStorageScope,
  guardScope: ExperienceStorageScope,
  write: { key: string; value: string | null },
  events: readonly string[],
): StorageResult {
  if (!isExperienceScopeCurrent(guardScope)) return fail("scope-changed");
  const storageKey = getScopedStorageKeyForScope(write.key, scope);
  let previous: string | null = null;
  let previousWasRead = false;
  try {
    previous = localStorage.getItem(storageKey);
    previousWasRead = true;
    if (isStoredValueFromFuture(previous)) return fail("unsupported-version");
    setRaw(storageKey, write.value);
  } catch (error) {
    if (previousWasRead) {
      try { setRaw(storageKey, previous); } catch { /* best-effort rollback */ }
    }
    return fail("storage-unavailable", error);
  }
  dispatchSuccessEvents(events);
  return storageSuccess(nextRevision());
}

function writeMany(
  scope: ExperienceStorageScope,
  guardScope: ExperienceStorageScope,
  writes: readonly { key: string; value: string | null }[],
  events: readonly string[],
): StorageResult {
  const journalWrites: JournalWrite[] = [];
  try {
    for (const write of writes) {
      const storageKey = getScopedStorageKeyForScope(write.key, scope);
      const previous = localStorage.getItem(storageKey);
      if (isStoredValueFromFuture(previous)) return fail("unsupported-version");
      journalWrites.push({
        key: write.key,
        previous,
        next: write.value,
      });
    }
  } catch (error) {
    return fail("storage-unavailable", error);
  }

  const journal: ExperienceWriteJournal = {
    version: JOURNAL_VERSION,
    status: "pending",
    scope: { accountScope: scope.accountScope, profileId: scope.profileId },
    writes: journalWrites,
    events: Array.from(new Set(events.filter(event => typeof event === "string" && event.length > 0))),
  };
  try {
    localStorage.setItem(EXPERIENCE_STORAGE_JOURNAL_KEY, JSON.stringify(journal));
  } catch (error) {
    return fail("storage-unavailable", error);
  }

  try {
    for (const write of writes) {
      if (!isExperienceScopeCurrent(guardScope)) return fail("scope-changed");
      setRaw(getScopedStorageKeyForScope(write.key, scope), write.value);
    }
    localStorage.setItem(EXPERIENCE_STORAGE_JOURNAL_KEY, JSON.stringify({ ...journal, status: "committed" }));
    localStorage.removeItem(EXPERIENCE_STORAGE_JOURNAL_KEY);
  } catch (error) {
    return fail("storage-unavailable", error);
  }
  dispatchSuccessEvents(events);
  return storageSuccess(nextRevision());
}

function setRaw(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
}

function dispatchSuccessEvents(events: readonly string[]): void {
  dispatchEvent(EXPERIENCE_STORAGE_CHANGED_EVENT, { revision: revision + 1 });
  for (const event of new Set(events)) dispatchEvent(event);
}

function dispatchEvent(name: string, detail?: unknown): void {
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // A listener cannot turn a durable write into a reported storage failure.
  }
}

function fail(code: StorageFailureCode, cause?: unknown): StorageResult {
  dispatchEvent(EXPERIENCE_STORAGE_FAILED_EVENT, { code });
  return storageFailure(code, cause);
}

function failRead<T>(code: StorageFailureCode, cause?: unknown): ExperienceReadResult<T> {
  fail(code, cause);
  return { ok: false, code };
}

function nextRevision(): number {
  revision += 1;
  return revision;
}

function isAllowedStorageKey(key: string): boolean {
  return typeof key === "string"
    && /^aetherio-[a-z0-9-]+-v\d+$/.test(key)
    && !/(?:token|secret|credential|api-keys|trakt-auth|pin)/i.test(key);
}

function isStoredValueFromFuture(raw: string | null): boolean {
  if (raw === null) return false;
  try { return hasUnknownVersion(JSON.parse(raw)); }
  catch { return false; }
}

function isWritableValue(key: string, raw: string | null): boolean {
  if (raw === null || LEGACY_COMPATIBILITY_KEYS.has(key)) return true;
  try { return isReadableValue(key, JSON.parse(raw)); }
  catch { return false; }
}

function isReadableValue(key: string, value: unknown): boolean {
  if (LEGACY_COMPATIBILITY_KEYS.has(key)) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as { version?: unknown }).version === 1;
}

function hasUnknownVersion(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return "version" in value && (value as { version?: unknown }).version !== 1;
}

function isJournal(value: unknown): value is ExperienceWriteJournal {
  if (!value || typeof value !== "object") return false;
  const journal = value as ExperienceWriteJournal;
  if (journal.version !== JOURNAL_VERSION || (journal.status !== "pending" && journal.status !== "committed")) return false;
  if (!journal.scope || typeof journal.scope.accountScope !== "string") return false;
  if (journal.scope.profileId !== null && typeof journal.scope.profileId !== "string") return false;
  if (journal.scope.profileId !== null && !journal.scope.profileId.trim()) return false;
  if (!Array.isArray(journal.writes) || !Array.isArray(journal.events)) return false;
  return journal.writes.every(write => (
    Boolean(write)
    && typeof write.key === "string"
    && (write.previous === null || typeof write.previous === "string")
    && (write.next === null || typeof write.next === "string")
  )) && journal.events.every(event => typeof event === "string" && /^[a-z0-9-]+$/i.test(event));
}
