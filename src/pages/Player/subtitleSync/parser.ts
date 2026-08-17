export interface SubtitleSyncCue {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
}

const TIMESTAMP_REGEX = /(?:(\d+):)?(\d{1,2}):(\d{2})([.,](\d+))?/;
const ASS_OVERRIDE_TAG_REGEX = /\{[^}]*\}/g;

export function parseSubtitleCuesFromText(rawText: string, sourceUrl: string): SubtitleSyncCue[] {
  const cleanedText = rawText
    .replace("\uFEFF", "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return looksLikeVtt(cleanedText, sourceUrl) ? parseVtt(cleanedText) : parseSrt(cleanedText);
}

function looksLikeVtt(text: string, sourceUrl: string): boolean {
  const normalizedUrl = sourceUrl.split("?")[0].split("#")[0].toLowerCase();
  if (normalizedUrl.endsWith(".vtt") || normalizedUrl.endsWith(".webvtt")) return true;
  return text.trimStart().startsWith("WEBVTT");
}

function parseSrt(text: string): SubtitleSyncCue[] {
  const blocks = text.split(/\n\s*\n/);
  const cues: SubtitleSyncCue[] = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0);
    if (lines.length === 0) continue;

    let index = 0;
    if (/^\d+$/.test(lines[index]) && index + 1 < lines.length) {
      index++;
    }
    const timing = lines[index];
    if (!timing || !timing.includes("-->")) continue;
    const parsed = parseStartEndTimeMs(timing);
    if (!parsed) continue;
    const [startTimeMs, endTimeMs] = parsed;
    if (endTimeMs - startTimeMs <= 0) continue;
    const textLines = lines.slice(index + 1);
    const cueText = normalizeCueText(textLines.join("\n"));
    if (!cueText.trim()) continue;
    cues.push({ startTimeMs, endTimeMs, text: cueText });
  }
  return cues;
}

function parseVtt(text: string): SubtitleSyncCue[] {
  const lines = text.split("\n").map(line => line.trimEnd());
  const cues: SubtitleSyncCue[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor].trim();
    if (!line) {
      cursor++;
      continue;
    }
    if (line.startsWith("WEBVTT")) {
      cursor++;
      continue;
    }
    if (isWebVttMetadataBlockHeader(line)) {
      const nextLine = lines[cursor + 1]?.trim() ?? "";
      if (!nextLine || !nextLine.includes("-->")) {
        cursor = skipWebVttBlock(lines, cursor + 1);
        continue;
      }
    }

    let timingLine = line;
    let textStart = cursor + 1;
    if (!timingLine.includes("-->")) {
      timingLine = lines[cursor + 1]?.trim() ?? "";
      textStart = cursor + 2;
    }
    if (!timingLine.includes("-->")) {
      cursor++;
      continue;
    }

    const parsed = parseStartEndTimeMs(timingLine);
    if (!parsed) {
      cursor++;
      continue;
    }
    const [startTimeMs, endTimeMs] = parsed;
    if (endTimeMs - startTimeMs <= 0) {
      cursor++;
      continue;
    }

    const textParts: string[] = [];
    let i = textStart;
    while (i < lines.length && lines[i].trim().length > 0) {
      textParts.push(lines[i].trim());
      i++;
    }
    const cueText = normalizeCueText(textParts.join("\n"));
    if (cueText.trim()) {
      cues.push({ startTimeMs, endTimeMs, text: cueText });
    }
    cursor = i + 1;
  }

  return cues;
}

function isWebVttMetadataBlockHeader(line: string): boolean {
  return (
    line === "STYLE" ||
    line === "REGION" ||
    line === "NOTE" ||
    line.startsWith("NOTE ") ||
    line.startsWith("NOTE\t")
  );
}

function skipWebVttBlock(lines: string[], start: number): number {
  let cursor = start;
  while (cursor < lines.length && lines[cursor].trim().length > 0) {
    cursor++;
  }
  return cursor < lines.length ? cursor + 1 : cursor;
}

function parseStartEndTimeMs(timingLine: string): [number, number] | null {
  const parts = timingLine.split("-->");
  if (parts.length !== 2) return null;
  const startTimeMs = parseTimestampMs(parts[0].trim().split(" ")[0]);
  if (startTimeMs === null) return null;
  const endTimeMs = parseTimestampMs(parts[1].trim().split(" ")[0]);
  if (endTimeMs === null) return null;
  return [startTimeMs, endTimeMs];
}

function parseTimestampMs(rawTimestamp: string): number | null {
  const match = rawTimestamp.trim().match(TIMESTAMP_REGEX);
  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : null;
  const seconds = match[3] ? Number(match[3]) : null;
  if (minutes === null || seconds === null) return null;
  const millisRaw = match[5] ?? "";
  let millis = 0;
  if (millisRaw.length === 1) millis = Number(`${millisRaw}00`);
  else if (millisRaw.length === 2) millis = Number(`${millisRaw}0`);
  else if (millisRaw.length >= 3) millis = Number(millisRaw.slice(0, 3)) || 0;
  return ((hours * 3600 + minutes * 60 + seconds) * 1000) + millis;
}

function normalizeCueText(text: string): string {
  return text
    .replace(/<(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d+)?>/g, "")
    .replace(/<\/?[a-zA-Z0-9._-]+(?: [^>]*)?>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .split("\n")
    .map(line => line.replace(/[ \t]+/g, " ").trim())
    .filter(line => line.length > 0)
    .join("\n");
}

export function sanitizeCuePreviewText(text: string): string {
  const cleaned = text
    .replace(ASS_OVERRIDE_TAG_REGEX, "")
    .replace(/\\N/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text.trim();
}

export function selectAutoSyncVisibleCues(
  cues: SubtitleSyncCue[],
  anchorTimeMs: number,
  marginMs = 180_000,
  maxVisible = 90,
): SubtitleSyncCue[] {
  if (cues.length === 0) return [];
  const sorted = [...cues].sort((a, b) => a.startTimeMs - b.startTimeMs);
  const lower = Math.max(0, anchorTimeMs - marginMs);
  const upper = anchorTimeMs + marginMs;
  const inWindow = sorted.filter(cue => cue.startTimeMs >= lower && cue.startTimeMs <= upper);
  if (inWindow.length > 0) {
    if (inWindow.length <= maxVisible) return inWindow;
    const centerIndex = nearestIndexByStartTime(inWindow, anchorTimeMs);
    return takeCentered(inWindow, centerIndex, maxVisible);
  }
  const nearestIndex = nearestIndexByStartTime(sorted, anchorTimeMs);
  return takeCentered(sorted, nearestIndex, maxVisible);
}

function nearestIndexByStartTime(items: SubtitleSyncCue[], anchorTimeMs: number): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  items.forEach((cue, index) => {
    const distance = Math.abs(cue.startTimeMs - anchorTimeMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function takeCentered(items: SubtitleSyncCue[], centerIndex: number, maxVisible: number): SubtitleSyncCue[] {
  if (items.length <= maxVisible) return items;
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(0, centerIndex - half);
  const end = Math.min(items.length, start + maxVisible);
  if (end - start < maxVisible) {
    start = Math.max(0, end - maxVisible);
  }
  return items.slice(start, end);
}

export function formatAutoSyncTimestamp(positionMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatAutoSyncDelay(delayMs: number): string {
  const sign = delayMs >= 0 ? "+" : "-";
  const absMs = Math.abs(delayMs);
  const seconds = Math.floor(absMs / 1000);
  const millis = absMs % 1000;
  return `${sign}${seconds}.${String(millis).padStart(3, "0")}s`;
}