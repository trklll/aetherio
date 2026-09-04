import { useEffect, useState } from "react";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

export type BetterPosterRatingSource = "avg" | "IM" | "TM" | "RT" | "MC" | "TR" | "LB" | "RE";

export interface BetterPosterSettings {
  /** Interruptor maestro. true por defecto: el usuario final no tiene que hacer nada. */
  enabled: boolean;
  showGenre: boolean;
  showRating: boolean;
  trendTags: boolean;
  qualityTags: boolean;
  ageRating: boolean;
  ratingSource: BetterPosterRatingSource;
  /** Código de idioma btttr.cc: en, es-ES, es-MX, fr, de, pt-BR, ... */
  lang: string;
}

export const BETTER_POSTER_SETTINGS_STORAGE_KEY = "aetherio-better-posters-v2";
export const BETTER_POSTER_CHANGED_EVENT = "aetherio-better-posters-changed";

const BTTTR_ORIGIN = "https://btttr.cc";

export const BETTER_POSTER_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "es-ES", label: "Español (España)" },
  { value: "es-MX", label: "Español (Latinoamérica)" },
  { value: "en", label: "English" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "it", label: "Italiano" },
];

export const BETTER_POSTER_RATING_SOURCE_OPTIONS: Array<{ value: BetterPosterRatingSource; label: string }> = [
  { value: "avg", label: "Promedio btttr.cc" },
  { value: "IM", label: "IMDb (/10)" },
  { value: "TM", label: "TMDB (/10)" },
  { value: "RT", label: "Rotten Tomatoes (%)" },
  { value: "MC", label: "Metacritic (/100)" },
  { value: "TR", label: "Trakt (/10)" },
  { value: "LB", label: "Letterboxd (/5)" },
  { value: "RE", label: "Roger Ebert (/4)" },
];

function defaultLang(): string {
  try {
    const nav = typeof navigator !== "undefined" ? navigator.language ?? "" : "";
    if (/^es[-_]mx/i.test(nav)) return "es-MX";
    if (/^es/i.test(nav)) return "es-ES";
  } catch { /* noop */ }
  // La app es en español: por defecto servimos pósters en español.
  return "es-ES";
}

export const DEFAULT_BETTER_POSTER_SETTINGS: BetterPosterSettings = {
  enabled: true,
  showGenre: true,
  showRating: false,
  trendTags: true,
  qualityTags: false,
  ageRating: false,
  ratingSource: "avg",
  lang: "es-ES",
};

export function getBetterPosterSettings(): BetterPosterSettings {
  try {
    const raw = typeof localStorage !== "undefined"
      ? localStorage.getItem(getBetterPosterSettingsStorageKey())
      : null;
    if (!raw) return { ...DEFAULT_BETTER_POSTER_SETTINGS, lang: defaultLang() };
    return normalizeBetterPosterSettings(JSON.parse(raw) as Partial<BetterPosterSettings>);
  } catch {
    return { ...DEFAULT_BETTER_POSTER_SETTINGS, lang: defaultLang() };
  }
}

export function saveBetterPosterSettings(settings: BetterPosterSettings) {
  const normalized = normalizeBetterPosterSettings(settings);
  try {
    localStorage.setItem(getBetterPosterSettingsStorageKey(), JSON.stringify(normalized));
  } catch { /* almacenamiento best-effort */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BETTER_POSTER_CHANGED_EVENT, { detail: normalized }));
  }
}

