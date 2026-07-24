import { useEffect, useState } from "react";
import type { MediaStream } from "../types/stream.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

export type SourceSelectionMode = "manual" | "first";
export type AddonSubtitleLoadMode = "preferred" | "all";
export type HardwareDecodingMode = "auto" | "enabled" | "disabled";
export type NextEpisodeThresholdMode = "percentage";
export const ORIGINAL_LANGUAGE_VALUE = "original";

export interface PlaybackPreferences {
  showLoadingOverlay: boolean;
  holdToAccelerate: boolean;
  holdToAccelerateSpeed: number;
  firstAudioLanguage: string;
  secondAudioLanguage: string;
  secondSubtitleLanguage: string;
  reuseLastLink: boolean;
  lastLinkCacheHours: number;
  sourceSelectionMode: SourceSelectionMode;
  hardwareDecoding: HardwareDecodingMode;
  skipSegmentsEnabled: boolean;
  animeSkipEnabled: boolean;
  introDbSubmissionEnabled: boolean;
  autoPlayNextEpisode: boolean;
  preferBingeGroup: boolean;
  nextEpisodeThresholdMode: NextEpisodeThresholdMode;
  nextEpisodeThresholdPercent: number;
  preferredSubtitleLanguage: string;
  addonSubtitleLoadMode: AddonSubtitleLoadMode;
}

interface CachedLastLink {
  savedAt: number;
  stream: MediaStream;
}

export const PLAYBACK_PREFERENCES_STORAGE_KEY = "aetherio-playback-preferences";
export const PLAYBACK_PREFERENCES_CHANGED_EVENT = "aetherio-playback-preferences-changed";
const LAST_LINK_STORAGE_KEY = "aetherio-last-links";

export const DEFAULT_PLAYBACK_PREFERENCES: PlaybackPreferences = {
  showLoadingOverlay: true,
  holdToAccelerate: true,
  holdToAccelerateSpeed: 2,
  firstAudioLanguage: "spa",
  secondAudioLanguage: "eng",
  secondSubtitleLanguage: "",
  reuseLastLink: false,
  lastLinkCacheHours: 24,
  sourceSelectionMode: "manual",
  hardwareDecoding: "auto",
  skipSegmentsEnabled: true,
  animeSkipEnabled: false,
  introDbSubmissionEnabled: false,
  autoPlayNextEpisode: true,
  preferBingeGroup: true,
  nextEpisodeThresholdMode: "percentage",
  nextEpisodeThresholdPercent: 99,
  preferredSubtitleLanguage: "spa",
  addonSubtitleLoadMode: "preferred",
};

export const LANGUAGE_OPTIONS = [
  { value: "", label: "Sin preferencia" },
  { value: ORIGINAL_LANGUAGE_VALUE, label: "Original" },
  { value: "spa", label: "Español" },
  { value: "eng", label: "Ingles" },
  { value: "jpn", label: "Japones" },
  { value: "kor", label: "Coreano" },
  { value: "por", label: "Portugues" },
  { value: "fra", label: "Frances" },
  { value: "deu", label: "Aleman" },
  { value: "ita", label: "Italiano" },
  { value: "zho", label: "Chino" },
  { value: "rus", label: "Ruso" },
];

const LANGUAGE_ALIASES: Record<string, string[]> = {
  spa: ["spa", "es", "esp", "es-419", "lat", "la", "spanish", "espanol","español", "latino", "castellano"],
  eng: ["eng", "en", "english", "ingles", "inglés"],
  jpn: ["jpn", "ja", "jp", "japanese", "japones", "japonés"],
  kor: ["kor", "ko", "korean", "coreano"],
  por: ["por", "pt", "pt-br", "portuguese", "portugues", "portugués", "brasil"],
  fra: ["fra", "fre", "fr", "french", "frances", "francés"],
  deu: ["deu", "ger", "de", "german", "aleman", "alemán"],
  ita: ["ita", "it", "italian", "italiano"],
  zho: ["zho", "chi", "zh", "chinese", "chino"],
  rus: ["rus", "ru", "russian", "ruso"],
};

