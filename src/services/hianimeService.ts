const CONSUMET_API = "https://api.consumet.org";
const HI_ANIME_BASE = `${CONSUMET_API}/anime/hianime`;

export interface HiAnimeSearchResult {
  id: string;
  title: string;
  url: string;
  image: string;
  releaseDate: string;
  subOrDub: "sub" | "dub" | "both";
}

export interface HiAnimeSearchResponse {
  currentPage: number;
  hasNextPage: boolean;
  results: HiAnimeSearchResult[];
}

export interface HiAnimeAnimeInfo {
  id: string;
  title: string;
  url: string;
  image: string;
  description: string;
  type: string;
  episodes: number;
  status: string;
  genres: string[];
  subOrDub: "sub" | "dub" | "both";
  releaseDate: string;
}

export interface HiAnimeVideoSource {
  url: string;
  quality: string;
  isM3U8: boolean;
  subtitle?: string;
}

export interface HiAnimeEpisode {
  id: string;
  number: number;
  title?: string;
  sources: HiAnimeVideoSource[];
  subtitles: { url: string; lang: string }[];
}

async function fetchHiAnime<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const url = new URL(`${HI_ANIME_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function searchHiAnime(query: string, page = 1): Promise<HiAnimeSearchResponse | null> {
  return fetchHiAnime<HiAnimeSearchResponse>(`/${encodeURIComponent(query)}`, { page: String(page) });
}

export async function getHiAnimeInfo(animeId: string): Promise<HiAnimeAnimeInfo | null> {
  return fetchHiAnime<HiAnimeAnimeInfo>(`/info/${animeId}`);
}

export async function getHiAnimeEpisode(episodeId: string): Promise<HiAnimeEpisode | null> {
  return fetchHiAnime<HiAnimeEpisode>(`/watch/${episodeId}`);
}

export async function getHiAnimeTopAiring(): Promise<HiAnimeSearchResponse | null> {
  return fetchHiAnime<HiAnimeSearchResponse>("/top-airing");
}

export async function getHiAnimeMostPopular(): Promise<HiAnimeSearchResponse | null> {
  return fetchHiAnime<HiAnimeSearchResponse>("/most-popular");
}

export async function getHiAnimeRecentlyUpdated(): Promise<HiAnimeSearchResponse | null> {
  return fetchHiAnime<HiAnimeSearchResponse>("/recently-updated");
}
