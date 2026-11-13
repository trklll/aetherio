export function chooseDetailBackdrop(
  currentBackdrop: string | undefined,
  tmdbFallback: string | undefined,
  allowTmdbFallback: boolean,
) {
  if (currentBackdrop) return currentBackdrop;
  return allowTmdbFallback ? tmdbFallback : undefined;
}