export function useBetterPosterSettings() {
  const [settings, setSettings] = useState<BetterPosterSettings>(() => getBetterPosterSettings());
  useEffect(() => {
    const refresh = () => setSettings(getBetterPosterSettings());
    window.addEventListener(BETTER_POSTER_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BETTER_POSTER_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return settings;
}

/** Firma corta para invalidar cachés de catálogos cuando cambian los ajustes. */
export function betterPosterSignature(settings?: BetterPosterSettings): string {
  const s = settings ?? getBetterPosterSettings();
  return [
    s.enabled ? "on" : "off",
    s.showGenre ? "g" : "-",
    s.showRating ? "r" : "-",
    s.trendTags ? "t" : "-",
    s.qualityTags ? "q" : "-",
    s.ageRating ? "a" : "-",
    s.ratingSource,
    s.lang,
  ].join("|");
}

/** Extrae tt1234567 de un id Stremio/TMDB o de externalIds. */
export function extractImdbId(id?: string | null, externalImdb?: string | null): string | null {
  const fromExternal = externalImdb?.match(/tt\d+/i)?.[0];
  if (fromExternal) return fromExternal;
  const fromId = (id ?? "").match(/tt\d+/i)?.[0];
  return fromId ?? null;
}

export function isBetterPosterUrl(url?: string | null): boolean {
  return Boolean(url && /^https:\/\/btttr\.cc\//i.test(url));
}

export interface BetterPosterOverrides {
  /** En filas top el número grande ya indica el puesto: oculta badges #Hoy. */
  trendTags?: boolean;
}

/**
 * Construye la URL de póster btttr.cc modo "poster URL" (compatible AIOMetadata).
 * Replica la lógica de https://btttr.cc/configure → updateAioUrl().
 */
export function buildBetterPosterUrl(
  imdbId: string,
  settings?: BetterPosterSettings,
  overrides?: BetterPosterOverrides,
): string {
  const s = settings ?? getBetterPosterSettings();
  const tt = imdbId.match(/tt\d+/i)?.[0] ?? imdbId;
  let base: string;
  if (s.showGenre && s.showRating) base = "poster";
  else if (s.showGenre) base = "poster-g";
  else if (s.showRating) base = "poster-r";
  else base = "poster-n";
  const suffix = `${s.qualityTags ? "q" : ""}${s.ageRating ? "a" : ""}`;
  if (suffix) base += base.includes("-") ? suffix : `-${suffix}`;
  const params: string[] = [];
  const trendTags = overrides?.trendTags ?? s.trendTags;
  if (!trendTags) params.push("tag=none");
  if (s.lang && s.lang !== "en") params.push(`lang=${encodeURIComponent(s.lang)}`);
  if (s.ratingSource && s.ratingSource !== "avg") params.push(`rs=${encodeURIComponent(s.ratingSource)}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  return `${BTTTR_ORIGIN}/${base}/imdb/poster-default/${tt}.jpg${qs}`;
}

/**
 * Devuelve la URL BetterPosters si está activado y hay IMDb id; si no, la original.
 * Nunca lanza: ante cualquier duda devuelve `originalUrl`.
 */
export function applyBetterPosterToUrl(
  originalUrl: string | undefined,
  imdbId: string | null | undefined,
  settings?: BetterPosterSettings,
  overrides?: BetterPosterOverrides,
): string | undefined {
  try {
    const s = settings ?? getBetterPosterSettings();
    if (!s.enabled || !imdbId) return originalUrl;
    if (isBetterPosterUrl(originalUrl) && overrides?.trendTags === undefined) return originalUrl;
    return buildBetterPosterUrl(imdbId, s, overrides);
  } catch {
    return originalUrl;
  }
}

function normalizeBetterPosterSettings(settings: Partial<BetterPosterSettings>): BetterPosterSettings {
  const validSources: BetterPosterRatingSource[] = ["avg", "IM", "TM", "RT", "MC", "TR", "LB", "RE"];
  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : DEFAULT_BETTER_POSTER_SETTINGS.enabled,
    showGenre: typeof settings.showGenre === "boolean" ? settings.showGenre : DEFAULT_BETTER_POSTER_SETTINGS.showGenre,
    showRating: typeof settings.showRating === "boolean" ? settings.showRating : DEFAULT_BETTER_POSTER_SETTINGS.showRating,
    trendTags: typeof settings.trendTags === "boolean" ? settings.trendTags : DEFAULT_BETTER_POSTER_SETTINGS.trendTags,
    qualityTags: typeof settings.qualityTags === "boolean" ? settings.qualityTags : DEFAULT_BETTER_POSTER_SETTINGS.qualityTags,
    ageRating: typeof settings.ageRating === "boolean" ? settings.ageRating : DEFAULT_BETTER_POSTER_SETTINGS.ageRating,
    ratingSource: validSources.includes(settings.ratingSource as BetterPosterRatingSource)
      ? (settings.ratingSource as BetterPosterRatingSource)
      : DEFAULT_BETTER_POSTER_SETTINGS.ratingSource,
    lang: typeof settings.lang === "string" && settings.lang.trim()
      ? settings.lang.trim()
      : defaultLang(),
  };
}

function getBetterPosterSettingsStorageKey() {
  try {
    return getScopedStorageKey(BETTER_POSTER_SETTINGS_STORAGE_KEY);
  } catch {
    return BETTER_POSTER_SETTINGS_STORAGE_KEY;
  }
}
