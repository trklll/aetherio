import { getScopedStorageKey } from "../utils/localProfiles.ts";

const QUICK_START_STORAGE_KEY = "aetherio-quick-start-v1";
const QUICK_START_VERSION = 1;

interface QuickStartSnapshot {
  version: number;
  completedAt: number;
}

export function hasCompletedQuickStart() {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(QUICK_START_STORAGE_KEY));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<QuickStartSnapshot>;
    return typeof parsed.version === "number" && parsed.version >= QUICK_START_VERSION;
  } catch {
    return false;
  }
}

export function completeQuickStart() {
  const snapshot: QuickStartSnapshot = {
    version: QUICK_START_VERSION,
    completedAt: Date.now(),
  };
  localStorage.setItem(getScopedStorageKey(QUICK_START_STORAGE_KEY), JSON.stringify(snapshot));
}
