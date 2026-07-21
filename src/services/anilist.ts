import type { MediaItem } from "../types/ui";
import { tmdbFetch } from "../config/apiKeys";

const ANILIST_URL = "https://graphql.anilist.co";

interface AniListMedia {
  id: number;
  idMal: number | null;
  title: { romaji: string; english: string | null };
  coverImage: { large: string | null } | null;
  bannerImage: string | null;
  description: string | null;
  averageScore: number | null;
  genres: string[] | null;
  season: string | null;
  seasonYear: number | null;
  startDate: { year: number | null } | null;
}

interface AniListPage {
  data: {
    Page: {
      media: AniListMedia[];
    };
  };
}

function anilistSeason(): { season: string; seasonYear: number } {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  if (month < 3) return { season: "WINTER", seasonYear: year };
  if (month < 6) return { season: "SPRING", seasonYear: year };
  if (month < 9) return { season: "SUMMER", seasonYear: year };
  return { season: "FALL", seasonYear: year };
}

function mediaToItem(media: AniListMedia): MediaItem {
  const name = media.title.english ?? media.title.romaji;
  const poster = media.coverImage?.large ?? undefined;
  const year = media.startDate?.year ?? media.seasonYear ?? undefined;

  return {
    id: `anilist:${media.id}`,
    type: "anime",
    name,
    poster,
    background: poster,
    logo: undefined,
    description: media.description?.replace(/<[^>]*>/g, "") ?? undefined,
    year,
    genres: media.genres?.length ? media.genres : undefined,
    rating: media.averageScore != null ? String(media.averageScore) : undefined,
    _anilistId: media.id,
    _malId: media.idMal ?? undefined,
    _romaji: media.title.romaji,
    _english: media.title.english ?? undefined,
  } as MediaItem & { _anilistId: number; _malId?: number; _romaji: string; _english?: string };
}

async function anilistQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const response = await fetch(ANILIST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english }
  coverImage { large }
  bannerImage
  description
  averageScore
  genres
  season
  seasonYear
  startDate { year }
