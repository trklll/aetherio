import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureExperienceScope,
  setActiveProfile,
  subscribeExperienceScope,
  writeLocalProfilesForTest,
} from "../utils/localProfiles";
import {
  EXPERIENCE_STORAGE_FAILED_EVENT,
  EXPERIENCE_STORAGE_JOURNAL_KEY,
  EXPERIENCE_STORAGE_KEYS,
  EXPERIENCE_STORAGE_CHANGED_EVENT,
  readExperienceJSON,
  recoverExperienceJournal,
  resetExperienceStorageForTests,
  writeExperienceBatchToProfile,
  writeExperienceJSON,
} from "./experienceStorage";

function createStorage() {
  const values = new Map<string, string>();
  let failingKey: string | null = null;
  let shouldFail = false;
  return {
    values,
    failOnce(key: string) {
      failingKey = key;
      shouldFail = true;
    },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (shouldFail && key === failingKey) {
        shouldFail = false;
        throw new DOMException("quota", "QuotaExceededError");
      }
      values.set(key, String(value));
    },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
    key(index: number) { return Array.from(values.keys())[index] ?? null; },
    get length() { return values.size; },
  } as Storage & { values: Map<string, string>; failOnce(key: string): void };
}

describe("experience storage", () => {
  let storage: ReturnType<typeof createStorage>;
  let dispatchEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = createStorage();
    const listeners = new Map<string, Set<EventListener>>();
    dispatchEvent = vi.fn((event: Event) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      return true;
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      dispatchEvent,
      addEventListener: (type: string, listener: EventListener) => {
        const group = listeners.get(type) ?? new Set<EventListener>();
        group.add(listener);
        listeners.set(type, group);
      },
      removeEventListener: (type: string, listener: EventListener) => listeners.get(type)?.delete(listener),
    });
    vi.stubGlobal("CustomEvent", class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
    resetExperienceStorageForTests();
    writeLocalProfilesForTest([
      { id: "profile-a", name: "A", createdAt: 1, updatedAt: 1 },
      { id: "profile-b", name: "B", createdAt: 2, updatedAt: 2 },
    ]);
    setActiveProfile("profile-a");
    dispatchEvent.mockClear();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("registers new experience keys without including credentials", () => {
    expect(EXPERIENCE_STORAGE_KEYS).toContain("aetherio-saved-library-v1");
    expect(EXPERIENCE_STORAGE_KEYS).toContain("aetherio-user-ratings-v1");
    expect(EXPERIENCE_STORAGE_KEYS).toContain("aetherio-watched-history-v1");
    expect(EXPERIENCE_STORAGE_KEYS).toContain("aetherio-title-playback-selections-v1");
    expect(EXPERIENCE_STORAGE_KEYS).toContain("aetherio-recommendation-feedback-v1");
    expect(EXPERIENCE_STORAGE_KEYS).not.toContain("aetherio-account-token-v1");
    expect(EXPERIENCE_STORAGE_KEYS).not.toContain("aetherio-api-keys");
  });

  it("emits data-changed only after persistence and reports write failures separately", () => {
    const scope = captureExperienceScope();
    const key = "aetherio-title-playback-selections-v1";
    const success = writeExperienceJSON(scope, key, { version: 1, value: "en" }, ["test-data-changed"]);
    expect(success.ok).toBe(true);
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toContain("test-data-changed");

    dispatchEvent.mockClear();
    storage.failOnce(`aetherio-profile:profile-a:${key}`);
    const failure = writeExperienceJSON(scope, key, { version: 1, value: "ja" }, ["test-data-changed"]);
    expect(failure).toMatchObject({ ok: false, code: "storage-unavailable" });
    const eventTypes = dispatchEvent.mock.calls.map(([event]) => event.type);
    expect(eventTypes).toContain(EXPERIENCE_STORAGE_FAILED_EVENT);
    expect(eventTypes).not.toContain("test-data-changed");
  });

  it("requires versioned JSON for new stores", () => {
    const scope = captureExperienceScope();
    const result = writeExperienceJSON(scope, "aetherio-recommendation-feedback-v1", { records: [] });
    expect(result).toEqual({ ok: false, code: "invalid-data" });
    expect(storage.getItem("aetherio-profile:profile-a:aetherio-recommendation-feedback-v1")).toBeNull();
  });

  it("rejects writes captured for a profile that is no longer active", () => {
    const staleScope = captureExperienceScope();
    setActiveProfile("profile-b");
    dispatchEvent.mockClear();

    const result = writeExperienceJSON(staleScope, "aetherio-title-playback-selections-v1", { version: 1 });
    expect(result).toEqual({ ok: false, code: "scope-changed" });
    expect(storage.getItem("aetherio-profile:profile-a:aetherio-title-playback-selections-v1")).toBeNull();
    expect(storage.getItem("aetherio-profile:profile-b:aetherio-title-playback-selections-v1")).toBeNull();
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).not.toContain(EXPERIENCE_STORAGE_CHANGED_EVENT);
  });

  it("invalidates async scope generations on account changes and isolates account-only storage", () => {
    const observed: number[] = [];
    const unsubscribe = subscribeExperienceScope(scope => observed.push(scope.generation));
    storage.setItem("aetherio-account-user-v1", JSON.stringify({ id: "account-a" }));
    window.dispatchEvent(new CustomEvent("aetherio-auth-changed"));
    const accountA = captureExperienceScope();
    const key = "aetherio-title-playback-selections-v1";
    expect(accountA.accountScope).toBe("account:account-a");
    expect(accountA.profileId).toBeNull();
    expect("token" in accountA).toBe(false);
    expect(writeExperienceJSON(accountA, key, { version: 1, choice: "en" }).ok).toBe(true);
    const ratingsKey = "aetherio-user-ratings-v1";
    expect(writeExperienceJSON(accountA, ratingsKey, { version: 1, ratings: { "movie:one": 4.5 } }).ok).toBe(true);

    storage.setItem("aetherio-account-user-v1", JSON.stringify({ id: "account-b" }));
    window.dispatchEvent(new CustomEvent("aetherio-auth-changed"));
    const accountB = captureExperienceScope();
    expect(accountB.accountScope).toBe("account:account-b");
    expect(accountB.generation).toBeGreaterThan(accountA.generation);
    expect(observed.length).toBeGreaterThanOrEqual(2);
    expect(writeExperienceJSON(accountB, key, { version: 1, choice: "ja" }).ok).toBe(true);
    expect(writeExperienceJSON(accountB, ratingsKey, { version: 1, ratings: { "movie:one": 3 } }).ok).toBe(true);

    const storageKeyA = `aetherio-experience:${encodeURIComponent("account:account-a")}:${key}`;
    const storageKeyB = `aetherio-experience:${encodeURIComponent("account:account-b")}:${key}`;
    const ratingsStorageKeyA = `aetherio-experience:${encodeURIComponent("account:account-a")}:${ratingsKey}`;
    const ratingsStorageKeyB = `aetherio-experience:${encodeURIComponent("account:account-b")}:${ratingsKey}`;
    expect(storage.getItem(storageKeyA)).toContain("en");
    expect(storage.getItem(storageKeyB)).toContain("ja");
    expect(JSON.parse(storage.getItem(ratingsStorageKeyA) ?? "null")).toEqual({ version: 1, ratings: { "movie:one": 4.5 } });
    expect(JSON.parse(storage.getItem(ratingsStorageKeyB) ?? "null")).toEqual({ version: 1, ratings: { "movie:one": 3 } });
    unsubscribe();
  });

  it("replays an interrupted multi-key journal after a writer restart without announcing partial success", () => {
    const scope = captureExperienceScope();
    const libraryKey = "aetherio-saved-library-v1";
    const historyKey = "aetherio-watched-history-v1";
    const storageLibraryKey = `aetherio-profile:target-profile:${libraryKey}`;
    const storageHistoryKey = `aetherio-profile:target-profile:${historyKey}`;
    storage.setItem(storageLibraryKey, "old-library");
    storage.setItem(storageHistoryKey, "old-history");
    storage.failOnce(storageHistoryKey);

    const failed = writeExperienceBatchToProfile(scope, "target-profile", [
      { key: libraryKey, value: "new-library" },
      { key: historyKey, value: "new-history" },
    ], ["test-batch-changed"]);
    expect(failed).toMatchObject({ ok: false, code: "storage-unavailable" });
    expect(storage.getItem(storageLibraryKey)).toBe("new-library");
    expect(storage.getItem(storageHistoryKey)).toBe("old-history");
    expect(storage.getItem(EXPERIENCE_STORAGE_JOURNAL_KEY)).not.toBeNull();
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).not.toContain("test-batch-changed");

    // Simulate a process restart: module-local writer state is reset; the durable journal remains.
    resetExperienceStorageForTests();
    storage.failOnce(storageHistoryKey);
    expect(recoverExperienceJournal()).toMatchObject({ ok: false, code: "storage-unavailable" });
    expect(storage.getItem(EXPERIENCE_STORAGE_JOURNAL_KEY)).not.toBeNull();
    expect(dispatchEvent.mock.calls.map(([event]) => event.type)).not.toContain("test-batch-changed");

    const recovered = recoverExperienceJournal();
    expect(recovered.ok).toBe(true);
    expect(storage.getItem(storageLibraryKey)).toBe("new-library");
    expect(storage.getItem(storageHistoryKey)).toBe("new-history");
    expect(storage.getItem(EXPERIENCE_STORAGE_JOURNAL_KEY)).toBeNull();
    const successEvents = dispatchEvent.mock.calls.filter(([event]) => event.type === "test-batch-changed");
    expect(successEvents).toHaveLength(1);
  });

  it("keeps journals from a future version intact and reports them as unsupported", () => {
    const futureJournal = JSON.stringify({ version: 9, status: "pending", writes: [] });
    storage.setItem(EXPERIENCE_STORAGE_JOURNAL_KEY, futureJournal);

    expect(recoverExperienceJournal()).toEqual({ ok: false, code: "unsupported-version" });
    expect(storage.getItem(EXPERIENCE_STORAGE_JOURNAL_KEY)).toBe(futureJournal);
  });

  it("does not overwrite future-version experience data", () => {
    const scope = captureExperienceScope();
    const key = "aetherio-recommendation-feedback-v1";
    const storageKey = `aetherio-profile:profile-a:${key}`;
    const futureValue = JSON.stringify({ version: 4, records: [{ id: "future" }] });
    storage.setItem(storageKey, futureValue);

    expect(readExperienceJSON(scope, key)).toEqual({ ok: false, code: "unsupported-version" });
    expect(writeExperienceJSON(scope, key, { version: 1, records: [] })).toEqual({
      ok: false,
      code: "unsupported-version",
    });
    expect(storage.getItem(storageKey)).toBe(futureValue);
  });
});
