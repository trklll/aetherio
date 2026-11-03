import { tmdbFetch } from "../config/apiKeys";
import type { CatalogRowData, MediaItem } from "../types/ui";
import { mapMovieSeriesGenreItem } from "./movieSeriesGenres";

interface TmdbHomeRowResult {
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

interface TmdbHomeRowPage {
  results?: TmdbHomeRowResult[];
}

interface HomeRowRequest {
  id: string;
  name: string;
  type: "movie" | "series";
  path: "/discover/movie" | "/discover/tv";
  params: Record<string, string>;
}

const COMMON_PARAMS = {
  language: "es-ES",
  page: "1",
  include_adult: "false",
};

const HOME_ROW_REQUESTS: readonly HomeRowRequest[] = [
  {
    id: "tmdb.home.movie.horror",
    name: "Películas de terror",
    type: "movie",
    path: "/discover/movie",
    params: { sort_by: "popularity.desc", with_genres: "27", "vote_count.gte": "50" },
  },
  {
    id: "tmdb.home.movie.family",
    name: "Películas familiares",
    type: "movie",
    path: "/discover/movie",
    params: { sort_by: "popularity.desc", with_genres: "10751", "vote_count.gte": "50" },
  },
  {
    id: "tmdb.home.series.comedy",
    name: "Series de comedia",
    type: "series",
    path: "/discover/tv",
    params: { sort_by: "popularity.desc", with_genres: "35", "vote_count.gte": "100" },
  },
  {
    id: "tmdb.home.series.drama",
    name: "Series de drama",
    type: "series",
    path: "/discover/tv",
    params: { sort_by: "popularity.desc", with_genres: "18", "vote_count.gte": "100" },
  },
  {
    id: "tmdb.home.movie.science_fiction_fantasy",
    name: "Películas de ciencia ficción y fantasía",
    type: "movie",
    path: "/discover/movie",
    params: { sort_by: "popularity.desc", with_genres: "878|14", "vote_count.gte": "100" },
  },
  {
    id: "tmdb.home.movie.romance",
    name: "Películas románticas",
    type: "movie",
    path: "/discover/movie",
    params: { sort_by: "popularity.desc", with_genres: "10749", "vote_count.gte": "50" },
  },
  {
    id: "tmdb.home.series.documentary",
    name: "Series documentales",
    type: "series",
    path: "/discover/tv",
    params: { sort_by: "popularity.desc", with_genres: "99", "vote_count.gte": "20" },
  },
  {
    id: "tmdb.home.series.action_adventure",
    name: "Series de acción y aventura",
    type: "series",
    path: "/discover/tv",
    params: { sort_by: "popularity.desc", with_genres: "10759", "vote_count.gte": "50" },
  },
  {
    id: "tmdb.home.movie.classics_pre_1990",
    name: "Clásicos del cine anteriores a 1990",
    type: "movie",
    path: "/discover/movie",
    params: {
      sort_by: "vote_average.desc",
      "vote_count.gte": "100",
      "primary_release_date.lte": "1989-12-31",
    },
  },
  {
    id: "tmdb.home.series.classics_pre_1990",
    name: "Series clásicas anteriores a 1990",
    type: "series",
    path: "/discover/tv",
    params: {
      sort_by: "vote_average.desc",
      "vote_count.gte": "50",
      "first_air_date.lte": "1989-12-31",
    },
  },
];

const HOME_ROW_ITEM_LIMIT = 20;

const HOME_ROW_ORDER = [
  "movie:tmdb.best_movie_90s",
  "series:tmdb.best_series_90s",
  "movie:tmdb.best_movie_2000s",
  "movie:tmdb.home.movie.horror",
  "movie:tmdb.home.movie.family",
  "series:tmdb.best_series_2000s",
  "series:tmdb.home.series.comedy",
  "series:tmdb.home.series.drama",
  "movie:tmdb.best_movie_2010s",
  "movie:tmdb.home.movie.science_fiction_fantasy",
  "movie:tmdb.home.movie.romance",
  "series:tmdb.best_series_2010s",
  "series:tmdb.home.series.documentary",
  "series:tmdb.home.series.action_adventure",
  "movie:tmdb.best_movie_2020s",
  "movie:tmdb.home.movie.classics_pre_1990",
  "series:tmdb.home.series.classics_pre_1990",
  "series:tmdb.best_series_2020s",
] as const;

async function fetchHomeRow(request: HomeRowRequest): Promise<CatalogRowData | null> {
  try {
    const page = await tmdbFetch<TmdbHomeRowPage>(request.path, {
      params: { ...COMMON_PARAMS, ...request.params },
    });
    const seen = new Set<string>();
    const items = (page?.results ?? [])
      .map(item => mapMovieSeriesGenreItem(item, request.type))
      .filter((item): item is MediaItem => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, HOME_ROW_ITEM_LIMIT);
    if (!items.length) return null;

    return {
      addonId: "aetherio-starter",
      addonName: "Aetherio",
      catalogId: request.id,
      type: request.type,
      name: request.name,
      subtitle: "Actualizado con TMDB",
      items,
    };
  } catch {
    return null;
  }
}

export async function fetchMovieSeriesHomeRows(): Promise<CatalogRowData[]> {
  const rows = await Promise.all(HOME_ROW_REQUESTS.map(fetchHomeRow));
  return rows.filter((row): row is CatalogRowData => Boolean(row));
}

export function orderMovieSeriesHomeRows(rows: CatalogRowData[]): CatalogRowData[] {
  const rowKey = (row: CatalogRowData) => `${row.type}:${row.catalogId}`;
  const rowsByKey = new Map(rows.map(row => [rowKey(row), row]));
  const preferredKeys = new Set<string>(HOME_ROW_ORDER);
  const orderedRows = HOME_ROW_ORDER
    .map(key => rowsByKey.get(key))
    .filter((row): row is CatalogRowData => Boolean(row));
  const unlistedRows = rows.filter(row => !preferredKeys.has(rowKey(row)));
  return [...orderedRows, ...unlistedRows];
}
