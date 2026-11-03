import type { InstalledAddon } from "./addonStore.ts";
import { normalizeSportsStreamsManifestUrl, SPORTS_STREAMS_ADDON_ID } from "../services/sportsStreamsConfig.ts";
import { CNCVERSE_BRIDGE_ID, readCncVerseBridgeUrl } from "../services/cncverseBridge.ts";

export const HUB_ONLY_MIGRATION_KEY = "aetherio-hub-only-migration-v1";
export const HUB_ONLY_BACKUP_KEY = "aetherio-hub-only-backup-v1";
export const HUB_ADDON_STATES_KEY = "aetherio-provider-hub-addon-states";
const REMOVED_DEFAULT = Symbol("removed-local-default");

/** Provenance, never the addon name/ID alone, decides what can be removed. */
function retainPersonalAddon(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const addon = value as InstalledAddon;
  if (addon.bundled !== true || addon.origin === "provider-hub") return value;
  const sportsUrl = addon.id === SPORTS_STREAMS_ADDON_ID ? normalizeSportsStreamsManifestUrl(addon.url) : null;
  const personalSports = sportsUrl && sportsUrl !== "https://sports.highfly.to/manifest.json";
  const personalBridge = addon.id === CNCVERSE_BRIDGE_ID && (Boolean(addon.url) || Boolean(readCncVerseBridgeUrl()));
  // A positive installation date is evidence of a manual install even if an
  // older app incorrectly stamped it as bundled. Prefer keeping ambiguous work.
  if (addon.origin === "user" || addon.installedAt > 0 || personalSports || personalBridge) {
    return { ...addon, bundled: false, origin: "user" };
  }
  return REMOVED_DEFAULT;
}

export function readHubAddonStates(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HUB_ADDON_STATES_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, enabled]) => typeof enabled === "boolean"));
  } catch { return {}; }
}

/** One pass covers global storage and inactive profiles without switching them. */
export function migrateLocalAddonDefaults(extraKeys: string[] = []): void {
  if (typeof localStorage === "undefined" || localStorage.getItem(HUB_ONLY_MIGRATION_KEY) === "1") return;
  const keys = new Set(["aetherio-addons", ...extraKeys]);
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("aetherio-profile:") && key.endsWith(":aetherio-addons")) keys.add(key);
  }
  const updates: Array<[string, string]> = [];
  const originals: Record<string, string> = {};
  const states = readHubAddonStates();
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const addons = parsed?.state?.addons ?? parsed?.addons;
    if (!Array.isArray(addons)) continue;
    const retained = addons.map(retainPersonalAddon).filter(value => value !== REMOVED_DEFAULT);
    if (retained.every((value, index) => value === addons[index]) && retained.length === addons.length) continue;
    originals[key] = raw;
    for (const addon of addons) {
      if (addon?.bundled === true && addon?.enabled === false && typeof addon.id === "string" && !(addon.id in states)) states[addon.id] = false;
    }
    const updated = parsed.state ? { ...parsed, state: { ...parsed.state, addons: retained } } : { ...parsed, addons: retained };
    updates.push([key, JSON.stringify(updated)]);
  }
  // No destructive write is allowed unless the original values were backed up.
  // Preserve previously captured values after an interrupted pass and append
  // originals for newly discovered keys before making any further changes.
  if (updates.length) {
    const previous = localStorage.getItem(HUB_ONLY_BACKUP_KEY);
    const backup = previous ? JSON.parse(previous) : { version: 1, createdAt: Date.now(), entries: {} };
    if (!backup || typeof backup !== "object" || !backup.entries || typeof backup.entries !== "object" || Array.isArray(backup.entries)) {
      throw new Error("No se pudo validar la copia de seguridad de add-ons; no se ha borrado nada.");
    }
    localStorage.setItem(HUB_ONLY_BACKUP_KEY, JSON.stringify({ ...backup, entries: { ...originals, ...backup.entries } }));
  }
  if (updates.length) localStorage.setItem(HUB_ADDON_STATES_KEY, JSON.stringify(states));
  for (const [key, value] of updates) localStorage.setItem(key, value);
  localStorage.setItem(HUB_ONLY_MIGRATION_KEY, "1");
}
