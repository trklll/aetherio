import { tmdbFetch } from "../config/apiKeys";
import { readPageDataCache, writePageDataCache } from "../utils/pageDataCache";

export interface TmdbCommentReview {
  id: string;
  authorDisplayName: string;
  authorUsername: string | undefined;
  comment: string;
  rating: number | undefined;
  likes: number;
  review: boolean;
  spoiler: boolean;
  hasSpoilerContent: boolean;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  url: string | undefined;
}

export interface TmdbCommentsInput {
  type: string;
  id: string;
  tmdbId?: number;
  imdbId?: string;
}

interface TmdbReviewAuthor {
  name?: string;
  username?: string;
  avatar_path?: string | null;
  rating?: number | null;
}

interface TmdbReviewDto {
  id?: string;
  author?: string;
  author_details?: TmdbReviewAuthor;
  content?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
}

interface TmdbReviewsResponse {
  results?: TmdbReviewDto[];
  total_pages?: number;
  total_results?: number;
}

const COMMENTS_CACHE_TTL_MS = 1000 * 60 * 30;

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function mapTmdbReview(item: TmdbReviewDto): TmdbCommentReview {
  const author = item.author_details;
  const authorDisplayName = (author?.name?.trim() || item.author?.trim() || "Usuario de TMDB").slice(0, 80);
  const authorUsername = author?.username?.trim() || undefined;
  const comment = (item.content ?? "").replace(/\s+/g, " ").trim();
  const rating = typeof author?.rating === "number" && Number.isFinite(author.rating) ? author.rating : undefined;
  const url = item.url?.trim() || undefined;
  return {
    id: item.id || `tmdb-${Math.abs(hashString(`${authorDisplayName}:${comment.slice(0, 64)}:${item.created_at ?? ""}`))}`,
    authorDisplayName,
    authorUsername,
    comment,
    rating,
    likes: 0,
    review: true,
    spoiler: false,
    hasSpoilerContent: false,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    url,
  };
}

async function resolveTmdbId(input: TmdbCommentsInput): Promise<{ kind: "movie" | "tv"; tmdbId: number } | null> {
  const kind: "movie" | "tv" = input.type === "movie" ? "movie" : "tv";
  if (input.tmdbId && Number.isFinite(input.tmdbId)) {
    return { kind, tmdbId: input.tmdbId };
  }
  if (input.id.startsWith("tmdb:")) {
    const parsed = Number(input.id.slice(5));
    if (Number.isFinite(parsed) && parsed > 0) return { kind, tmdbId: parsed };
  }
  const imdbId = input.imdbId?.trim();
  if (!imdbId) return null;
  const data = await tmdbFetch<{ movie_results?: Array<{ id?: number }>; tv_results?: Array<{ id?: number }> }>(
    `/find/${encodeURIComponent(imdbId)}`,
    { params: { external_source: "imdb_id" } },
  );
  if (!data) return null;
  const results = kind === "movie" ? data.movie_results : data.tv_results;
  const matched = results?.[0]?.id;
  return typeof matched === "number" && matched > 0 ? { kind, tmdbId: matched } : null;
}

export async function fetchTmdbCommentsForMedia(input: TmdbCommentsInput): Promise<TmdbCommentReview[]> {
  const target = await resolveTmdbId(input);
  if (!target) return [];

  const cacheKey = `tmdb-comments:${target.kind}:${target.tmdbId}`;
  const cached = readPageDataCache<TmdbCommentReview[]>("detail-comments", cacheKey, COMMENTS_CACHE_TTL_MS);
  if (cached) return cached;

  const data = await tmdbFetch<TmdbReviewsResponse>(`/${target.kind}/${target.tmdbId}/reviews`, {
    params: { language: "es-ES", page: "1" },
  });
  if (!data) return [];

  const items = (data.results ?? [])
    .filter(item => typeof item.content === "string" && item.content.trim().length > 0)
    .map(mapTmdbReview);

  writePageDataCache("detail-comments", cacheKey, items);
  return items;
}
