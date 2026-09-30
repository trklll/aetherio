import type { StreamQuery } from "../../../types/stream";

export type SeekrContent =
  | { kind: "movie"; tmdbId?: number; imdbId?: string }
  | { kind: "episode"; showTmdbId?: number; showImdbId?: string; season: number; episode: number };

export interface SeekrPreviewCue {
  startTimeMs: number;
  endTimeMs: number;
  sheetUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SeekrTrack {
  cues: SeekrPreviewCue[];
  scale: number;
  sourceDurationMs: number;
  sheetUrls: string[];
}

const TIMESTAMP_PATTERN = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/;
const DEFAULT_TILE_WIDTH = 320;
const DEFAULT_TILE_HEIGHT = 180;
export const SEEKR_PREVIEW_OFFSET_LIMIT_MS = 240_000;
export const SEEKR_PREVIEW_OFFSET_STEP_MS = 10_000;

// Seekr indexa la edicion de referencia, que no siempre dura lo mismo que el
// archivo local: `scale` convierte el tiempo local al tiempo de la referencia y
// el desplazamiento manual corrige los cortes de edicion que ni la escala cubre.
export function clampSeekrOffsetMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-SEEKR_PREVIEW_OFFSET_LIMIT_MS, Math.min(SEEKR_PREVIEW_OFFSET_LIMIT_MS, Math.round(value)));
}

export function stepSeekrOffsetMs(
  currentMs: number,
  direction: -1 | 1,
  stepMs: number = SEEKR_PREVIEW_OFFSET_STEP_MS,
): number {
  const step = Number.isFinite(stepMs) && stepMs > 0 ? stepMs : SEEKR_PREVIEW_OFFSET_STEP_MS;
  return clampSeekrOffsetMs(clampSeekrOffsetMs(currentMs) + step * direction);
}

export function resolveSeekrTimelineMs(positionMs: number, offsetMs: number, scale: number): number {
  if (!Number.isFinite(positionMs) || positionMs <= 0) return 0;
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.max(0, Math.round(positionMs * safeScale) + clampSeekrOffsetMs(offsetMs));
}

/**
 * La barra de tiempo trabaja en SEGUNDOS y los cues de Seekr vienen en
 * MILISEGUNDOS. Sin esta conversion, comparar la posicion con los tiempos de los
 * cues siempre cae en el primer cue y el preview se queda clavado al principio.
 */
export function seekrTimelineMsForPosition(positionSeconds: number, offsetMs: number, scale: number): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return 0;
  return resolveSeekrTimelineMs(positionSeconds * 1_000, offsetMs, scale);
}

function parseTimestampMs(raw: string): number | null {
  const match = raw.trim().match(TIMESTAMP_PATTERN);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ?? "";
  const milliseconds = fraction ? Number(`${fraction}000`.slice(0, 3)) : 0;
  return ((hours * 3_600 + minutes * 60 + seconds) * 1_000) + milliseconds;
}

function strictInteger(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseSeekrVtt(raw: string): SeekrPreviewCue[] {
  const lines = raw.replace("\uFEFF", "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cues: SeekrPreviewCue[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timingIndex = lines[index].includes("-->") ? index : index + 1;
    const timing = lines[timingIndex]?.trim() ?? "";
    if (!timing.includes("-->")) continue;
    const parts = timing.split("-->");
    if (parts.length !== 2) continue;
    const startTimeMs = parseTimestampMs(parts[0].trim().split(/\s+/)[0]);
    const endTimeMs = parseTimestampMs(parts[1].trim().split(/\s+/)[0]);
    if (startTimeMs === null || endTimeMs === null) continue;
    let payloadIndex = timingIndex + 1;
    while (payloadIndex < lines.length && !lines[payloadIndex].trim()) payloadIndex += 1;
    const payload = lines[payloadIndex]?.trim() ?? "";
    const hashIndex = payload.lastIndexOf("#");
    if (hashIndex <= 0) continue;
    const sheetUrl = payload.slice(0, hashIndex);
    const fragment = payload.slice(hashIndex + 1);
    if (!fragment.startsWith("xywh=")) continue;
    const [rawX, rawY, rawWidth, rawHeight] = fragment.slice(5).split(",");
    const x = strictInteger(rawX);
    const y = strictInteger(rawY);
    const width = strictInteger(rawWidth);
    const height = strictInteger(rawHeight);
    if (x === null || y === null || width === null || height === null) continue;
    cues.push({
      startTimeMs,
      endTimeMs,
      sheetUrl,
      x,
      y,
      width: width > 0 ? width : DEFAULT_TILE_WIDTH,
      height: height > 0 ? height : DEFAULT_TILE_HEIGHT,
    });
    index = payloadIndex;
  }
  return cues.sort((left, right) => left.startTimeMs - right.startTimeMs);
}

export function findSeekrCueIndex(cues: SeekrPreviewCue[], positionMs: number): number {
  if (!cues.length) return -1;
  let low = 0;
  let high = cues.length;
  const corrected = positionMs;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].startTimeMs <= corrected) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}

export function buildSeekrContent(query: StreamQuery | null | undefined): SeekrContent | null {
  if (!query) return null;
  const baseId = query.id
    .replace(/^tmdb:/i, "")
    .replace(/^imdb:/i, "")
    .replace(/^(?:movie|series):/i, "")
    .split(":")[0]
    .split("/")[0]
    .trim();
  const imdbId = /^tt\d+$/i.test(baseId) ? baseId : undefined;
  const tmdbId = /^\d+$/.test(baseId) ? Number(baseId) : undefined;
  if (!imdbId && !tmdbId) return null;
  const isSeries = ["series", "tv", "show", "anime"].includes(query.type.toLowerCase());
  if (isSeries && query.season !== undefined && query.episode !== undefined) {
    return {
      kind: "episode",
      showTmdbId: tmdbId,
      showImdbId: imdbId,
      season: query.season,
      episode: query.episode,
    };
  }
  return { kind: "movie", tmdbId, imdbId };
}

export function buildSeekrLookupPath(content: SeekrContent, durationMs: number): string {
  const params = new URLSearchParams();
  params.set("duration_ms", String(Math.max(0, Math.round(durationMs))));
  if (content.kind === "movie") {
    if (content.imdbId) params.set("imdb_id", content.imdbId);
    if (content.tmdbId) params.set("tmdb_id", String(content.tmdbId));
  } else {
    if (content.showTmdbId) params.set("show_tmdb_id", String(content.showTmdbId));
    if (content.showImdbId) params.set("show_imdb_id", content.showImdbId);
    params.set("season", String(content.season));
    params.set("episode", String(content.episode));
  }
  return `/sprites?${params.toString()}`;
}

export function createSeekrTrack(
  cues: SeekrPreviewCue[],
  scale = 1,
  sourceDurationMs = 0,
): SeekrTrack {
  const sorted = [...cues].sort((left, right) => left.startTimeMs - right.startTimeMs);
  return {
    cues: sorted,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    sourceDurationMs: Number.isFinite(sourceDurationMs) && sourceDurationMs > 0 ? Math.round(sourceDurationMs) : 0,
    sheetUrls: Array.from(new Set(sorted.map(cue => cue.sheetUrl))),
  };
}
