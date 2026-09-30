import { useEffect, useState } from "react";
import { getKnownSpatialAvailability, resetSpatialAvailability } from "../services/spatialInstance.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

/**
 * Integración con SpatialPosters.
 *
 * SpatialPosters es un renderizador de pósters **server-side** (Next.js + sharp +
 * resvg). No se puede embeber en el webview de Tauri, así que corre como proceso
 * hermano al que Aetherio le habla por HTTP:
 *
 *   {instanceUrl}/api/poster/{movie|tv}/{tmdbId}?…params
 *
 * Ventaja clave frente a BetterPosters (btttr.cc): btttr solo servía por IMDb
 * (`/poster/imdb/poster-default/{tt}.jpg`), lo que obligaba a Aetherio a llevar
 * toda una capa de resolución TMDB→IMDb. SpatialPosters acepta el ID TMDB
 * nativo, así que esa capa desaparece.
 */

/** Estilos de badge globally disponibles en SpatialPosters (`BADGE_STYLES`). */
export type SpatialBadgeStyle = "shadow" | "pill" | "bar" | "colored" | "bordo" | "vetro";

/** Estilos del badge de ranking (`RANKING_BADGE_STYLES`). */
export type SpatialRankingBadgeStyle = "default" | "bar" | "colored" | "pill" | "netflix";

/** Regiones soportadas por SpatialPosters (`regions.ts`). */
export type SpatialRegion = "IT" | "US" | "GB" | "FR" | "DE" | "ES" | "MX" | "IL" | "JP" | "KR" | "BR" | "IN" | "CA" | "AU";

/** Idioma de los badges en el póster. */
export type SpatialLang = "en" | "es" | "fr" | "de" | "pt" | "it" | "ja" | "ko" | "he";

export interface SpatialPosterSettings {
  /** Interruptor maestro. Con `instanceUrl` vacío el pipeline queda apagado. */
  enabled: boolean;
  /**
   * Base URL de la instancia autoalojada del usuario, sin slash final.
   * Viene por defecto apuntando a la instancia local (`npm run posters:start`),
   * asi que no hay nada que configurar para usar SpatialPosters.
   */
  instanceUrl: string;
  region: SpatialRegion;
  lang: SpatialLang;

  /** Badges de info (género/año/rating) sobre el póster. */
  globalBadges: boolean;
  badgeGenre: boolean;
  badgeYear: boolean;
  badgeRating: boolean;
  badgeStyle: SpatialBadgeStyle;

  /** Badges de ranking (#N de JustWatch / Top 10 streaming). */
  rankingBadges: boolean;
  rankingBadgeStyle: SpatialRankingBadgeStyle;

  /** Badge de calidad/formato (4K, HDR, Dolby Vision, IMAX…). */
  qualityBadges: boolean;
  /** Tipo de badge de formato a destacar: "4K" | "HDR" | "DV" | "IMAX". */
  manualQuality: "" | "4K" | "HDR" | "DV" | "IMAX";

  networkLogo: boolean;
  /** Ajuste fino del logo de la distribuidora: escala y desplazamiento. */
  logoScale: number;
  logoOffsetX: number;
  logoOffsetY: number;
  ribbonSide: "left" | "right";

  blurEnabled: boolean;
  blurIntensity: number;
  blurFade: number;
  blurDarkness: number;
  gradientHeight: number;
}

export const SPATIAL_POSTER_SETTINGS_STORAGE_KEY = "aetherio-spatial-posters-v1";
export const SPATIAL_POSTER_CHANGED_EVENT = "aetherio-spatial-posters-changed";

export const SPATIAL_BADGE_STYLE_OPTIONS: Array<{ value: SpatialBadgeStyle; label: string }> = [
  { value: "shadow", label: "Sombra" },
  { value: "pill", label: "Píldora" },
  { value: "bar", label: "Barra" },
  { value: "colored", label: "Coloreado" },
  { value: "bordo", label: "Borde" },
  { value: "vetro", label: "Vidrio" },
];

