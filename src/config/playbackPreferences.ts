import { useEffect, useState } from "react";
import type { MediaStream } from "../types/stream.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";
import {
  clampNextEpisodeThresholdMinutes,
  clampNextEpisodeThresholdPercent,
  clampPostPlayMovieThresholdPercent,
  normalizeThresholdMode,
  type NextEpisodeThresholdMode,
} from "../pages/Player/nextEpisodeRules.ts";

export type SourceSelectionMode = "manual" | "first";
export type AddonSubtitleLoadMode = "preferred" | "all";
export type HardwareDecodingMode = "auto" | "enabled" | "disabled";
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
  audioPassthrough: boolean;
  skipSegmentsEnabled: boolean;
  animeSkipEnabled: boolean;
  autoPlayNextEpisode: boolean;
  preferBingeGroup: boolean;
  nextEpisodeThresholdMode: NextEpisodeThresholdMode;
  nextEpisodeThresholdPercent: number;
  nextEpisodeThresholdMinutesBeforeEnd: number;
  preferredSubtitleLanguage: string;
  addonSubtitleLoadMode: AddonSubtitleLoadMode;
  /** When true, the desktop runtime advertises what is being watched to Discord. */
  enableDiscordRichPresence: boolean;
  /** Cuando termina la película/serie, muestra la página "Up Next" con recomendación y mini reproductor. */
  upNextEnabled: boolean;
  /** Umbral de pelis estilo Nuvio (shouldShowMovieRecommendation): % puro, 80-100. */
  postPlayMovieThresholdPercent: number;
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
  reuseLastLink: true,
  lastLinkCacheHours: 24,
  sourceSelectionMode: "manual",
  hardwareDecoding: "auto",
  audioPassthrough: false,
  skipSegmentsEnabled: true,
  animeSkipEnabled: false,
  autoPlayNextEpisode: true,
  preferBingeGroup: true,
  nextEpisodeThresholdMode: "percentage",
  nextEpisodeThresholdPercent: 99,
  nextEpisodeThresholdMinutesBeforeEnd: 2,
  postPlayMovieThresholdPercent: 90,
  preferredSubtitleLanguage: "spa",
  addonSubtitleLoadMode: "preferred",
  enableDiscordRichPresence: true,
  upNextEnabled: true,
};

export const LANGUAGE_OPTIONS = [
  { value: "", label: "Sin preferencia" },
  { value: ORIGINAL_LANGUAGE_VALUE, label: "Original" },
  { value: "spa", label: "Español" },
  { value: "eng", label: "Inglés" },
  { value: "jpn", label: "Japonés" },
  { value: "por", label: "Portugués" },
  { value: "fra", label: "Francés" },
  { value: "deu", label: "Alemán" },
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
  // Keep removed controls in storage for backwards compatibility. They are
  // intentionally not part of the runtime contract anymore, but rewriting
  // another playback preference must not destroy a user's old data.
  const storageKey = getPlaybackPreferencesStorageKey();
  let legacy: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const previous = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["introDbSubmissionEnabled"]) {
        if (Object.prototype.hasOwnProperty.call(previous, key)) legacy[key] = previous[key];
      }
    }
  } catch {
    legacy = {};
  }
  localStorage.setItem(storageKey, JSON.stringify({ ...normalized, ...legacy }));
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
    audioPassthrough: typeof preferences.audioPassthrough === "boolean"
      ? preferences.audioPassthrough
      : DEFAULT_PLAYBACK_PREFERENCES.audioPassthrough,
    skipSegmentsEnabled: typeof preferences.skipSegmentsEnabled === "boolean" ? preferences.skipSegmentsEnabled : DEFAULT_PLAYBACK_PREFERENCES.skipSegmentsEnabled,
    animeSkipEnabled: typeof preferences.animeSkipEnabled === "boolean" ? preferences.animeSkipEnabled : DEFAULT_PLAYBACK_PREFERENCES.animeSkipEnabled,
    autoPlayNextEpisode: typeof preferences.autoPlayNextEpisode === "boolean" ? preferences.autoPlayNextEpisode : DEFAULT_PLAYBACK_PREFERENCES.autoPlayNextEpisode,
    preferBingeGroup: typeof preferences.preferBingeGroup === "boolean" ? preferences.preferBingeGroup : DEFAULT_PLAYBACK_PREFERENCES.preferBingeGroup,
    nextEpisodeThresholdMode: normalizeThresholdMode(
      (preferences as Record<string, unknown>).nextEpisodeThresholdMode ?? DEFAULT_PLAYBACK_PREFERENCES.nextEpisodeThresholdMode,
    ),
    nextEpisodeThresholdPercent: clampNextEpisodeThresholdPercent(
      preferences.nextEpisodeThresholdPercent,
      DEFAULT_PLAYBACK_PREFERENCES.nextEpisodeThresholdPercent,
    ),
    nextEpisodeThresholdMinutesBeforeEnd: clampNextEpisodeThresholdMinutes(
      (preferences as Record<string, unknown>).nextEpisodeThresholdMinutesBeforeEnd,
      DEFAULT_PLAYBACK_PREFERENCES.nextEpisodeThresholdMinutesBeforeEnd,
    ),
    preferredSubtitleLanguage: normalizeLanguage(preferences.preferredSubtitleLanguage, DEFAULT_PLAYBACK_PREFERENCES.preferredSubtitleLanguage),
    addonSubtitleLoadMode: preferences.addonSubtitleLoadMode === "all" ? "all" : "preferred",
    enableDiscordRichPresence: typeof preferences.enableDiscordRichPresence === "boolean" ? preferences.enableDiscordRichPresence : DEFAULT_PLAYBACK_PREFERENCES.enableDiscordRichPresence,
    upNextEnabled: typeof preferences.upNextEnabled === "boolean" ? preferences.upNextEnabled : DEFAULT_PLAYBACK_PREFERENCES.upNextEnabled,
    postPlayMovieThresholdPercent: clampPostPlayMovieThresholdPercent(
      preferences.postPlayMovieThresholdPercent,
      DEFAULT_PLAYBACK_PREFERENCES.postPlayMovieThresholdPercent,
    ),
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
