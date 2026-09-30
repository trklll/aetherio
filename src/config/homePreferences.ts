import { useEffect, useState } from "react";
import type { CatalogRowData } from "../types/ui.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

export type HomePosterLayout = "horizontal" | "vertical";
export type ContentOrientation = "movies-series" | "anime" | "both";
export type BothContentPreference = "anime" | "movies-series";

export interface HomePreferences {
  contentOrientation: ContentOrientation;
  bothPreference: BothContentPreference;
  posterLayout: HomePosterLayout;
  catalogOrder: string[];
  hiddenCatalogKeys: string[];
  allowTmdbArtworkFallback: boolean;
}

export const HOME_PREFERENCES_STORAGE_KEY = "aetherio-home-preferences";
export const HOME_PREFERENCES_CHANGED_EVENT = "aetherio-home-preferences-changed";
// Marca de la migración única a pósters verticales (por perfil).
const POSTER_LAYOUT_MIGRATION_KEY = "aetherio-poster-layout-vertical-migration-v1";
const DEFAULT_ORDER_MIGRATION_KEY = "aetherio-home-default-order-migration-v2";

export const DEFAULT_HOME_PREFERENCES: HomePreferences = {
  contentOrientation: "both",
  bothPreference: "movies-series",
  posterLayout: "vertical",
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
    const parsed = JSON.parse(raw) as Partial<HomePreferences>;
    const posterMigrated = migratePosterLayoutToVertical(parsed);
    return normalizeHomePreferences(migrateDefaultCatalogOrder(posterMigrated));
  } catch {
    return DEFAULT_HOME_PREFERENCES;
  }
}

/**
 * Migración única a pósters verticales: quien tenía "horizontal" guardado
 * pasa a "vertical" una sola vez. El toggle de Ajustes sigue permitiendo
 * volver a horizontal (la marca evita re-forzar al que lo elige a mano).
 */
function migratePosterLayoutToVertical(preferences: Partial<HomePreferences>): Partial<HomePreferences> {
  if (preferences.posterLayout !== "horizontal") return preferences;
  try {
    const migrationKey = getScopedStorageKey(POSTER_LAYOUT_MIGRATION_KEY);
    if (localStorage.getItem(migrationKey)) return preferences;
    const migrated: Partial<HomePreferences> = { ...preferences, posterLayout: "vertical" };
    localStorage.setItem(getHomePreferencesStorageKey(), JSON.stringify(normalizeHomePreferences(migrated)));
    localStorage.setItem(migrationKey, "1");
    return migrated;
  } catch {
    return preferences;
  }
}

