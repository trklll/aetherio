import { tmdbFetch } from "../config/apiKeys.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";
import {
  CONTINUE_WATCHING_EVENT,
  readPlaybackStateEntries,
} from "../utils/continueWatching.ts";

/**
 * Visibilidad de vistos en las rows del home.
 *
 * Regla: un medio completado no aparece en ninguna row, salvo que tenga
 * episodios nuevos por ver:
 * - Película completada (reproducida o marcada) → se oculta (no hay
 *   episodios nuevos posibles).
 * - Serie/anime con marca manual ("Marcar como visto", S0E0) → se oculta,
 *   salvo que TMDB conozca episodios emitidos DESPUÉS de la marca.
 * - Serie/anime por reproducción → se oculta solo si el episodio completado
 *   más alto alcanza al último emitido conocido (está al día). Si va
 *   atrasada o no se puede comprobar (sin id TMDB o sin dato), SE MUESTRA:
 *   ante la duda nunca se oculta.
 */

export interface CompletedRef {
  season?: number;
  episode?: number;
  updatedAt: number;
}

export interface LastAiredInfo {
  /** Ausentes cuando TMDB no devolvió dato útil: no cubren nada (mostrar). */
  season?: number;
  episode?: number;
  airDate?: string;
  checkedAt: number;
}

const VISIBILITY_CACHE_KEY = "aetherio-watched-visibility-v1";
export const LAST_AIRED_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_CONCURRENCY = 4;

function visibilityStorageKey() {
  try {
    return getScopedStorageKey(VISIBILITY_CACHE_KEY);
  } catch {
    return VISIBILITY_CACHE_KEY;
  }
}

function readVisibilityCache(): Record<string, LastAiredInfo> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(visibilityStorageKey());
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LastAiredInfo>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeVisibilityCache(cache: Record<string, LastAiredInfo>) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(visibilityStorageKey(), JSON.stringify(cache));
  } catch { /* best-effort */ }
}

/** Lectura síncrona del último episodio emitido cacheado (null = sin dato). */
export function readCachedLastAired(tmdbId: number): LastAiredInfo | null {
  return readVisibilityCache()[`tmdb:${tmdbId}`] ?? null;
}