export const SPATIAL_RANKING_BADGE_STYLE_OPTIONS: Array<{ value: SpatialRankingBadgeStyle; label: string }> = [
  { value: "default", label: "Por defecto" },
  { value: "bar", label: "Barra" },
  { value: "colored", label: "Coloreado" },
  { value: "pill", label: "Píldora" },
  { value: "netflix", label: "Estilo Netflix" },
];

export const SPATIAL_REGION_OPTIONS: Array<{ value: SpatialRegion; label: string }> = [
  { value: "MX", label: "México / LATAM" },
  { value: "ES", label: "España" },
  { value: "US", label: "Estados Unidos" },
  { value: "BR", label: "Brasil" },
  { value: "IT", label: "Italia" },
  { value: "FR", label: "Francia" },
  { value: "DE", label: "Alemania" },
  { value: "GB", label: "Reino Unido" },
  { value: "JP", label: "Japón" },
  { value: "KR", label: "Corea del Sur" },
  { value: "IN", label: "India" },
  { value: "CA", label: "Canadá" },
  { value: "AU", label: "Australia" },
  { value: "IL", label: "Israel" },
];

export const SPATIAL_LANG_OPTIONS: Array<{ value: SpatialLang; label: string }> = [
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "pt", label: "Português" },
  { value: "it", label: "Italiano" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "he", label: "עברית" },
];

export const SPATIAL_QUALITY_OPTIONS: Array<{ value: SpatialPosterSettings["manualQuality"]; label: string }> = [
  { value: "", label: "Automático" },
  { value: "4K", label: "4K" },
  { value: "HDR", label: "HDR" },
  { value: "DV", label: "Dolby Vision" },
  { value: "IMAX", label: "IMAX" },
];

const BADGE_STYLES: SpatialBadgeStyle[] = ["shadow", "pill", "bar", "colored", "bordo", "vetro"];
const RANKING_BADGE_STYLES: SpatialRankingBadgeStyle[] = ["default", "bar", "colored", "pill", "netflix"];
const REGIONS: SpatialRegion[] = ["IT", "US", "GB", "FR", "DE", "ES", "MX", "IL", "JP", "KR", "BR", "IN", "CA", "AU"];
const LANGS: SpatialLang[] = ["en", "es", "fr", "de", "pt", "it", "ja", "ko", "he"];
const QUALITIES: SpatialPosterSettings["manualQuality"][] = ["", "4K", "HDR", "DV", "IMAX"];

const NUMERIC_BOUNDS = {
  // Rangos reales de `poster-config.ts` upstream (clamp defensivo en el servidor).
  blurIntensity: { min: 1, max: 100, fallback: 5 },
  blurFade: { min: 0, max: 100, fallback: 60 },
  blurDarkness: { min: 0, max: 100, fallback: 40 },
  gradientHeight: { min: 5, max: 100, fallback: 30 },
  // `scale/ox/oy`: upstream usa `Number(q) || null`, así que 0 significa "auto".
  logoScale: { min: 1, max: 300, fallback: 100 },
  logoOffsetX: { min: -100, max: 100, fallback: 0 },
  logoOffsetY: { min: -100, max: 100, fallback: 0 },
} as const;

/** Instancia por defecto: la que levanta `npm run posters:start`. */
export const DEFAULT_SPATIAL_POSTER_INSTANCE_URL = "http://localhost:3000";

/**
 * Base del proxy de cache en disco, cuando Aetherio lo tiene levantado.
 *
 * El puerto del proxy es efimero, asi que vive aca en memoria y no en los
 * ajustes. Se consulta al arrancar la app.
 */
let posterCacheBaseUrl: string | null = null;

/** Avisa que hay un proxy de cache delante del servidor de posters. */
export function setPosterCacheUrl(url: string | null): void {
  const next = url ? normalizeInstanceUrl(url) : null;
  if (next === posterCacheBaseUrl) return;
  posterCacheBaseUrl = next;
  // La disponibilidad se midio contra otra URL: hay que volver a preguntarle.
  resetSpatialAvailability();
}

/**
 * URL contra la que realmente se piden los posters.
 *
 * Si el usuario no movio la instancia, se usa el proxy de cache: el mismo
 * resultado, pero con los posters guardados en disco entre arranques. Si la
 * movio a otro lado, se respeta su eleccion y no se le interpone nada.
 */