Object.assign(LANGUAGE_ALIASES, {
  es: LANGUAGE_ALIASES.spa,
  en: LANGUAGE_ALIASES.eng,
  ja: LANGUAGE_ALIASES.jpn,
  ko: LANGUAGE_ALIASES.kor,
  pt: LANGUAGE_ALIASES.por,
  fr: LANGUAGE_ALIASES.fra,
  de: LANGUAGE_ALIASES.deu,
  it: LANGUAGE_ALIASES.ita,
  zh: LANGUAGE_ALIASES.zho,
  ru: LANGUAGE_ALIASES.rus,
});

LANGUAGE_ALIASES.spa.push("es-la", "latam", "latin", "latin american", "español");
LANGUAGE_ALIASES.eng.push("inglés");
LANGUAGE_ALIASES.jpn.push("japonés");
LANGUAGE_ALIASES.por.push("portugués");
LANGUAGE_ALIASES.fra.push("francés");
LANGUAGE_ALIASES.deu.push("alemán");

export function getPlaybackPreferences(): PlaybackPreferences {
  try {
    const raw = localStorage.getItem(getPlaybackPreferencesStorageKey());
    if (!raw) return DEFAULT_PLAYBACK_PREFERENCES;
    return normalizePlaybackPreferences(JSON.parse(raw) as Partial<PlaybackPreferences>);
  } catch {
    return DEFAULT_PLAYBACK_PREFERENCES;
  }
}

export function savePlaybackPreferences(preferences: PlaybackPreferences) {
  const normalized = normalizePlaybackPreferences(preferences);
  localStorage.setItem(getPlaybackPreferencesStorageKey(), JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(PLAYBACK_PREFERENCES_CHANGED_EVENT, { detail: normalized }));
}

