export function relatedMediaDetailSeed(item: {
  id: number | string;
  title?: string;
  media_type: string;
  poster_path?: string;
  backdrop_path?: string;
}) {
  return {
    id: `tmdb:${item.id}`,
    type: item.media_type === "tv" ? "series" : item.media_type,
    name: item.title,
    poster: item.poster_path,
    background: item.backdrop_path,
  };
}
