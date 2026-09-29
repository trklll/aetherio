import { getSpatialPosterSettings, isSpatialPostersConfigured, normalizeInstanceUrl, type SpatialRegion } from "../config/spatialPosters.ts";

/**
 * Mapa de ranking de JustWatch (Top 20) leído de los catálogos de SpatialPosters.
 *
 * Sustituye al antiguo `btttr.cc/catalog/.../tmdb-today.json`. La equivalencia
 * se mantiene: ambos catálogos son el Top 20 de JustWatch, así que las filas
 * `RANK_SORTED_RAIL_IDS` mantienen el mismo orden.
 *
 * Detalles del formato verificados contra el upstream:
 * - Ruta: `{base}/catalog/{movie|series}/pictorium-jw-{movies|series}.json`
 *   (no es el `/catalogs/...` estándar de Stremio).
 * - `metas[].id` viene como `tmdb:<id>` → se puede indexar por TMDB, sin IMDb.
 * - `metas[]` NO trae campo de rank, pero el array ya viene en orden de
 *   ranking: el puesto es el índice + 1.
 * - El catálogo devuelve `metas: []` si la instancia no tiene `TMDB_API_KEY`.
 */
const SPATIAL_RANK_TTL_MS = 1000 * 60 * 60;
const SPATIAL_RANK_TIMEOUT_MS = 8000;

const spatialRankCache = new Map<string, { at: number; map: Map<string, number> }>();

function rankCacheKey(kind: "movie" | "series", instanceUrl: string, region: SpatialRegion): string {
  return `${kind}:${instanceUrl}:${region}`;
}

function catalogIdFor(kind: "movie" | "series"): string {
  return kind === "movie" ? "pictorium-jw-movies" : "pictorium-jw-series";
}

/** Extrae el ID TMDB de un meta de SpatialPosters (`tmdb:123`). */
function tmdbIdFromMetaId(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/^tmdb:(\d+)$/i) ?? raw.match(/(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchSpatialRankMap(kind: "movie" | "series"): Promise<Map<string, number>> {
  const settings = getSpatialPosterSettings();
  const empty = new Map<string, number>();
  if (!isSpatialPostersConfigured(settings)) return empty;
  const base = normalizeInstanceUrl(settings.instanceUrl);
  const cacheKey = rankCacheKey(kind, base, settings.region);
  const now = Date.now();
  const hit = spatialRankCache.get(cacheKey);
  if (hit && now - hit.at < SPATIAL_RANK_TTL_MS) return hit.map;

  const url = `${base}/catalog/${kind}/${catalogIdFor(kind)}.json?region=${encodeURIComponent(settings.region)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPATIAL_RANK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return empty;
    const data = await response.json() as { metas?: unknown[] };
    const metas = Array.isArray(data?.metas) ? data.metas : [];
    const map = new Map<string, number>();
    metas.forEach((meta, index) => {
      const id = tmdbIdFromMetaId((meta as { id?: unknown })?.id);
      // El array viene ordenado por ranking: el índice ES el puesto.
      if (id && !map.has(String(id))) map.set(String(id), index + 1);
    });
    if (map.size) spatialRankCache.set(cacheKey, { at: now, map });
    return map;
  } catch {
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/** Puesto de un item en el Top 20, o `null` si no está rankeado. */
export function spatialRankOf(tmdbId: number | null, rankMap: Map<string, number>): number | null {
  if (tmdbId == null) return null;
  return rankMap.get(String(tmdbId)) ?? null;
}

/** Descarta el ranking cacheado (p. ej. al cambiar los ajustes). */
export function clearSpatialRankCache(): void {
  spatialRankCache.clear();
}
