const TMDB_IMG = "https://image.tmdb.org/t/p";

const PREFERRED_BACKDROP_SIZES = [
  { width: 3840, height: 2160 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];

export function tmdbImage(path?: string | null, size: "original" | "w1280" | "w780" | "w500" | "w342" | "w185" = "original") {
  return path ? `${TMDB_IMG}/${size}${path}` : undefined;
}

export function ensureOriginalTmdbImage(url?: string | null) {
  if (!url) return undefined;
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${TMDB_IMG}/original/`);
}

export function pickPreferredTmdbBackdrop(backdrops: unknown, fallbackPath?: string | null) {
  const candidates = Array.isArray(backdrops)
    ? backdrops.filter((item: any) => typeof item?.file_path === "string")
    : [];

  for (const preferred of PREFERRED_BACKDROP_SIZES) {
    const exact = candidates
      .filter((item: any) => Number(item.width) === preferred.width && Number(item.height) === preferred.height)
      .sort(compareBackdropQuality)[0];
    if (exact) return tmdbImage(exact.file_path, "original");
  }

  const best = candidates
    .filter((item: any) => isBackdropRatio(item.aspect_ratio, item.width, item.height))
    .sort(compareBackdropFallback)[0];

  return tmdbImage(best?.file_path ?? fallbackPath, "original");
}

export function sortTmdbBackdropsByPreference(backdrops: unknown) {
  if (!Array.isArray(backdrops)) return [];
  return [...backdrops]
    .filter((item: any) => typeof item?.file_path === "string")
    .sort(compareBackdropFallback)
    .map((item: any) => tmdbImage(item.file_path, "original"))
    .filter((value): value is string => Boolean(value));
}

function compareBackdropQuality(a: any, b: any) {
  return Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0)
    || Number(b.vote_count ?? 0) - Number(a.vote_count ?? 0);
}

function compareBackdropFallback(a: any, b: any) {
  return backdropScore(b) - backdropScore(a);
}

function backdropScore(item: any) {
  const width = Number(item?.width ?? 0);
  const height = Number(item?.height ?? 0);
  const preferredIndex = PREFERRED_BACKDROP_SIZES.findIndex(size => width === size.width && height === size.height);
  const preferredScore = preferredIndex === -1 ? 0 : (PREFERRED_BACKDROP_SIZES.length - preferredIndex) * 1_000_000;
  const ratioScore = isBackdropRatio(item?.aspect_ratio, width, height) ? 80_000 : 0;
  const resolutionScore = Math.min(width * height, 3840 * 2160) / 100;
  const voteScore = Number(item?.vote_average ?? 0) * 100 + Math.min(Number(item?.vote_count ?? 0), 100);
  const languageScore = item?.iso_639_1 === null || item?.iso_639_1 === undefined || item?.iso_639_1 === "" ? 10_000 : 0;
  return preferredScore + ratioScore + resolutionScore + voteScore + languageScore;
}

function isBackdropRatio(aspectRatio: unknown, width?: number, height?: number) {
  const ratio = Number(aspectRatio) || (width && height ? width / height : 0);
  if (!Number.isFinite(ratio) || ratio <= 0) return true;
  return ratio >= 1.7 && ratio <= 1.85;
}
