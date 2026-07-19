import { useEffect, useState } from "react";
import { getActiveProfileId } from "../utils/localProfiles";

export interface SourcePreferences {
  repositoryOverrides: Record<string, boolean>;
  providerOverrides: Record<string, boolean>;
  seanimeExtensionOverrides: Record<string, boolean>;
  siteOverrides: Record<string, boolean>;
}

export const SOURCE_PREFERENCES_STORAGE_KEY = "aetherio-source-preferences";
export const SOURCE_PREFERENCES_CHANGED_EVENT = "aetherio-source-preferences-changed";

export const DEFAULT_SOURCE_PREFERENCES: SourcePreferences = {
  repositoryOverrides: {},
  providerOverrides: {},
  seanimeExtensionOverrides: {},
  siteOverrides: {},
};

export function getSourcePreferences(): SourcePreferences {
  try {
    const globalRaw = localStorage.getItem(SOURCE_PREFERENCES_STORAGE_KEY);
    if (globalRaw) return normalizeSourcePreferences(JSON.parse(globalRaw) as Partial<SourcePreferences>);
    const migrated = readLegacyProfileSourcePreferences();
    if (migrated) localStorage.setItem(SOURCE_PREFERENCES_STORAGE_KEY, JSON.stringify(migrated));
    return migrated ?? DEFAULT_SOURCE_PREFERENCES;
  } catch {
    return DEFAULT_SOURCE_PREFERENCES;
  }
}

export function saveSourcePreferences(preferences: SourcePreferences) {
  const normalized = normalizeSourcePreferences(preferences);
  localStorage.setItem(SOURCE_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(SOURCE_PREFERENCES_CHANGED_EVENT, { detail: normalized }));
}

export function useSourcePreferences() {
  const [preferences, setPreferences] = useState<SourcePreferences>(() => getSourcePreferences());

  useEffect(() => {
    const refresh = () => setPreferences(getSourcePreferences());
    window.addEventListener(SOURCE_PREFERENCES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SOURCE_PREFERENCES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return preferences;
}

export function isRepositoryEnabled(preferences: SourcePreferences, repositoryKey: string) {
  return preferences.repositoryOverrides[repositoryKey] ?? true;
}

export function isProviderEnabled(
  preferences: SourcePreferences,
  repositoryKey: string,
  providerKey: string,
  enabledByManifest: boolean,
) {
  return isRepositoryEnabled(preferences, repositoryKey)
    && (preferences.providerOverrides[providerKey] ?? enabledByManifest);
}

export function isScraperSiteEnabled(
  preferences: SourcePreferences,
  siteId: string,
  enabledByDefault: boolean,
) {
  return preferences.siteOverrides[siteId] ?? enabledByDefault;
}

export function isSeanimeExtensionEnabled(preferences: SourcePreferences, extensionId: string) {
  return preferences.seanimeExtensionOverrides[extensionId] ?? true;
}

export function sourcePreferencesSignature(preferences: SourcePreferences) {
  return JSON.stringify({
    repositories: sortedEntries(preferences.repositoryOverrides),
    providers: sortedEntries(preferences.providerOverrides),
    seanime: sortedEntries(preferences.seanimeExtensionOverrides),
    sites: sortedEntries(preferences.siteOverrides),
  });
}

function normalizeSourcePreferences(preferences: Partial<SourcePreferences>): SourcePreferences {
  return {
    repositoryOverrides: normalizeBooleanRecord(preferences.repositoryOverrides),
    providerOverrides: normalizeBooleanRecord(preferences.providerOverrides),
    seanimeExtensionOverrides: normalizeBooleanRecord(preferences.seanimeExtensionOverrides),
    siteOverrides: normalizeBooleanRecord(preferences.siteOverrides),
  };
}

function normalizeBooleanRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, enabled]) => key.trim() && typeof enabled === "boolean"),
  ) as Record<string, boolean>;
}

function sortedEntries(record: Record<string, boolean>) {
  return Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
}

function readLegacyProfileSourcePreferences() {
  const activeProfileId = getActiveProfileId();
  const candidates: Partial<SourcePreferences>[] = [];
  let active: Partial<SourcePreferences> | null = null;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith("aetherio-profile:") || !key.endsWith(`:${SOURCE_PREFERENCES_STORAGE_KEY}`)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<SourcePreferences> | null;
      if (!parsed) continue;
      if (activeProfileId && key === `aetherio-profile:${activeProfileId}:${SOURCE_PREFERENCES_STORAGE_KEY}`) active = parsed;
      else candidates.push(parsed);
    } catch {
      // Ignorar configuraciones antiguas corruptas y conservar las demás.
    }
  }
  if (!candidates.length && !active) return null;
  return [
    ...candidates,
    ...(active ? [active] : []),
  ].reduce<SourcePreferences>((merged, candidate) => {
    const normalized = normalizeSourcePreferences(candidate);
    return {
      repositoryOverrides: { ...merged.repositoryOverrides, ...normalized.repositoryOverrides },
      providerOverrides: { ...merged.providerOverrides, ...normalized.providerOverrides },
      seanimeExtensionOverrides: { ...merged.seanimeExtensionOverrides, ...normalized.seanimeExtensionOverrides },
      siteOverrides: { ...merged.siteOverrides, ...normalized.siteOverrides },
    };
  }, DEFAULT_SOURCE_PREFERENCES);
}
