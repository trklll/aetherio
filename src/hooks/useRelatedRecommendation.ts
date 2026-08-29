import { useEffect, useState } from "react";
import { tmdbFetch } from "../config/apiKeys";
import type { StreamQuery } from "../types/stream";
import { readPlaybackStateEntries } from "../utils/continueWatching";

export interface RelatedRecommendation {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  logoUrl?: string | null;
  backdropUrl?: string | null;
  posterUrl?: string | null;
  overview?: string | null;
  year?: string | null;
  rating?: number | null;
  voteCount?: number | null;
  runtime?: number | null;
  genres?: string[] | null;
  mediaTypeLabel?: string | null;
}

async function resolveTmdbId(query: StreamQuery): Promise<{ id: string; type: "movie" | "tv" } | null> {
  if (!query?.id) return null;
  const type = query.type === "movie" ? "movie" : "tv";
  if (query.id.startsWith("tmdb:")) return { id: query.id.slice(5), type };
  if (!query.id.startsWith("tt")) return null;
  const mediaType = type === "movie" ? "movie_results" : "tv_results";
  const json = await tmdbFetch<any>(`/find/${query.id}`, { params: { external_source: "imdb_id" } });
  const id = json?.[mediaType]?.[0]?.id;
  return id ? { id: String(id), type } : null;
}

async function fetchArtwork(type: "movie" | "tv", tmdbId: number) {
  const images = await tmdbFetch<any>(`/${type}/${tmdbId}/images`, {
    params: { include_image_language: "es,en,null" },
  }).catch(() => null);
  const logos = images?.logos ?? [];
  const backdrops = images?.backdrops ?? [];
  const logo = logos[0]?.file_path ?? null;
  const backdrop = backdrops[0]?.file_path ?? null;
  return {
    logoUrl: logo ? `https://image.tmdb.org/t/p/original${logo}` : null,
    backdropUrl: backdrop ? `https://image.tmdb.org/t/p/original${backdrop}` : null,
  };
}