export function usePlaybackPreferences() {
  const [preferences, setPreferences] = useState<PlaybackPreferences>(() => getPlaybackPreferences());

  useEffect(() => {
    const refresh = () => setPreferences(getPlaybackPreferences());
    window.addEventListener(PLAYBACK_PREFERENCES_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PLAYBACK_PREFERENCES_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return preferences;
}

export function matchesPreferredLanguage(value: string | null | undefined, preferredLanguage: string) {
  const preferred = preferredLanguage.trim().toLowerCase();
  if (!preferred || preferred === ORIGINAL_LANGUAGE_VALUE) return false;
  const normalized = normalizeLanguageText(value);
  if (!normalized) return false;
  const aliases = LANGUAGE_ALIASES[preferred] ?? [preferred];
  const tokens = normalized
    .split(/[^a-z0-9-]+/g)
    .map(token => token.trim())
    .filter(Boolean);
  return aliases.some(rawAlias => {
    const alias = normalizeLanguageText(rawAlias);
    if (!alias) return false;
    if (normalized === alias) return true;
    if (tokens.includes(alias)) return true;
    if (alias.length >= 4 && normalized.includes(alias)) return true;
    return false;
  });
}

export function resolvePreferredLanguage(preferredLanguage: string, originalLanguage: string | null | undefined) {
  const preferred = preferredLanguage.trim().toLowerCase();
  if (preferred !== ORIGINAL_LANGUAGE_VALUE) return preferred;
  return normalizeLanguageText(originalLanguage);
}

export function streamCacheKey(type: string, id: string, season?: number, episode?: number) {
  return season && episode ? `${type}:${id}:${season}:${episode}` : `${type}:${id}`;
}

export function saveLastLink(cacheKey: string, stream: MediaStream) {
  try {
    const cache = readLastLinkCache();
    cache[cacheKey] = { savedAt: Date.now(), stream };
    localStorage.setItem(getLastLinkStorageKey(), JSON.stringify(cache));
  } catch {
    // Best-effort local cache only.
  }
}

export function getCachedLastLink(cacheKey: string, cacheHours: number) {
  try {
    const cache = readLastLinkCache();
    const cached = cache[cacheKey];
    if (!cached?.stream || !cached.savedAt) return null;
    const ttlMs = Math.max(1, cacheHours) * 60 * 60 * 1000;
    if (Date.now() - cached.savedAt > ttlMs) {
      delete cache[cacheKey];
      localStorage.setItem(getLastLinkStorageKey(), JSON.stringify(cache));
      return null;
    }
    return cached.stream;
  } catch {
    return null;
  }
}

function normalizePlaybackPreferences(preferences: Partial<PlaybackPreferences>): PlaybackPreferences {
  return {
    showLoadingOverlay: typeof preferences.showLoadingOverlay === "boolean" ? preferences.showLoadingOverlay : DEFAULT_PLAYBACK_PREFERENCES.showLoadingOverlay,
    holdToAccelerate: typeof preferences.holdToAccelerate === "boolean" ? preferences.holdToAccelerate : DEFAULT_PLAYBACK_PREFERENCES.holdToAccelerate,
    holdToAccelerateSpeed: clampFloat(preferences.holdToAccelerateSpeed, 1, 4, DEFAULT_PLAYBACK_PREFERENCES.holdToAccelerateSpeed),
    firstAudioLanguage: normalizeLanguage(preferences.firstAudioLanguage, DEFAULT_PLAYBACK_PREFERENCES.firstAudioLanguage),
    secondAudioLanguage: normalizeLanguage(preferences.secondAudioLanguage, DEFAULT_PLAYBACK_PREFERENCES.secondAudioLanguage),
    secondSubtitleLanguage: normalizeLanguage(preferences.secondSubtitleLanguage, DEFAULT_PLAYBACK_PREFERENCES.secondSubtitleLanguage),
    reuseLastLink: typeof preferences.reuseLastLink === "boolean" ? preferences.reuseLastLink : DEFAULT_PLAYBACK_PREFERENCES.reuseLastLink,
    lastLinkCacheHours: clampNumber(preferences.lastLinkCacheHours, 1, 720, DEFAULT_PLAYBACK_PREFERENCES.lastLinkCacheHours),
    sourceSelectionMode: preferences.sourceSelectionMode === "first" ? "first" : "manual",
    hardwareDecoding: normalizeHardwareDecoding(preferences.hardwareDecoding),
    skipSegmentsEnabled: typeof preferences.skipSegmentsEnabled === "boolean" ? preferences.skipSegmentsEnabled : DEFAULT_PLAYBACK_PREFERENCES.skipSegmentsEnabled,
    animeSkipEnabled: typeof preferences.animeSkipEnabled === "boolean" ? preferences.animeSkipEnabled : DEFAULT_PLAYBACK_PREFERENCES.animeSkipEnabled,
    introDbSubmissionEnabled: typeof preferences.introDbSubmissionEnabled === "boolean" ? preferences.introDbSubmissionEnabled : DEFAULT_PLAYBACK_PREFERENCES.introDbSubmissionEnabled,
    autoPlayNextEpisode: typeof preferences.autoPlayNextEpisode === "boolean" ? preferences.autoPlayNextEpisode : DEFAULT_PLAYBACK_PREFERENCES.autoPlayNextEpisode,
    preferBingeGroup: typeof preferences.preferBingeGroup === "boolean" ? preferences.preferBingeGroup : DEFAULT_PLAYBACK_PREFERENCES.preferBingeGroup,
    nextEpisodeThresholdMode: "percentage",
    nextEpisodeThresholdPercent: clampNumber(preferences.nextEpisodeThresholdPercent, 50, 100, DEFAULT_PLAYBACK_PREFERENCES.nextEpisodeThresholdPercent),
    preferredSubtitleLanguage: normalizeLanguage(preferences.preferredSubtitleLanguage, DEFAULT_PLAYBACK_PREFERENCES.preferredSubtitleLanguage),
    addonSubtitleLoadMode: preferences.addonSubtitleLoadMode === "all" ? "all" : "preferred",
  };
}

function normalizeLanguage(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  return value.trim().toLowerCase();
}

function normalizeHardwareDecoding(value: unknown): HardwareDecodingMode {
  if (value === "enabled" || value === "disabled") return value;
  return "auto";
}

function normalizeLanguageText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readLastLinkCache() {
  const raw = localStorage.getItem(getLastLinkStorageKey());
  if (!raw) return {} as Record<string, CachedLastLink>;
  return JSON.parse(raw) as Record<string, CachedLastLink>;
}

function getPlaybackPreferencesStorageKey() {
  return getScopedStorageKey(PLAYBACK_PREFERENCES_STORAGE_KEY);
}

function getLastLinkStorageKey() {
  return getScopedStorageKey(LAST_LINK_STORAGE_KEY);
}