export function getEffectiveInstanceUrl(settings?: SpatialPosterSettings): string {
  const s = settings ?? getSpatialPosterSettings();
  const configured = normalizeInstanceUrl(s.instanceUrl);
  if (!posterCacheBaseUrl) return configured;
  const isDefault =
    !configured ||
    configured.toLowerCase() === DEFAULT_SPATIAL_POSTER_INSTANCE_URL.toLowerCase();
  return isDefault ? posterCacheBaseUrl : configured;
}

/** ¿La instancia sigue en su sitio, o el usuario la movio? */
export function usesDefaultInstance(settings?: SpatialPosterSettings): boolean {
  const configured = normalizeInstanceUrl((settings ?? getSpatialPosterSettings()).instanceUrl);
  if (!configured) return true;
  return configured.toLowerCase() === DEFAULT_SPATIAL_POSTER_INSTANCE_URL.toLowerCase();
}

export const DEFAULT_SPATIAL_POSTER_SETTINGS: SpatialPosterSettings = {
  enabled: true,
  instanceUrl: DEFAULT_SPATIAL_POSTER_INSTANCE_URL,
  region: "MX",
  lang: "es",
  globalBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  badgeStyle: "shadow",
  rankingBadges: true,
  rankingBadgeStyle: "default",
  qualityBadges: true,
  manualQuality: "",
  networkLogo: true,
  logoScale: 100,
  logoOffsetX: 0,
  logoOffsetY: 0,
  ribbonSide: "left",
  blurEnabled: true,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  gradientHeight: 30,
};

/** Normaliza la URL de instancia: sin slash final, solo http(s). */
export function normalizeInstanceUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  // Si ya trae esquema, solo se acepta http(s): prefijar a la fuerza convertiría
  // "ftp://x" en un host válido ("http://ftp//x") en vez de rechazarlo.
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  const withScheme = scheme ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/**
 * ¿Está SpatialPosters realmente configurado? Con `instanceUrl` vacío el
 * pipeline de pósters queda completamente apagado (sin prewarm, sin esperas
 * en el arranque) y Aetherio usa los pósters originales de TMDB.
 */
export function isSpatialPostersConfigured(settings: SpatialPosterSettings): boolean {
  return settings.enabled && normalizeInstanceUrl(settings.instanceUrl).length > 0;
}

function normalizeNumber(value: unknown, key: keyof typeof NUMERIC_BOUNDS): number {
  const { min, max, fallback } = NUMERIC_BOUNDS[key];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function normalizeSpatialPosterSettings(raw: Partial<SpatialPosterSettings>): SpatialPosterSettings {
  const d = DEFAULT_SPATIAL_POSTER_SETTINGS;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    instanceUrl: normalizeInstanceUrl(raw.instanceUrl),
    region: normalizeEnum(raw.region, REGIONS, d.region),
    lang: normalizeEnum(raw.lang, LANGS, d.lang),
    globalBadges: typeof raw.globalBadges === "boolean" ? raw.globalBadges : d.globalBadges,
    badgeGenre: typeof raw.badgeGenre === "boolean" ? raw.badgeGenre : d.badgeGenre,
    badgeYear: typeof raw.badgeYear === "boolean" ? raw.badgeYear : d.badgeYear,
    badgeRating: typeof raw.badgeRating === "boolean" ? raw.badgeRating : d.badgeRating,
    badgeStyle: normalizeEnum(raw.badgeStyle, BADGE_STYLES, d.badgeStyle),
    rankingBadges: typeof raw.rankingBadges === "boolean" ? raw.rankingBadges : d.rankingBadges,
    rankingBadgeStyle: normalizeEnum(raw.rankingBadgeStyle, RANKING_BADGE_STYLES, d.rankingBadgeStyle),
    qualityBadges: typeof raw.qualityBadges === "boolean" ? raw.qualityBadges : d.qualityBadges,
    manualQuality: normalizeEnum(raw.manualQuality, QUALITIES, d.manualQuality),
    networkLogo: typeof raw.networkLogo === "boolean" ? raw.networkLogo : d.networkLogo,
    logoScale: normalizeNumber(raw.logoScale, "logoScale"),
    logoOffsetX: normalizeNumber(raw.logoOffsetX, "logoOffsetX"),
    logoOffsetY: normalizeNumber(raw.logoOffsetY, "logoOffsetY"),
    ribbonSide: raw.ribbonSide === "right" ? "right" : "left",
    blurEnabled: typeof raw.blurEnabled === "boolean" ? raw.blurEnabled : d.blurEnabled,
    blurIntensity: normalizeNumber(raw.blurIntensity, "blurIntensity"),
    blurFade: normalizeNumber(raw.blurFade, "blurFade"),
    blurDarkness: normalizeNumber(raw.blurDarkness, "blurDarkness"),
    gradientHeight: normalizeNumber(raw.gradientHeight, "gradientHeight"),
  };
}

