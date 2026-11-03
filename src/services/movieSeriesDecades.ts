import { tmdbFetch } from "../config/apiKeys";
import type { CatalogRowData } from "../types/ui";
import { mapMovieSeriesGenreItem } from "./movieSeriesGenres";

export interface MovieSeriesDecade {
  startYear: number;
  endYear: number;
  label: string;
  suffix: string;
}

export const MOVIE_SERIES_DECADES: readonly MovieSeriesDecade[] = [
  { startYear: 1990, endYear: 1999, label: "los 90", suffix: "90s" },
  { startYear: 2000, endYear: 2009, label: "los 2000", suffix: "2000s" },
  { startYear: 2010, endYear: 2019, label: "los 2010", suffix: "2010s" },
  { startYear: 2020, endYear: 2029, label: "los 2020", suffix: "2020s" },
];

const DECADE_RAIL_ITEM_LIMIT = 20;
const MINIMUM_VOTE_COUNT = "100";

interface TmdbDecadeResult {
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

interface TmdbDecadePage {
  results?: TmdbDecadeResult[];
}

type DecadeMediaType = "movie" | "series";

function decadeRow(
  decade: MovieSeriesDecade,
  type: DecadeMediaType,
  rawItems: TmdbDecadeResult[],
): CatalogRowData | null {
  const items = rawItems
    .map(item => mapMovieSeriesGenreItem(item, type))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, DECADE_RAIL_ITEM_LIMIT);
  if (!items.length) return null;

  const isMovie = type === "movie";
  const formatLabel = isMovie ? "películas" : "series";
  const mediaLabel = isMovie ? "movie" : "series";
  return {
    addonId: "aetherio-starter",
    addonName: "Aetherio",
    catalogId: `tmdb.best_${mediaLabel}_${decade.suffix}`,
    type,
    name: `Las mejores ${formatLabel} de ${decade.label}`,
    subtitle: `Selección TMDB · ${decade.startYear}–${decade.endYear}`,
    presentation: "cinematic",
    items,
  };
}

async function fetchDecadeRail(decade: MovieSeriesDecade, type: DecadeMediaType): Promise<CatalogRowData | null> {
  const isMovie = type === "movie";
  const dateField = isMovie ? "primary_release_date" : "first_air_date";
  const path = isMovie ? "/discover/movie" : "/discover/tv";
  try {
    const page = await tmdbFetch<TmdbDecadePage>(path, {
      params: {
        sort_by: "vote_average.desc",
        language: "es-ES",
        page: "1",
        include_adult: "false",
        "vote_count.gte": MINIMUM_VOTE_COUNT,
        [`${dateField}.gte`]: `${decade.startYear}-01-01`,
        [`${dateField}.lte`]: `${decade.endYear}-12-31`,
      },
    });
    return decadeRow(decade, type, page?.results ?? []);
  } catch {
    return null;
  }
}

export async function fetchMovieSeriesDecadeRows(): Promise<CatalogRowData[]> {
  const rows = await Promise.all(MOVIE_SERIES_DECADES.flatMap(decade => [
    fetchDecadeRail(decade, "movie"),
    fetchDecadeRail(decade, "series"),
  ]));
  return rows.filter((row): row is CatalogRowData => Boolean(row));
}
