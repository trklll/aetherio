import type { MediaItem } from "../types/ui";

const JIKAN_BASE = "https://api.jikan.moe/v4";

interface JikanImage {
  image_url: string;
  large_image_url: string;
  small_image_url: string;
}

interface JikanEntry {
  mal_id: number;
  url: string;
  images: { jpg: JikanImage; webp: JikanImage };
  title: string;
  title_english?: string;
  title_japanese?: string;
  type?: string;
  source?: string;
  episodes?: number;
  status?: string;
  aired?: { from: string; to: string | null };
  score?: number;
  scored_by?: number;
  rank?: number;
  popularity?: number;
  members?: number;
  favorites?: number;
  synopsis?: string;
  season?: string;
  year?: number;
  genres?: Array<{ mal_id: number; name: string; type: string }>;
  explicit_genres?: Array<{ mal_id: number; name: string; type: string }>;
  themes?: Array<{ mal_id: number; name: string; type: string }>;
  demographics?: Array<{ mal_id: number; name: string; type: string }>;
}

interface JikanResponse {
  pagination: { last_visible_page: number; has_next_page: boolean; current_page: number };
  data: JikanEntry[];
}

function jikanYear(offset = 0): number {
  return new Date().getFullYear() + offset;
}

function jikanSeason(): "winter" | "spring" | "summer" | "fall" {
  const month = new Date().getMonth();
  if (month < 3) return "winter";
  if (month < 6) return "spring";
  if (month < 9) return "summer";
  return "fall";
}

function entryToMediaItem(entry: JikanEntry): MediaItem {
  const name = entry.title_english ?? entry.title;
  const poster = entry.images?.jpg?.large_image_url ?? entry.images?.jpg?.image_url;
  const year = entry.aired?.from ? new Date(entry.aired.from).getFullYear() : entry.year;
  const genres = [
    ...(entry.genres ?? []),
    ...(entry.explicit_genres ?? []),
    ...(entry.themes ?? []),
    ...(entry.demographics ?? []),
  ].map(g => g.name);

  return {
    id: `mal:${entry.mal_id}`,
    type: "anime",
    name,
    poster: poster ?? undefined,
    background: poster ?? undefined,
    logo: undefined,
    description: entry.synopsis ?? undefined,
    year: year ?? undefined,
    genres: genres.length ? genres : undefined,
    rating: entry.score != null ? String(entry.score) : undefined,
  };
}

async function jikanFetch(path: string, params: Record<string, string> = {}): Promise<JikanEntry[]> {
  const url = new URL(`${JIKAN_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) return [];

  const json: JikanResponse = await response.json();
  return json.data ?? [];
}

export async function fetchJikanAiringAnime(): Promise<MediaItem[]> {
  const entries = await jikanFetch(`/seasons/${jikanYear()}/${jikanSeason()}`, {
    filter: "airing",
    order_by: "score",
    sort: "desc",
    limit: "25",
  });
  return entries.map(entryToMediaItem);
}

export async function fetchJikanTopAnime(): Promise<MediaItem[]> {
  const entries = await jikanFetch("/top/anime", {
    type: "tv",
    filter: "bypopularity",
    limit: "25",
  });
  return entries.map(entryToMediaItem);
}

export async function fetchJikanMostFavorites(): Promise<MediaItem[]> {
  const entries = await jikanFetch("/top/anime", {
    type: "tv",
    filter: "favorite",
    limit: "25",
  });
  return entries.map(entryToMediaItem);
}

export async function fetchJikanTopAiring(): Promise<MediaItem[]> {
  const entries = await jikanFetch("/top/anime", {
    type: "tv",
    filter: "airing",
    limit: "25",
  });
  return entries.map(entryToMediaItem);
}

export async function fetchJikanActionAnime(): Promise<MediaItem[]> {
  const entries = await jikanFetch("/anime", {
    genres: "1",
    order_by: "score",
    sort: "desc",
    type: "tv",
    limit: "25",
  });
  return entries.map(entryToMediaItem);
}
