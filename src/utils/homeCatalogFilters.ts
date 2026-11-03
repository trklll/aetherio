const MOVIE_SERIES_TYPES = new Set(["movie", "series", "tv"]);

/** Remove the annual `New - YYYY` movie/series catalogs from Home. */
export function isYearBasedMovieSeriesHomeRow(title: string, type: string) {
  if (!MOVIE_SERIES_TYPES.has(type.trim().toLowerCase())) return false;
  return /^(?:new\s*-\s*\d{4}|(?:pel[ií]culas|series) nuevas de \d{4})$/i.test(title.trim());
}
