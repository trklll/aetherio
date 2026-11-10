import type { StreamQuery } from "../../../types/stream";
import { buildMediaTitleIdentity, mediaTitleIdentityKey } from "../mediaTitleIdentity";

export type AutoSyncTitleMode = "on" | "off";
export type AutoSyncGlobalMode = "off" | "learned" | "on";

export const AUTO_SYNC_TITLES_STORAGE_KEY = "aetherio-subtitle-sync-titles";
const MAX_TRACKED_TITLES = 200;

type TitleModes = Record<string, AutoSyncTitleMode>;

function readAll(): TitleModes {
  try {
    const raw = localStorage.getItem(AUTO_SYNC_TITLES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const modes: TitleModes = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === "on" || value === "off") modes[key] = value;
    }
    return modes;
  } catch {
    return {};
  }
}

function writeAll(modes: TitleModes) {
  const entries = Object.entries(modes);
  // Un disco local no crece sin limite: nos quedamos con las decisiones recientes.
  const trimmed = entries.length > MAX_TRACKED_TITLES
    ? Object.fromEntries(entries.slice(entries.length - MAX_TRACKED_TITLES))
    : modes;
  try {
    localStorage.setItem(AUTO_SYNC_TITLES_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Sin espacio o sin permisos: la preferencia simply no se recuerda.
  }
}

export function buildAutoSyncTitleKey(query: StreamQuery | null | undefined): string {
  return mediaTitleIdentityKey(buildMediaTitleIdentity(query));
}

export function getAutoSyncTitleMode(titleKey: string): AutoSyncTitleMode | null {
  if (!titleKey) return null;
  return readAll()[titleKey] ?? null;
}

export function setAutoSyncTitleMode(titleKey: string, mode: AutoSyncTitleMode) {
  if (!titleKey) return;
  const modes = readAll();
  modes[titleKey] = mode;
  writeAll(modes);
}

export function clearAutoSyncTitleMode(titleKey: string) {
  if (!titleKey) return;
  const modes = readAll();
  if (!(titleKey in modes)) return;
  delete modes[titleKey];
  writeAll(modes);
}

export function shouldAutoSyncTitle(
  globalMode: AutoSyncGlobalMode,
  titleKey: string,
  attemptedKeys: ReadonlySet<string>,
): boolean {
  if (!titleKey) return false;
  if (globalMode === "off") return false;
  if (globalMode === "on") return !attemptedKeys.has(titleKey);
  return getAutoSyncTitleMode(titleKey) === "on" && !attemptedKeys.has(titleKey);
}
