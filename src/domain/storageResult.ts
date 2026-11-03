export type StorageFailureCode =
  | "invalid-identity"
  | "invalid-data"
  | "not-written"
  | "scope-changed"
  | "storage-unavailable"
  | "journal-recovery-failed"
  | "unsupported-version";

export type StorageResult =
  | { ok: true; revision: number }
  | { ok: false; code: StorageFailureCode };

export function storageSuccess(revision: number): StorageResult {
  return { ok: true, revision };
}

export function storageFailure(code: StorageFailureCode, _cause?: unknown): StorageResult {
  return { ok: false, code };
}