function parseTmdbId(id?: string | null): number | null {
  if (!id) return null;
  const match = id.match(/^tmdb:(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function isManualMark(entry: CompletedRef): boolean {
  return (entry.season ?? -1) === 0 && (entry.episode ?? -1) === 0;
}

function maxCompleted(completed: CompletedRef[]): { season: number; episode: number } | null {
  let best: { season: number; episode: number } | null = null;
  for (const entry of completed) {
    if (isManualMark(entry)) continue;
    const season = typeof entry.season === "number" ? entry.season : 0;
    const episode = typeof entry.episode === "number" ? entry.episode : 0;
    if (!best || season > best.season || (season === best.season && episode > best.episode)) {
      best = { season, episode };
    }
  }
  return best;
}

function covers(max: { season: number; episode: number } | null, last: LastAiredInfo): boolean {
  if (!max) return false;
  if (!Number.isFinite(last.season) || !Number.isFinite(last.episode)) return false;
  const lastSeason = last.season as number;
  const lastEpisode = last.episode as number;
  if (max.season !== lastSeason) return max.season > lastSeason;
  return max.episode >= lastEpisode;
}

function airedAfter(airDate: string | undefined, timestamp: number): boolean {
  if (!airDate) return false;
  const time = Date.parse(`${airDate}T00:00:00Z`);
  return Number.isFinite(time) && time > timestamp;
}

export function shouldHideMedia(input: {
  type: string;
  completed: CompletedRef[];
  lastAired?: LastAiredInfo | null;
}): boolean {
  const { type, completed, lastAired } = input;
  if (!completed.length) return false;
  if (type.toLowerCase() === "movie") return true;
  const manual = completed.find(isManualMark);
  const max = maxCompleted(completed);
  if (!lastAired) {
    // Sin dato de emisión solo oculta la marca explícita del usuario.
    return manual != null;
  }
  // Episodios nuevos desde la marca manual (o yendo atrasado) → mostrar.
  if (manual && airedAfter(lastAired.airDate, manual.updatedAt) && !covers(max, lastAired)) return false;
  if (!manual && !covers(max, lastAired)) return false;
  return true;
}

/**
 * Conjunto síncrono de mediaKeys a ocultar en las rows. Nunca lanza y ante
 * cualquier duda devuelve menos (mostrar de más, jamás ocultar de más).
 */
export function readHiddenMediaKeys(): Set<string> {
  const hidden = new Set<string>();
  try {
    const cache = readVisibilityCache();
    const byMedia = new Map<string, { type: string; id: string; completed: CompletedRef[] }>();
    for (const entry of readPlaybackStateEntries()) {
      if (!entry.completed) continue;
      let group = byMedia.get(entry.mediaKey);
      if (!group) {
        group = { type: entry.type, id: entry.id, completed: [] };
        byMedia.set(entry.mediaKey, group);
      }
      group.completed.push({ season: entry.season, episode: entry.episode, updatedAt: entry.updatedAt });
    }
    for (const [mediaKey, group] of byMedia) {
      const tmdbId = parseTmdbId(group.id);
      const lastAired = tmdbId != null ? cache[`tmdb:${tmdbId}`] ?? null : null;
      if (shouldHideMedia({ type: group.type, completed: group.completed, lastAired })) {
        hidden.add(mediaKey);
      }
    }
  } catch { /* ante la duda, mostrar todo */ }
  return hidden;
}

interface TmdbTvDetails {
  last_episode_to_air?: {
    season_number?: number;
    episode_number?: number;
    air_date?: string | null;
  } | null;
}

/**
 * Actualiza en background el último episodio emitido de las series
 * completadas (solo ids TMDB con caché ausente o caducada). Avisa con
 * CONTINUE_WATCHING_EVENT si algo cambió para que las rows recalculen.
 */
export async function refreshWatchedSeriesCache(): Promise<void> {
  try {
    const now = Date.now();
    const cache = readVisibilityCache();
    const targets = new Map<number, true>();
    for (const entry of readPlaybackStateEntries()) {
      if (!entry.completed) continue;
      if (entry.type.toLowerCase() === "movie") continue;
      const tmdbId = parseTmdbId(entry.id);
      if (tmdbId == null) continue;
      const hit = cache[`tmdb:${tmdbId}`];
      if (hit && now - hit.checkedAt < LAST_AIRED_TTL_MS) continue;
      targets.set(tmdbId, true);
    }
    if (!targets.size) return;

    let changed = false;
    const queue = [...targets.keys()];
    async function worker() {
      while (queue.length) {
        const tmdbId = queue.shift();
        if (tmdbId == null) continue;
        try {
          const details = await tmdbFetch<TmdbTvDetails>(`/tv/${tmdbId}`, {
            params: { language: "es-ES" },
          });
          const last = details?.last_episode_to_air;
          const season = Number(last?.season_number);
          const episode = Number(last?.episode_number);
          const key = `tmdb:${tmdbId}`;
          if (Number.isFinite(season) && Number.isFinite(episode) && season > 0 && episode > 0) {
            const next: LastAiredInfo = {
              season,
              episode,
              checkedAt: Date.now(),
            };
            if (typeof last?.air_date === "string") next.airDate = last.air_date;
            cache[key] = next;
          } else {
            // Sin dato útil: solo se marca revisado para no reintentar en
            // bucle. Sin season/episode no cubre nada → se sigue mostrando.
            cache[key] = { checkedAt: Date.now() };
          }
          changed = true;
        } catch {
          // Se reintenta en el próximo ciclo.
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(REFRESH_CONCURRENCY, queue.length) }, () => worker()),
    );
    if (changed) {
      writeVisibilityCache(cache);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CONTINUE_WATCHING_EVENT));
      }
    }
  } catch { /* nunca rompe el arranque */ }
}
