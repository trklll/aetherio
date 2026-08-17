import type { StreamQuery } from "../../../types/stream";
import { playbackOverrideQueryKey } from "../utils";

const SUBTITLE_DELAY_STORAGE_KEY = "aetherio:subtitleDelayByVideo";

interface SubtitleDelayRecord {
  [videoKey: string]: number;
}

function readRecords(): SubtitleDelayRecord {
  try {
    const raw = localStorage.getItem(SUBTITLE_DELAY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SubtitleDelayRecord;
  } catch {
    return {};
  }
}

function writeRecords(records: SubtitleDelayRecord) {
  try {
    localStorage.setItem(SUBTITLE_DELAY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Almacenamiento no disponible; el delay simplemente no persiste.
  }
}

export function getSavedSubtitleDelayMs(query: StreamQuery | null | undefined): number {
  const videoKey = playbackOverrideQueryKey(query);
  if (!videoKey) return 0;
  const value = readRecords()[videoKey];
  return Number.isFinite(value) ? Math.round(value) : 0;
}

export function saveSubtitleDelayMs(query: StreamQuery | null | undefined, delayMs: number) {
  const videoKey = playbackOverrideQueryKey(query);
  if (!videoKey) return;
  const records = readRecords();
  if (delayMs === 0) {
    delete records[videoKey];
  } else {
    records[videoKey] = Math.round(delayMs);
  }
  writeRecords(records);
}