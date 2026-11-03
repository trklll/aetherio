export interface AdaptivePreviewPlan {
  strideSeconds: number;
  allowWholeFile: boolean;
  maximumAheadSeconds: number;
}

export const PREVIEW_ZONE_SECONDS = 5;
const PREVIEW_ZONE_MS = PREVIEW_ZONE_SECONDS * 1_000;

export function clampPreviewTime(timeSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(timeSeconds)) return 0;
  const lowerBounded = Math.max(0, timeSeconds);
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.min(durationSeconds, lowerBounded)
    : lowerBounded;
}

export function getPreviewCacheSlotMs(timeSeconds: number): number {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return 0;
  return Math.floor(timeSeconds / PREVIEW_ZONE_SECONDS) * PREVIEW_ZONE_MS;
}

export function getPreviewRequestTimeSeconds(timeSeconds: number, durationSeconds?: number): number {
  const boundedTime = clampPreviewTime(timeSeconds, durationSeconds ?? Number.POSITIVE_INFINITY);
  let zoneStartSeconds = getPreviewCacheSlotMs(boundedTime) / 1_000;
  const hasDuration = typeof durationSeconds === "number"
    && Number.isFinite(durationSeconds)
    && durationSeconds > 0;
  // A target exactly at an end-of-file zone boundary belongs to the last
  // playable zone, not to a frame beyond the media duration.
  if (hasDuration && zoneStartSeconds >= durationSeconds) {
    zoneStartSeconds = Math.floor(Math.max(0, durationSeconds - 0.001) / PREVIEW_ZONE_SECONDS)
      * PREVIEW_ZONE_SECONDS;
  }
  return zoneStartSeconds;
}

/**
 * Conservative baseline for background work. Only known-size media below
 * 20 GB may be sampled across the complete title; larger and unknown streams
 * stay in a bounded window. Live sources have no arbitrary seek timeline.
 */
export function getAdaptivePreviewPlan(
  mediaSizeBytes: number | null | undefined,
  live: boolean,
): AdaptivePreviewPlan {
  if (live) {
    return { strideSeconds: 0, allowWholeFile: false, maximumAheadSeconds: 0 };
  }

  const knownSize = typeof mediaSizeBytes === "number"
    && Number.isFinite(mediaSizeBytes)
    && mediaSizeBytes > 0;
  if (!knownSize) {
    return { strideSeconds: 15, allowWholeFile: false, maximumAheadSeconds: 60 };
  }

  if (mediaSizeBytes < 20_000_000_000) {
    return { strideSeconds: PREVIEW_ZONE_SECONDS, allowWholeFile: true, maximumAheadSeconds: 0 };
  }

  return { strideSeconds: 20, allowWholeFile: false, maximumAheadSeconds: 60 };
}
