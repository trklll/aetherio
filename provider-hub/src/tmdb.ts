import type { Env } from "./types.ts";

const TMDB_ENDPOINT = "https://api.themoviedb.org/3";
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60_000;

const titleCache = new Map<string, { title: string | null; loadedAt: number }>();

/** Resuelve el título a partir de un IMDb id (TMDB si hay credenciales; si no, Cinemeta público). */
export async function resolveTmdbTitle(env: Env, mediaType: "movie" | "series", imdbId: string): Promise<string | null> {
  const hasBearer = Boolean(env.TMDB_BEARER);
  const hasKey = Boolean(env.TMDB_KEY);
  if (hasBearer || hasKey) {
    const tmdbTitle = await resolveTitleFromTmdb(env, mediaType, imdbId, hasBearer, hasKey);
    if (tmdbTitle) return tmdbTitle;
  }
  return resolveTitleFromCinemeta(mediaType, imdbId);
}

/** Resolvedor con credenciales TMDB (external_source=imdb_id). */
async function resolveTitleFromTmdb(
  env: Env,
  mediaType: "movie" | "series",
  imdbId: string,
  hasBearer: boolean,
  hasKey: boolean,
): Promise<string | null> {
  const cacheKey = `tmdb:${mediaType}:${imdbId}`;
  const cached = titleCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) return cached.title;

  const url = new URL(`${TMDB_ENDPOINT}/find/${encodeURIComponent(imdbId)}`);
  url.searchParams.set("external_source", "imdb_id");
  url.searchParams.set("language", "en-US");
  if (hasKey) url.searchParams.set("api_key", env.TMDB_KEY!);

  const init: RequestInit = { signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (hasBearer) init.headers = { Authorization: `Bearer ${env.TMDB_BEARER}` };

  let title: string | null = null;
  try {
    const response = await fetch(url.toString(), init);
    if (response.ok) {
      const payload = await response.json() as {
        movie_results?: Array<{ title?: string; name?: string }>;
        tv_results?: Array<{ title?: string; name?: string }>;
      };
      const pool = mediaType === "movie" ? payload.movie_results ?? [] : payload.tv_results ?? [];
      const best = pool[0];
      title = best ? (best.title || best.name || "").trim() || null : null;
    }
  } catch (error) {
    console.warn("[HUB:TMDB] find falló", imdbId, error);
  }

  titleCache.set(cacheKey, { title, loadedAt: now });
  return title;
}

/** Resolvedor sin clave: meta catálogo público de Stremio (Cinemeta). */
async function resolveTitleFromCinemeta(mediaType: "movie" | "series", imdbId: string): Promise<string | null> {
  const type = mediaType === "movie" ? "movie" : "series";
  const now = Date.now();
  try {
    const response = await fetch(`https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { meta?: { name?: string; title?: string } };
    const name = (payload.meta?.name || payload.meta?.title || "").trim() || null;
    titleCache.set(`${mediaType}:${imdbId}`, { title: name, loadedAt: now });
    return name;
  } catch (error) {
    console.warn("[HUB:CINEMETA] meta falló", imdbId, error);
    titleCache.set(`${mediaType}:${imdbId}`, { title: null, loadedAt: now });
    return null;
  }
}
