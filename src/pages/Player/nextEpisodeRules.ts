// Regla de disparo del siguiente episodio / UpNext, portada de NuvioTV
// (PlayerNextEpisodeRules.shouldShowNextEpisodeCard + PostPlayRecommendationTiming).
//
// Nuvio no usa un umbral puro: primero mira los segmentos de outro/credits
// (AniSkip / Anime-Skip / IntroDB) y solo usa el umbral configurado cuando el
// outro termina lejos del final. Si el outro termina pegado al final, dispara
// en el inicio del outro más temprano.
//
// Unidades en Aetherio: segundos (currentTime/duration de mpv). En Nuvio son ms.

export type NextEpisodeThresholdMode = "percentage" | "minutes";

export interface OutroSegment {
  start: number;
  end: number;
}

// Clamps idénticos a Nuvio (PlayerNextEpisodeRules + PlayerSettings).
export const MIN_NEXT_EPISODE_THRESHOLD_PERCENT = 97;
export const MAX_NEXT_EPISODE_THRESHOLD_PERCENT = 100;
export const MIN_NEXT_EPISODE_THRESHOLD_MINUTES = 0;
export const MAX_NEXT_EPISODE_THRESHOLD_MINUTES = 3.5;
export const MIN_POST_PLAY_MOVIE_THRESHOLD_PERCENT = 80;
export const MAX_POST_PLAY_MOVIE_THRESHOLD_PERCENT = 100;

export function clampNextEpisodeThresholdPercent(value: unknown, fallback = 99): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_NEXT_EPISODE_THRESHOLD_PERCENT, Math.max(MIN_NEXT_EPISODE_THRESHOLD_PERCENT, parsed));
}

export function clampNextEpisodeThresholdMinutes(value: unknown, fallback = 2): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_NEXT_EPISODE_THRESHOLD_MINUTES, Math.max(MIN_NEXT_EPISODE_THRESHOLD_MINUTES, parsed));
}

export function clampPostPlayMovieThresholdPercent(value: unknown, fallback = 90): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_POST_PLAY_MOVIE_THRESHOLD_PERCENT, Math.max(MIN_POST_PLAY_MOVIE_THRESHOLD_PERCENT, Math.round(parsed)));
}

export function normalizeThresholdMode(value: unknown): NextEpisodeThresholdMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "minutes" || normalized === "minutes_before_end" || normalized === "minutes-before-end") return "minutes";
  return "percentage";
}

interface NextEpisodeCardInput {
  /** Tiempo actual de reproducción, en segundos. */
  position: number;
  /** Duración total, en segundos. */
  duration: number;
  /** Segmentos de outro/credits conocidos, en segundos. */
  outroSegments: OutroSegment[];
  thresholdMode: NextEpisodeThresholdMode;
  thresholdPercent: number;
  thresholdMinutesBeforeEnd: number;
}

export function shouldShowNextEpisodeCard(input: NextEpisodeCardInput): boolean {
  const { position, duration } = input;
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return false;

  const outros = input.outroSegments.filter(
    segment => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start,
  );

  if (outros.length > 0) {
    const latestOutroEnd = Math.max(...outros.map(segment => segment.end));
    const earliestOutroStart = Math.min(...outros.map(segment => segment.start));
    const postOutroGap = duration - latestOutroEnd;

    // Umbral configurado expresado como segundos restantes.
    const userThreshold = input.thresholdMode === "percentage"
      ? (1 - clampNextEpisodeThresholdPercent(input.thresholdPercent) / 100) * duration
      : clampNextEpisodeThresholdMinutes(input.thresholdMinutesBeforeEnd) * 60;

    if (postOutroGap > userThreshold) {
      // El outro termina lejos del final: respetar el umbral del usuario.
      return followsUserThreshold(position, duration, input);
    }
    // Outro pegado al final: disparar en el inicio del outro más temprano.
    return position >= earliestOutroStart;
  }

  // Sin datos de outro: respaldo al umbral configurado.
  return followsUserThreshold(position, duration, input);
}

function followsUserThreshold(
  position: number,
  duration: number,
  input: Pick<NextEpisodeCardInput, "thresholdMode" | "thresholdPercent" | "thresholdMinutesBeforeEnd">,
): boolean {
  if (input.thresholdMode === "minutes") {
    const clampedMinutes = clampNextEpisodeThresholdMinutes(input.thresholdMinutesBeforeEnd);
    return duration - position <= clampedMinutes * 60;
  }
  const clampedPercent = clampNextEpisodeThresholdPercent(input.thresholdPercent);
  return position / duration >= clampedPercent / 100;
}

interface MovieRecommendationInput {
  position: number;
  duration: number;
  thresholdPercent: number;
}

/** Umbral de pelis de Nuvio (shouldShowMovieRecommendation): % puro, sin outro. */
export function shouldShowMovieRecommendation(input: MovieRecommendationInput): boolean {
  const { position, duration } = input;
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return false;
  const threshold = clampPostPlayMovieThresholdPercent(input.thresholdPercent);
  const clampedPosition = Math.min(Math.max(0, position), duration);
  return clampedPosition / duration >= threshold / 100;
}