function getSpatialPosterSettingsStorageKey() {
  try {
    return getScopedStorageKey(SPATIAL_POSTER_SETTINGS_STORAGE_KEY);
  } catch {
    return SPATIAL_POSTER_SETTINGS_STORAGE_KEY;
  }
}

export function getSpatialPosterSettings(): SpatialPosterSettings {
  try {
    const raw = typeof localStorage !== "undefined"
      ? localStorage.getItem(getSpatialPosterSettingsStorageKey())
      : null;
    if (!raw) return { ...DEFAULT_SPATIAL_POSTER_SETTINGS };
    return normalizeSpatialPosterSettings(JSON.parse(raw) as Partial<SpatialPosterSettings>);
  } catch {
    return { ...DEFAULT_SPATIAL_POSTER_SETTINGS };
  }
}

export function saveSpatialPosterSettings(settings: SpatialPosterSettings) {
  const normalized = normalizeSpatialPosterSettings(settings);
  try {
    localStorage.setItem(getSpatialPosterSettingsStorageKey(), JSON.stringify(normalized));
  } catch { /* best-effort */ }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SPATIAL_POSTER_CHANGED_EVENT, { detail: normalized }));
  }
}

export function useSpatialPosterSettings() {
  const [settings, setSettings] = useState<SpatialPosterSettings>(() => getSpatialPosterSettings());
  useEffect(() => {
    const refresh = () => setSettings(getSpatialPosterSettings());
    window.addEventListener(SPATIAL_POSTER_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SPATIAL_POSTER_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return settings;
}

/**
 * Firma corta para invalidar cachés de catálogos/arte cuando cambian los
 * ajustes. `instanceUrl` entra en la firma: cambiar de instancia debe
 * reprocesar todo aunque el resto de ajustes coincida.
 */
export function spatialPosterSignature(settings?: SpatialPosterSettings): string {
  const s = settings ?? getSpatialPosterSettings();
  return [
    isSpatialPostersConfigured(s) ? "on" : "off",
    normalizeInstanceUrl(s.instanceUrl),
    s.region,
    s.lang,
    s.globalBadges ? "g" : "-",
    s.badgeGenre ? "bgen" : "-",
    s.badgeYear ? "byear" : "-",
    s.badgeRating ? "brate" : "-",
    s.badgeStyle,
    s.rankingBadges ? "r" : "-",
    s.rankingBadgeStyle,
    s.qualityBadges ? "q" : "-",
    s.manualQuality || "auto",
    s.networkLogo ? "net" : "-",
    s.logoScale,
    s.logoOffsetX,
    s.logoOffsetY,
    s.ribbonSide,
    s.blurEnabled ? "blur" : "-",
    s.blurIntensity,
    s.blurFade,
    s.blurDarkness,
    s.gradientHeight,
  ].join("|");
}

export interface SpatialPosterOverrides {
  /** En filas top el número grande ya indica el puesto: oculta badges de ranking. */
  rankingBadges?: boolean;
}

/** Extrae el ID TMDB de un id Stremio/TMDB (`tmdb:123`, `tt123`, numérico). */
export function extractTmdbId(id?: string | null): number | null {
  if (!id) return null;
  const match = id.match(/tmdb[:\-](\d+)/i) ?? id.match(/^(\d+)$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Tipo de recurso para la ruta de SpatialPosters. */
export function spatialPosterType(mediaType: string | undefined): "movie" | "tv" {
  const t = (mediaType ?? "").toLowerCase();
  return t === "movie" || t === "movies" || t === "film" ? "movie" : "tv";
}

export function isSpatialPosterUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /\/api\/poster\/(movie|tv)\/\d+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Construye la URL del póster SpatialPosters. Replica los nombres de parámetro de
 * `stremio-poster-params.ts` del upstream.
 *
 * `lang` se emite SIEMPRE: el upstream cae en `it` si falta, y el default de
 * Aetherio es español.
 */
export function buildSpatialPosterUrl(
  tmdbId: number,
  mediaType: string | undefined,
  settings?: SpatialPosterSettings,
  overrides?: SpatialPosterOverrides,
): string | undefined {
  const s = settings ?? getSpatialPosterSettings();
  const base = getEffectiveInstanceUrl(s);
  if (!isSpatialPostersConfigured(s) || !tmdbId) return undefined;
  // Ultimo filtro y unico que cubre todos los llamadores (hook, filas de Home,
  // Catalog, Detail y el picker manual): si ya sabemos que la instancia esta
  // caida, no se emite ninguna URL. Devolver undefined hace que cada consumidor
  // se quede con su póster original de TMDB, sin tocar sus 5 call sites.
  if (base && getKnownSpatialAvailability(base) === false) return undefined;

  const type = spatialPosterType(mediaType);
  const params = new URLSearchParams();

  // Región/idioma: siempre explícitos para no heredar los defaults del servidor (IT).
  if (s.region) params.set("region", s.region);
  params.set("lang", s.lang);

  const rankingBadges = overrides?.rankingBadges ?? s.rankingBadges;
  if (!s.globalBadges) params.set("badges", "0");
  if (!rankingBadges) params.set("ranking", "0");
  if (!s.badgeGenre) params.set("bg", "0");
  if (!s.badgeYear) params.set("by", "0");
  if (!s.badgeRating) params.set("br", "0");
  if (s.qualityBadges && s.manualQuality) params.set("mq", s.manualQuality);
  if (!s.networkLogo) params.set("netLogo", "0");
  // El upstream trata 0 como "auto" (`Number(q) || null`), así que solo se
  // emiten cuando difieren del valor por defecto.
  if (s.logoScale !== 100) params.set("scale", String(s.logoScale));
  if (s.logoOffsetX !== 0) params.set("ox", String(s.logoOffsetX));
  if (s.logoOffsetY !== 0) params.set("oy", String(s.logoOffsetY));
  if (s.ribbonSide) params.set("side", s.ribbonSide);
  if (!s.blurEnabled) params.set("be", "0");
  params.set("bs", s.badgeStyle);
  params.set("rs", s.rankingBadgeStyle);
  params.set("gradHeight", String(s.gradientHeight));
  params.set("blur", String(s.blurIntensity));
  params.set("bf", String(s.blurFade));
  params.set("bd", String(s.blurDarkness));

  return `${base}/api/poster/${type}/${tmdbId}?${params.toString()}`;
}

/**
 * Devuelve la URL de SpatialPosters si está configurado y hay ID TMDB; si no,
 * la original. Nunca lanza: ante cualquier duda devuelve `originalUrl`.
 */
export function applySpatialPosterToUrl(
  originalUrl: string | undefined,
  tmdbId: number | null | undefined,
  mediaType: string | undefined,
  settings?: SpatialPosterSettings,
  overrides?: SpatialPosterOverrides,
): string | undefined {
  try {
    const s = settings ?? getSpatialPosterSettings();
    if (!isSpatialPostersConfigured(s) || !tmdbId) return originalUrl;
    // No re-encapsular una URL que ya viene de SpatialPosters.
    if (isSpatialPosterUrl(originalUrl) && overrides?.rankingBadges === undefined) return originalUrl;
    return buildSpatialPosterUrl(tmdbId, mediaType, s, overrides) ?? originalUrl;
  } catch {
    return originalUrl;
  }
}
