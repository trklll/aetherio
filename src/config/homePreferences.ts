import { useEffect, useState } from "react";
import type { CatalogRowData } from "../types/ui.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

export type HomePosterLayout = "horizontal" | "vertical";
export type ContentOrientation = "movies-series" | "anime" | "both";

export interface HomePreferences {
  contentOrientation: ContentOrientation;
  posterLayout: HomePosterLayout;
  catalogOrder: string[];
  hiddenCatalogKeys: string[];
  allowTmdbArtworkFallback: boolean;
}

export const HOME_PREFERENCES_STORAGE_KEY = "aetherio-home-preferences";
export const HOME_PREFERENCES_CHANGED_EVENT = "aetherio-home-preferences-changed";

export const DEFAULT_HOME_PREFERENCES: HomePreferences = {
  contentOrientation: "both",
  posterLayout: "horizontal",
  catalogOrder: [],
  hiddenCatalogKeys: [],
  allowTmdbArtworkFallback: false,
};

export function catalogPreferenceKey(row: Pick<CatalogRowData, "addonId" | "type" | "catalogId" | "extraParams">) {
  const extras = row.extraParams
    ? Object.entries(row.extraParams)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("|")
    : "";
  return `${row.addonId}:${row.type}:${row.catalogId}:${extras}`;
}

export function getHomePreferences(): HomePreferences {
  try {
    const raw = localStorage.getItem(getHomePreferencesStorageKey());
    if (!raw) return DEFAULT_HOME_PREFERENCES;
    return normalizeHomePreferences(JSON.parse(raw) as Partial<HomePreferences>);
  } catch {
    return DEFAULT_HOME_PREFERENCES;
  }
}

export function saveHomePreferences(preferences: HomePreferences) {
  const normalized = normalizeHomePreferences(preferences);
  localStorage.setItem(getHomePreferencesStorageKey(), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(HOME_PREFERENCES_CHANGED_EVENT, { detail: normalized }));
}

export function useHomePreferences() {
  const [preferences, setPreferences] = useState<HomePreferences>(() => getHomePreferences());

  useEffect(() => {
    const refresh = () => setPreferences(getHomePreferences());
    // React Activity pauses effects for cached routes while they are hidden.
    // Read storage again when Home becomes visible so preferences changed in
    // Settings are applied without requiring a full page reload.
    refresh();
    window.addEventListener(HOME_PREFERENCES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HOME_PREFERENCES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return preferences;
}

export function mergedCatalogOrder(rows: CatalogRowData[], catalogOrder: string[]) {
  const rowKeys = rows.map(catalogPreferenceKey);
  const rowKeySet = new Set(rowKeys);
  const ordered = catalogOrder.filter(key => rowKeySet.has(key));
  for (const key of rowKeys) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

export function sortHomeCatalogRows(rows: CatalogRowData[], preferences: HomePreferences) {
  const order = mergedCatalogOrder(rows, preferences.catalogOrder);
  const orderIndex = new Map(order.map((key, index) => [key, index]));
  return [...rows].sort((a, b) => {
    const aIdx = orderIndex.get(catalogPreferenceKey(a));
    const bIdx = orderIndex.get(catalogPreferenceKey(b));
    if (aIdx != null && bIdx != null) return aIdx - bIdx;
    if (aIdx != null) return -1;
    if (bIdx != null) return 1;
    return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
  });
}

export function applyContentOrientationToItems<T extends { type: string }>(items: T[], orientation: ContentOrientation) {
  return [...items].sort((a, b) => (
    contentOrientationPriority(a.type, orientation) - contentOrientationPriority(b.type, orientation)
  ));
}

export function matchesContentOrientation(type: string, orientation: ContentOrientation) {
  if (orientation === "both") return true;
  const isAnime = type.toLowerCase() === "anime";
  return orientation === "anime" ? isAnime : !isAnime;
}

export function applyHomeCatalogPreferences(rows: CatalogRowData[], preferences: HomePreferences) {
  const hidden = new Set(preferences.hiddenCatalogKeys);
  const filtered = rows.filter(row => !hidden.has(catalogPreferenceKey(row)));
  const ordered = sortHomeCatalogRows(filtered, preferences);
  const explicitOrder = new Set(preferences.catalogOrder);

  // A saved order is an explicit user decision. New catalogs that do not yet
  // appear in that order use the selected orientation as their default slot.
  return ordered.sort((a, b) => {
    const aExplicit = explicitOrder.has(catalogPreferenceKey(a));
    const bExplicit = explicitOrder.has(catalogPreferenceKey(b));
    if (aExplicit || bExplicit) return 0;
    return contentOrientationPriority(a.type, preferences.contentOrientation)
      - contentOrientationPriority(b.type, preferences.contentOrientation);
  });
}

function normalizeHomePreferences(preferences: Partial<HomePreferences>): HomePreferences {
  const catalogOrder = Array.isArray(preferences.catalogOrder)
    ? preferences.catalogOrder.filter((key): key is string => typeof key === "string")
    : DEFAULT_HOME_PREFERENCES.catalogOrder;
  const hiddenCatalogKeys = Array.isArray(preferences.hiddenCatalogKeys)
    ? preferences.hiddenCatalogKeys.filter((key): key is string => typeof key === "string")
    : DEFAULT_HOME_PREFERENCES.hiddenCatalogKeys;

  return {
    contentOrientation: normalizeContentOrientation(preferences.contentOrientation),
    posterLayout: preferences.posterLayout === "vertical" ? "vertical" : "horizontal",
    catalogOrder,
    hiddenCatalogKeys,
    allowTmdbArtworkFallback: typeof preferences.allowTmdbArtworkFallback === "boolean"
      ? preferences.allowTmdbArtworkFallback
      : typeof (preferences as { allowImdbHeroArtwork?: unknown }).allowImdbHeroArtwork === "boolean"
        ? Boolean((preferences as { allowImdbHeroArtwork?: unknown }).allowImdbHeroArtwork)
        : DEFAULT_HOME_PREFERENCES.allowTmdbArtworkFallback,
  };
}

function normalizeContentOrientation(value: unknown): ContentOrientation {
  if (value === "movies-series" || value === "anime") return value;
  return "both";
}

function contentOrientationPriority(type: string, orientation: ContentOrientation) {
  return matchesContentOrientation(type, orientation) ? 0 : 1;
}

function getHomePreferencesStorageKey() {
  return getScopedStorageKey(HOME_PREFERENCES_STORAGE_KEY);
}
