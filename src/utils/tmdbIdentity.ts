export type TmdbSearchCandidate = {
  kind: "movie" | "tv";
  item: {
    id: number;
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    release_date?: string;
    first_air_date?: string;
    original_language?: string;
    genre_ids?: unknown[];
    genres?: unknown[];
    poster_path?: string;
    backdrop_path?: string;
    popularity?: number;
  };
};

function compactTitle(value?: string | null) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function titleCandidates(item: TmdbSearchCandidate["item"]) {
  return [item.title, item.name, item.original_title, item.original_name]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(compactTitle);
}

function titleScore(item: TmdbSearchCandidate["item"], wantedTitle: string) {
  if (!wantedTitle) return 0;
  const candidates = titleCandidates(item);
  if (candidates.some(candidate => candidate === wantedTitle)) return 1000;
  if (candidates.some(candidate => candidate.includes(wantedTitle) || wantedTitle.includes(candidate))) return 500;
  return 0;
}

function candidateYear(item: TmdbSearchCandidate["item"]) {
  return Number(String(item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || 0;
}

function isAnimeCandidate(item: TmdbSearchCandidate["item"]) {
  const genreIds = [
    ...(item.genre_ids ?? []),
    ...(item.genres ?? []).map(genre => typeof genre === "object" && genre !== null ? (genre as { id?: unknown }).id : genre),
  ];
  const genreNames = (item.genres ?? [])
    .map(genre => typeof genre === "object" && genre !== null ? (genre as { name?: unknown }).name : undefined)
    .filter((name): name is string => typeof name === "string")
    .map(name => name.toLowerCase());
  return item.original_language === "ja"
    || genreIds.some(id => Number(id) === 16)
    || genreNames.some(name => name === "anime" || name === "animation");
}

export function pickTmdbSearchCandidate(
  candidates: TmdbSearchCandidate[],
  wantedName: string,
  wantedYear?: number,
  preferAnime = false,
) {
  const wantedTitle = compactTitle(wantedName);
  const scored = candidates.map(candidate => {
    const exactTitle = titleScore(candidate.item, wantedTitle);
    const yearMatch = wantedYear && candidateYear(candidate.item) === wantedYear ? 250 : 0;
    const animeSignal = preferAnime && isAnimeCandidate(candidate.item) ? 100 : 0;
    const movieTieBreak = preferAnime && candidate.kind === "movie" ? 10 : 0;
    const value = exactTitle + yearMatch + animeSignal + movieTieBreak + Number(candidate.item.popularity ?? 0) / 1000;
    return { candidate, exactTitle, value };
  });

  // A popular result with a different title is never a valid identity match.
  // Falling back to it was the source of cross-title detail pages when a
  // provider returned an empty/partial search response.
  const matching = wantedTitle
    ? scored.filter(item => item.exactTitle > 0)
    : preferAnime
      ? scored.filter(item => isAnimeCandidate(item.candidate.item))
      : [];
  return matching
    .sort((left, right) => right.value - left.value)
    [0]?.candidate;
}
