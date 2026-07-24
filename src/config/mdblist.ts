import { useEffect, useState } from "react";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

export type MdbListProvider =
  | "trakt"
  | "imdb"
  | "tmdb"
  | "letterboxd"
  | "tomatoes"
  | "metacritic";

export type MdbListProviderSettingKey =
  | "showTrakt"
  | "showImdb"
  | "showTmdb"
  | "showLetterboxd"
  | "showTomatoes"
  | "showMetacritic";

export interface MdbListSettings {
  enabled: boolean;
  apiKey: string;
  showTrakt: boolean;
  showImdb: boolean;
  showTmdb: boolean;
  showLetterboxd: boolean;
  showTomatoes: boolean;
  showMetacritic: boolean;
}

export type MdbListRatings = Partial<Record<MdbListProvider, number>>;

export const MDBLIST_SETTINGS_STORAGE_KEY = "aetherio-mdblist-settings-v1";
export const MDBLIST_SETTINGS_CHANGED_EVENT = "aetherio-mdblist-settings-changed";

export const DEFAULT_MDBLIST_SETTINGS: MdbListSettings = {
  enabled: false,
  apiKey: "",
  showTrakt: true,
  showImdb: true,
  showTmdb: true,
  showLetterboxd: true,
  showTomatoes: true,
  showMetacritic: true,
};

export const MDBLIST_PROVIDER_OPTIONS: Array<{
  provider: MdbListProvider;
  settingKey: MdbListProviderSettingKey;
  label: string;
  description: string;
}> = [
  { provider: "trakt", settingKey: "showTrakt", label: "Trakt", description: "Mostrar puntuacion de Trakt." },
  { provider: "imdb", settingKey: "showImdb", label: "IMDb", description: "Mostrar puntuacion de IMDb." },
  { provider: "tmdb", settingKey: "showTmdb", label: "TMDB", description: "Mostrar puntuacion de TMDB." },
  { provider: "letterboxd", settingKey: "showLetterboxd", label: "Letterboxd", description: "Mostrar puntuacion de Letterboxd." },
  { provider: "tomatoes", settingKey: "showTomatoes", label: "Rotten Tomatoes", description: "Mostrar puntuacion de criticos." },
  { provider: "metacritic", settingKey: "showMetacritic", label: "Metacritic", description: "Mostrar puntuacion de Metacritic." },
];

export function getMdbListSettings(): MdbListSettings {
  try {
    const raw = localStorage.getItem(getMdbListSettingsStorageKey());
    if (!raw) return DEFAULT_MDBLIST_SETTINGS;
    return normalizeMdbListSettings(JSON.parse(raw) as Partial<MdbListSettings>);
  } catch {
    return DEFAULT_MDBLIST_SETTINGS;
  }
}

export function saveMdbListSettings(settings: MdbListSettings) {
  const normalized = normalizeMdbListSettings(settings);
  localStorage.setItem(getMdbListSettingsStorageKey(), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(MDBLIST_SETTINGS_CHANGED_EVENT, { detail: normalized }));
}

export function useMdbListSettings() {
  const [settings, setSettings] = useState<MdbListSettings>(() => getMdbListSettings());

  useEffect(() => {
    const refresh = () => setSettings(getMdbListSettings());
    window.addEventListener(MDBLIST_SETTINGS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MDBLIST_SETTINGS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return settings;
}

export function getEnabledMdbListProviders(settings: MdbListSettings): MdbListProvider[] {
  return MDBLIST_PROVIDER_OPTIONS
    .filter(option => settings[option.settingKey])
    .map(option => option.provider);
}

function normalizeMdbListSettings(settings: Partial<MdbListSettings>): MdbListSettings {
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : DEFAULT_MDBLIST_SETTINGS.enabled,
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : DEFAULT_MDBLIST_SETTINGS.apiKey,
    showTrakt: typeof settings.showTrakt === "boolean" ? settings.showTrakt : DEFAULT_MDBLIST_SETTINGS.showTrakt,
    showImdb: typeof settings.showImdb === "boolean" ? settings.showImdb : DEFAULT_MDBLIST_SETTINGS.showImdb,
    showTmdb: typeof settings.showTmdb === "boolean" ? settings.showTmdb : DEFAULT_MDBLIST_SETTINGS.showTmdb,
    showLetterboxd: typeof settings.showLetterboxd === "boolean" ? settings.showLetterboxd : DEFAULT_MDBLIST_SETTINGS.showLetterboxd,
    showTomatoes: typeof settings.showTomatoes === "boolean" ? settings.showTomatoes : DEFAULT_MDBLIST_SETTINGS.showTomatoes,
    showMetacritic: typeof settings.showMetacritic === "boolean" ? settings.showMetacritic : DEFAULT_MDBLIST_SETTINGS.showMetacritic,
  };
}

function getMdbListSettingsStorageKey() {
  return getScopedStorageKey(MDBLIST_SETTINGS_STORAGE_KEY);
}