function normalizeTitle(value: string | undefined | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\b(the|a|an|el|la|los|las|un|una|unos|unas)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWatched(mediaType: "movie" | "series", tmdbId: number): boolean {
  const entries = readPlaybackStateEntries();
  const tvKeys = new Set([
    `${mediaType}:tmdb:${tmdbId}`,
    `${mediaType === "series" ? "tv" : mediaType}:tmdb:${tmdbId}`,
    `${mediaType}:${tmdbId}`,
  ]);
  // also check series/tv cross
  if (mediaType === "series") {
    tvKeys.add(`tv:tmdb:${tmdbId}`);
    tvKeys.add(`series:tmdb:${tmdbId}`);
  }
  for (const entry of entries) {
    if (!entry.completed) continue;
    if (entry.id === `tmdb:${tmdbId}` && (entry.type === mediaType || (mediaType === "series" && entry.type === "tv") || (mediaType === "tv" as any && entry.type === "series"))) return true;
    if (tvKeys.has(entry.mediaKey)) return true;
    // fallback: mediaKey ends with :tmdb:ID
    if (entry.mediaKey.endsWith(`:tmdb:${tmdbId}`) && (entry.mediaKey.startsWith(`${mediaType}:`) || entry.mediaKey.startsWith("tv:") || entry.mediaKey.startsWith("series:"))) {
      // ensure type matches, but allow cross series/tv
      if (mediaType === "series" && (entry.mediaKey.startsWith("series:") || entry.mediaKey.startsWith("tv:"))) return true;
      if (mediaType === "movie" && entry.mediaKey.startsWith("movie:")) return true;
    }
  }
  return false;
}

/**
 * Replica la lógica de "Más como esto" de Detail (buildRelatedItems):
 * - Junta recommendations + similar
 * - Filtra por poster_path y título distinto
 * - Score por overlap de géneros + vote_average + popularity
 * - Ordena y toma el primer NO visto; si ya está visto, el siguiente, y así.
 */
export function useRelatedRecommendation(query: StreamQuery | null) {
  const [recommendation, setRecommendation] = useState<RelatedRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheKey = query ? `${query.type}:${query.id}` : "";

  useEffect(() => {
    if (!query) {
      setRecommendation(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRecommendation(null);

    (async () => {
      const resolved = await resolveTmdbId(query).catch(() => null);
      if (!resolved || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { id, type } = resolved;
      // Fetch main con recommendations + similar + genres (igual que Detail)
      const main = await tmdbFetch<any>(`/${type}/${id}`, {
        params: { language: "es-ES", append_to_response: "recommendations,similar" },
      }).catch(() => null);
      if (!main || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const source = [
        ...(Array.isArray(main?.recommendations?.results) ? main.recommendations.results : []),
        ...(Array.isArray(main?.similar?.results) ? main.similar.results : []),
      ];
      if (!source.length) {
        if (!cancelled) setLoading(false);
        return;
      }
      const ownGenres = new Set((main?.genres ?? []).map((g: any) => Number(g?.id)).filter(Boolean));
      const ownTitle = normalizeTitle(main?.title ?? main?.name);
      const fallbackType = type;
      const seen = new Set<string>();
      const scored = source
        .filter((item: any) => item?.id && item?.poster_path)
        .map((item: any) => {
          const mediaType = item.media_type === "movie" || item.media_type === "tv" ? item.media_type : fallbackType;
          const title = item.title ?? item.name ?? "";
          const genreOverlap = Array.isArray(item.genre_ids)
            ? item.genre_ids.filter((gid: number) => ownGenres.has(Number(gid))).length
            : 0;
          const score =
            genreOverlap * 20 +
            Number(item.vote_average ?? 0) +
            Math.log10(Math.max(1, Number(item.vote_count ?? 0)) + 1) +
            Math.log10(Math.max(1, Number(item.popularity ?? 0)) + 1);
          return { item, mediaType, title, score };
        })
        .filter(({ item, mediaType, title }: any) => {
          const key = `${mediaType}:${item.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return normalizeTitle(title) !== ownTitle;
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 18);

      // Mapear a shape de Detail y filtrar por vistos (primer no visto)
      let chosen: any = null;
      for (const entry of scored) {
        const mappedType: "movie" | "series" = entry.mediaType === "tv" ? "series" : entry.mediaType === "movie" ? "movie" : (type === "tv" ? "series" : "movie");
        const checkType: "movie" | "series" = mappedType as any;
        if (!isWatched(checkType, entry.item.id)) {
          chosen = entry;
          break;
        }
      }
      // si todos están vistos, usar el primero (fallback)
      if (!chosen && scored.length) chosen = scored[0];
      if (!chosen || cancelled) {
        if (!cancelled) setLoading(false);
        return;
      }
      const recType: "movie" | "tv" = chosen.mediaType === "movie" ? "movie" : "tv";
      const [artwork, details] = await Promise.all([
        fetchArtwork(recType, chosen.item.id).catch(() => ({ logoUrl: null, backdropUrl: null })),
        tmdbFetch<any>(`/${recType}/${chosen.item.id}`, { params: { language: "es-ES" } }).catch(() => null),
      ]);
      if (cancelled) return;
      const yearRaw = details?.release_date ?? details?.first_air_date ?? chosen.item.release_date ?? chosen.item.first_air_date ?? null;
      const year = yearRaw ? String(yearRaw).slice(0, 4) : null;
      const rating = typeof details?.vote_average === "number" ? Number(details.vote_average) : typeof chosen.item.vote_average === "number" ? Number(chosen.item.vote_average) : null;
      const voteCount = typeof details?.vote_count === "number" ? Number(details.vote_count) : typeof chosen.item.vote_count === "number" ? Number(chosen.item.vote_count) : null;
      const runtime = typeof details?.runtime === "number" ? Number(details.runtime) : Array.isArray(details?.episode_run_time) && details.episode_run_time[0] ? Number(details.episode_run_time[0]) : null;
      const genres = Array.isArray(details?.genres) ? details.genres.map((g: any) => g?.name).filter(Boolean).slice(0, 3) : null;
      const mediaTypeLabel = recType === "movie" ? "Película" : "Serie";
      setRecommendation({
        tmdbId: chosen.item.id,
        type: recType,
        title: chosen.title || chosen.item.title || chosen.item.name || "Sin titulo",
        logoUrl: artwork.logoUrl,
        backdropUrl: artwork.backdropUrl,
        posterUrl: chosen.item.poster_path ? `https://image.tmdb.org/t/p/w500${chosen.item.poster_path}` : null,
        overview: chosen.item.overview ?? details?.overview ?? null,
        year,
        rating: rating !== null && Number.isFinite(rating) ? Math.round(rating * 10) / 10 : null,
        voteCount,
        runtime,
        genres,
        mediaTypeLabel,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, query]);

  return { recommendation, loading };
}
