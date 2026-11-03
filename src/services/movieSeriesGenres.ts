import { tmdbFetch } from "../config/apiKeys";
import type { MediaItem } from "../types/ui";
import { tmdbGenreName } from "./tmdbGenres";

export interface MovieSeriesGenre {
  key: string;
  label: string;
  movieGenreIds: string;
  tvGenreIds: string;
}

// Solo géneros con una traducción temática razonable en cine y televisión.
// TMDB no tiene un género TV independiente de "thriller"; Suspenso se agrupa
// con Misterio para que el carrusel mantenga resultados coherentes en ambos.
export const MOVIE_SERIES_GENRES: readonly MovieSeriesGenre[] = [
  { key: "action-adventure", label: "Acción y aventura", movieGenreIds: "28|12", tvGenreIds: "10759" },
  { key: "comedy", label: "Comedia", movieGenreIds: "35", tvGenreIds: "35" },
  { key: "crime", label: "Crimen", movieGenreIds: "80", tvGenreIds: "80" },
  { key: "documentary", label: "Documental", movieGenreIds: "99", tvGenreIds: "99" },
  { key: "drama", label: "Drama", movieGenreIds: "18", tvGenreIds: "18" },
  { key: "family", label: "Familia", movieGenreIds: "10751", tvGenreIds: "10751" },
  { key: "mystery", label: "Misterio y suspenso", movieGenreIds: "9648|53", tvGenreIds: "9648" },
  { key: "science-fiction", label: "Ciencia ficción y fantasía", movieGenreIds: "878|14", tvGenreIds: "10765" },
  { key: "western", label: "Western", movieGenreIds: "37", tvGenreIds: "37" },
];

interface TmdbGenreResult {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
  original_language?: string;
}

interface TmdbGenrePage {
  results?: TmdbGenreResult[];
}

export function getMovieSeriesGenre(key: string) {
  return MOVIE_SERIES_GENRES.find(genre => genre.key === key);
}

export function mapMovieSeriesGenreItem(
  raw: TmdbGenreResult,
  type: "movie" | "series",
  allowJapaneseAnime = false,
): MediaItem | null {
  const id = Number(raw.id);
  const name = String(raw.title ?? raw.name ?? "").trim();
  if (!Number.isFinite(id) || id <= 0 || !name) return null;

  const genreIds = Array.isArray(raw.genre_ids)
    ? raw.genre_ids.map(Number).filter(Number.isFinite)
    : [];
  // El selector es de cine y series generalistas: no volver a introducir
  // anime solo porque también esté etiquetado como Acción, Drama, etc.
  if (!allowJapaneseAnime && genreIds.includes(16) && raw.original_language?.toLowerCase() === "ja") return null;

  const date = raw.release_date ?? raw.first_air_date ?? "";
  const year = Number(date.slice(0, 4)) || undefined;
  return {
    id: `tmdb:${id}`,
    type,
    name,
    poster: raw.poster_path ? `https://image.tmdb.org/t/p/w500${raw.poster_path}` : undefined,
    background: raw.backdrop_path ? `https://image.tmdb.org/t/p/original${raw.backdrop_path}` : undefined,
    description: raw.overview,
    rating: typeof raw.vote_average === "number" && raw.vote_average > 0 ? raw.vote_average.toFixed(1) : undefined,
    year,
    genreIds,
    genres: genreIds
      .map(genreId => tmdbGenreName(type, genreId))
      .filter((genreName): genreName is string => Boolean(genreName)),
  };
}

export function interleaveMovieSeriesGenreItems(movies: MediaItem[], series: MediaItem[]) {
  const mixed: MediaItem[] = [];
  const count = Math.max(movies.length, series.length);
  for (let index = 0; index < count; index += 1) {
    if (movies[index]) mixed.push(movies[index]);
    if (series[index]) mixed.push(series[index]);
  }
  return mixed;
}

export async function fetchMovieSeriesGenrePage(key: string, page = 1): Promise<MediaItem[]> {
  const genre = getMovieSeriesGenre(key);
  if (!genre) return [];

  const params = {
    sort_by: "popularity.desc",
    language: "es-ES",
    page: String(Math.max(1, Math.trunc(page))),
    include_adult: "false",
    "vote_count.gte": "20",
  };
  const [moviePage, tvPage] = await Promise.all([
    tmdbFetch<TmdbGenrePage>("/discover/movie", { params: { ...params, with_genres: genre.movieGenreIds } }).catch(() => null),
    tmdbFetch<TmdbGenrePage>("/discover/tv", { params: { ...params, with_genres: genre.tvGenreIds } }).catch(() => null),
  ]);

  const movies = (moviePage?.results ?? [])
    .map(item => mapMovieSeriesGenreItem(item, "movie"))
    .filter((item): item is MediaItem => Boolean(item));
  const series = (tvPage?.results ?? [])
    .map(item => mapMovieSeriesGenreItem(item, "series"))
    .filter((item): item is MediaItem => Boolean(item));
  return interleaveMovieSeriesGenreItems(movies, series);
}

export async function fetchAllMovieSeriesGenreItems(key: string): Promise<MediaItem[]> {
  if (!getMovieSeriesGenre(key)) return [];
  const pages = await Promise.all(
    [1, 2, 3, 4, 5].map(page => fetchMovieSeriesGenrePage(key, page)),
  );
  const seen = new Set<string>();
  return pages.flat().filter(item => {
    if (seen.has(`${item.type}:${item.id}`)) return false;
    seen.add(`${item.type}:${item.id}`);
    return true;
  });
}