function migrateDefaultCatalogOrder(preferences: Partial<HomePreferences>): Partial<HomePreferences> {
  try {
    const migrationKey = getScopedStorageKey(DEFAULT_ORDER_MIGRATION_KEY);
    if (localStorage.getItem(migrationKey)) return preferences;
    const migrated: Partial<HomePreferences> = { ...preferences, catalogOrder: [] };
    localStorage.setItem(getHomePreferencesStorageKey(), JSON.stringify(normalizeHomePreferences(migrated)));
    localStorage.setItem(migrationKey, "1");
    return migrated;
  } catch {
    return { ...preferences, catalogOrder: [] };
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

export function isAnimeType(type: string) {
  return type.toLowerCase() === "anime";
}

export function isAnimeFirst(preferences: Pick<HomePreferences, "contentOrientation" | "bothPreference">) {
  if (preferences.contentOrientation === "anime") return true;
  if (preferences.contentOrientation === "movies-series") return false;
  return preferences.bothPreference === "anime";
}

export function applyContentOrientationToItems<T extends { type: string }>(
  items: T[],
  orientation: ContentOrientation,
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
) {
  return [...items].sort((a, b) => (
    contentOrientationPriority(a.type, orientation, bothPreference)
    - contentOrientationPriority(b.type, orientation, bothPreference)
  ));
}

export function matchesContentOrientation(type: string, orientation: ContentOrientation) {
  if (orientation === "both") return true;
  const isAnime = isAnimeType(type);
  return orientation === "anime" ? isAnime : !isAnime;
}

type MovieSeriesRow = Pick<CatalogRowData, "type" | "name" | "catalogId">;

function isMovieRow(row: MovieSeriesRow) {
  return row.type.toLowerCase() === "movie";
}

function isSeriesRow(row: MovieSeriesRow) {
  const type = row.type.toLowerCase();
  return type === "series" || type === "tv";
}

function defaultMovieSeriesPairKey(row: MovieSeriesRow) {
  const normalized = `${row.catalogId} ${row.name}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const year = normalized.match(/(?:nuevas?|new)\s*(?:[-/]\s*)?(?:(?:de|del)\s*)?(20\d{2})/i);
  if (year) return `new:${year[1]}`;
  const isTop = normalized.includes("tendencias")
    || normalized.includes("trending")
    || normalized.startsWith("top ")
    || row.catalogId.toLowerCase().includes("trending")
    || /top_(?:movie|series)/.test(row.catalogId.toLowerCase());
  if (isTop) return `top:${isMovieRow(row) ? "movie" : "series"}`;
  if (normalized.includes("popular")) return "popular";
  return null;
}

export function interleaveMovieSeriesRows<T extends MovieSeriesRow>(rows: T[]): T[] {
  const seriesByKey = new Map<string, T[]>();
  for (const row of rows) {
    if (!isSeriesRow(row)) continue;
    const key = defaultMovieSeriesPairKey(row);
    if (!key) continue;
    const bucket = seriesByKey.get(key) ?? [];
    bucket.push(row);
    seriesByKey.set(key, bucket);
  }

  const pairedSeries = new Set<T>();
  const seriesAfterMovie = new Map<T, T>();
  for (const row of rows) {
    if (!isMovieRow(row)) continue;
    const key = defaultMovieSeriesPairKey(row);
    if (!key || key.startsWith("top:")) continue;
    const series = seriesByKey.get(key)?.find(candidate => !pairedSeries.has(candidate));
    if (!series) continue;
    pairedSeries.add(series);
    seriesAfterMovie.set(row, series);
  }

  const result: T[] = [];
  for (const row of rows) {
    if (pairedSeries.has(row)) continue;
    result.push(row);
    const series = seriesAfterMovie.get(row);
    if (series) result.push(series);
  }

  const yearSeriesRows = rows.filter(row => {
    if (!isSeriesRow(row)) return false;
    return defaultMovieSeriesPairKey(row)?.startsWith("new:") ?? false;
  });
  if (!yearSeriesRows.length) return result;

  const newestYearRow = yearSeriesRows.reduce((latest, row) => {
    const latestYear = Number(defaultMovieSeriesPairKey(latest)?.slice(4) ?? 0);
    const rowYear = Number(defaultMovieSeriesPairKey(row)?.slice(4) ?? 0);
    return rowYear >= latestYear ? row : latest;
  });
  const oldestYearRow = yearSeriesRows.reduce((oldest, row) => {
    const oldestYear = Number(defaultMovieSeriesPairKey(oldest)?.slice(4) ?? Number.MAX_SAFE_INTEGER);
    const rowYear = Number(defaultMovieSeriesPairKey(row)?.slice(4) ?? Number.MAX_SAFE_INTEGER);
    return rowYear <= oldestYear ? row : oldest;
  });

  const topMovieRows = rows.filter(row => isMovieRow(row) && defaultMovieSeriesPairKey(row) === "top:movie");
  const topSeriesRows = rows.filter(row => isSeriesRow(row) && defaultMovieSeriesPairKey(row) === "top:series");
  const insertions = new Map<T, T[]>();
  const insertAfter = (anchor: T, values: T[]) => {
    if (!values.length) return;
    insertions.set(anchor, [...(insertions.get(anchor) ?? []), ...values]);
  };
  insertAfter(newestYearRow, topMovieRows);
  insertAfter(oldestYearRow, topSeriesRows);

  const anchoredTopRows = new Set<T>([...topMovieRows, ...topSeriesRows]);
  const resultWithoutAnchoredTops = result.filter(row => !anchoredTopRows.has(row));
  const finalResult: T[] = [];
  for (const row of resultWithoutAnchoredTops) {
    finalResult.push(row);
    const additions = insertions.get(row);
    if (additions) finalResult.push(...additions);
  }
  return finalResult;
}

export function applyHomeCatalogPreferences(rows: CatalogRowData[], preferences: HomePreferences) {
  const hidden = new Set(preferences.hiddenCatalogKeys);
  const filtered = rows.filter(row => !hidden.has(catalogPreferenceKey(row)));
  const ordered = sortHomeCatalogRows(filtered, preferences);
  const explicitOrder = new Set(preferences.catalogOrder);

  // A saved order is an explicit user decision. New catalogs that do not yet
  // appear in that order use the selected orientation as their default slot.
  // En modo "both" la sub-preferencia (anime o series/pelis) decide qué va primero.
  const prioritized = ordered.sort((a, b) => {
    const aExplicit = explicitOrder.has(catalogPreferenceKey(a));
    const bExplicit = explicitOrder.has(catalogPreferenceKey(b));
    if (aExplicit || bExplicit) return 0;
    return contentOrientationPriority(a.type, preferences.contentOrientation, preferences.bothPreference)
      - contentOrientationPriority(b.type, preferences.contentOrientation, preferences.bothPreference);
  });

  return explicitOrder.size > 0 ? prioritized : interleaveMovieSeriesRows(prioritized);
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
    bothPreference: normalizeBothPreference(preferences.bothPreference),
    posterLayout: preferences.posterLayout === "horizontal" ? "horizontal" : "vertical",
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

function normalizeBothPreference(value: unknown): BothContentPreference {
  if (value === "anime") return "anime";
  return "movies-series";
}

function contentOrientationPriority(
  type: string,
  orientation: ContentOrientation,
  bothPreference: BothContentPreference = DEFAULT_HOME_PREFERENCES.bothPreference,
) {
  if (orientation === "both") {
    const isAnime = isAnimeType(type);
    if (bothPreference === "anime") return isAnime ? 0 : 1;
    return isAnime ? 1 : 0;
  }
  return matchesContentOrientation(type, orientation) ? 0 : 1;
}

function getHomePreferencesStorageKey() {
  return getScopedStorageKey(HOME_PREFERENCES_STORAGE_KEY);
}