`;

export async function fetchAnilistAiringAnime(): Promise<MediaItem[]> {
  const { season, seasonYear } = anilistSeason();
  const result = await anilistQuery<AniListPage>(
    `query ($season: Season, $seasonYear: Int) {
      Page(page: 1, perPage: 25) {
        media(status: RELEASING, type: ANIME, season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
    { season, seasonYear },
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistTopAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistMostFavorites(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(type: ANIME, sort: FAVOURITES_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistTopAiring(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(status: RELEASING, type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

export async function fetchAnilistActionAnime(): Promise<MediaItem[]> {
  const result = await anilistQuery<AniListPage>(
    `query {
      Page(page: 1, perPage: 25) {
        media(genre: "Action", type: ANIME, sort: SCORE_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
  );
  return (result?.data?.Page?.media ?? []).map(mediaToItem);
}

interface AnilistEnrichedItem extends MediaItem {
  _anilistId: number;
  _malId?: number;
  _romaji: string;
  _english?: string;
}

interface TmdbSearchResult {
  id: number;
  poster_path?: string;
  backdrop_path?: string;
  name?: string;
  title?: string;
  original_name?: string;
  popularity?: number;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

function titlesMatch(searchTitle: string, tmdbResult: TmdbSearchResult): boolean {
  const norm = normalizeTitle(searchTitle);
  const candidates = [
    tmdbResult.name,
    tmdbResult.title,
    tmdbResult.original_name,
  ].filter(Boolean).map(s => normalizeTitle(s!));
  return candidates.some(c => c === norm || c.includes(norm) || norm.includes(c));
}

async function searchTmdbByTitle(
  title: string,
  searchType: "tv" | "movie",
  year?: number,
): Promise<TmdbSearchResult | null> {
  const params: Record<string, string> = {
    query: title,
    language: "es-ES",
    page: "1",
  };
  if (year) {
    params[searchType === "tv" ? "first_air_date_year" : "year"] = String(year);
  }
  const result = await tmdbFetch<{ results: TmdbSearchResult[] }>(`/search/${searchType}`, { params });
  if (!result?.results?.length) return null;
  const matches = result.results.filter(r => titlesMatch(title, r));
  if (matches.length) {
    return matches.reduce((best, r) => (r.popularity ?? 0) > (best.popularity ?? 0) ? r : best);
  }
  return result.results.reduce((best, r) => (r.popularity ?? 0) > (best.popularity ?? 0) ? r : best);
}

function toTmdbItem(r: TmdbSearchResult) {
  return {
    tmdbId: r.id,
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : undefined,
    background: r.backdrop_path ? `https://image.tmdb.org/t/p/original${r.backdrop_path}` : undefined,
  };
}

async function searchTmdbAnime(
  englishTitle: string | undefined,
  romajiTitle: string,
  year?: number,
): Promise<{ tmdbId: number; poster?: string; background?: string }> {
  const titles = [englishTitle, romajiTitle].filter(Boolean) as string[];

  for (const title of titles) {
    for (const searchType of ["tv", "movie"] as const) {
      try {
        const r = await searchTmdbByTitle(title, searchType, year);
        if (r) return toTmdbItem(r);
      } catch {}
    }
  }

  for (const title of titles) {
    for (const searchType of ["tv", "movie"] as const) {
      try {
        const r = await searchTmdbByTitle(title, searchType);
        if (r) return toTmdbItem(r);
      } catch {}
    }
  }

  for (const title of titles) {
    const shortTitle = title.split(/[:\-–]/)[0].trim();
    if (shortTitle.length < 3 || shortTitle === title) continue;
    for (const searchType of ["tv", "movie"] as const) {
      try {
        const r = await searchTmdbByTitle(shortTitle, searchType);
        if (r) return toTmdbItem(r);
      } catch {}
    }
  }

  const fallback = romajiTitle.split(/[:\-–]/)[0].trim().slice(0, 40);
  if (fallback.length >= 3) {
    for (const searchType of ["tv", "movie"] as const) {
      try {
        const r = await searchTmdbByTitle(fallback, searchType);
        if (r) return toTmdbItem(r);
      } catch {}
    }
  }

  return { tmdbId: 0, poster: undefined, background: undefined };
}

const TMDB_CONCURRENCY = 5;

export async function resolveAnilistToTmdb(items: MediaItem[]): Promise<MediaItem[]> {
  const anilistItems = items.filter(
    (item): item is AnilistEnrichedItem =>
      item.id.startsWith("anilist:") && "_romaji" in item,
  );
  if (!anilistItems.length) return items;

  const resolved = new Map<number, { tmdbId: number; poster?: string; background?: string }>();
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < anilistItems.length) {
      const i = nextIndex++;
      const item = anilistItems[i];
      try {
        const tmdb = await searchTmdbAnime(item._english, item._romaji, item.year);
        if (tmdb && tmdb.tmdbId > 0) resolved.set(item._anilistId, tmdb);
      } catch {}
    }
  }

  await Promise.all(Array.from({ length: Math.min(TMDB_CONCURRENCY, anilistItems.length) }, worker));

  const seenTmdbIds = new Set<number>();

  return items.reduce<MediaItem[]>((acc, item) => {
    if (!item.id.startsWith("anilist:")) {
      acc.push(item);
      return acc;
    }
    const enriched = item as AnilistEnrichedItem;
    const tmdb = resolved.get(enriched._anilistId);
    if (tmdb && tmdb.tmdbId > 0 && !seenTmdbIds.has(tmdb.tmdbId)) {
      seenTmdbIds.add(tmdb.tmdbId);
      acc.push({
        ...item,
        id: `tmdb:${tmdb.tmdbId}`,
        poster: tmdb.poster ?? item.poster,
        background: tmdb.background ?? item.background,
      });
    }
    return acc;
  }, []);
}
