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
  if (looksLikeAss(cleanedText, sourceUrl)) return parseAss(cleanedText);
  if (looksLikeTtml(cleanedText, sourceUrl)) return parseTtml(cleanedText);
  return looksLikeVtt(cleanedText, sourceUrl) ? parseVtt(cleanedText) : parseSrt(cleanedText);
}

function looksLikeVtt(text: string, sourceUrl: string): boolean {
  const normalizedUrl = sourceUrl.split("?")[0].split("#")[0].toLowerCase();
  if (normalizedUrl.endsWith(".vtt") || normalizedUrl.endsWith(".webvtt")) return true;
  return text.trimStart().startsWith("WEBVTT");
}

function looksLikeAss(text: string, sourceUrl: string): boolean {
  const normalizedUrl = sourceUrl.split("?")[0].split("#")[0].toLowerCase();
  return normalizedUrl.endsWith(".ass") || normalizedUrl.endsWith(".ssa") || /^\s*\[Script Info\]/i.test(text);
}

function looksLikeTtml(text: string, sourceUrl: string): boolean {
  const normalizedUrl = sourceUrl.split("?")[0].split("#")[0].toLowerCase();
  return normalizedUrl.endsWith(".ttml") || normalizedUrl.endsWith(".xml") || /<tt(?:\s|>)/i.test(text);
}

function parseAss(text: string): SubtitleSyncCue[] {
  let format: string[] = [];
  const cues: SubtitleSyncCue[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (/^Format\s*:/i.test(line) && /Start/i.test(line)) {
      format = line.slice(line.indexOf(":") + 1).split(",").map(value => value.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue\s*:/i.test(line)) continue;
    const values = line.slice(line.indexOf(":") + 1).split(",").map(value => value.trim());
    const startIndex = Math.max(0, format.indexOf("start"));
    const endIndex = Math.max(0, format.indexOf("end"));
    const textIndex = Math.max(0, format.indexOf("text"));
    const startTimeMs = parseTimestampMs(values[startIndex] ?? "");
    const endTimeMs = parseTimestampMs(values[endIndex] ?? "");
    if (startTimeMs === null || endTimeMs === null || endTimeMs <= startTimeMs) continue;
    const cueText = normalizeCueText((values.slice(textIndex).join(",") || "")
      .replace(/\\N|\\n/gi, "\n")
      .replace(ASS_OVERRIDE_TAG_REGEX, ""));
    if (cueText.trim()) cues.push({ startTimeMs, endTimeMs, text: cueText });
  }
  return cues.sort((left, right) => left.startTimeMs - right.startTimeMs);
}

function parseTtml(text: string): SubtitleSyncCue[] {
  const cues: SubtitleSyncCue[] = [];
  const pattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  for (const match of text.matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const begin = readXmlAttribute(attributes, "begin");
    const end = readXmlAttribute(attributes, "end");
    const duration = readXmlAttribute(attributes, "dur");
    const startTimeMs = parseXmlTime(begin);
    const durationMs = parseXmlTime(duration);
    const endTimeMs = parseXmlTime(end) ?? (startTimeMs !== null && durationMs !== null ? startTimeMs + durationMs : null);
    if (startTimeMs === null || endTimeMs === null || endTimeMs <= startTimeMs) continue;
    const cueText = normalizeCueText(match[2]
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "));
    if (cueText.trim()) cues.push({ startTimeMs, endTimeMs, text: cueText });
  }
  return cues.sort((left, right) => left.startTimeMs - right.startTimeMs);
}

function readXmlAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] ?? "";
}

function parseXmlTime(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const clock = parseTimestampMs(value.split(/[;\s]/)[0]);
  if (clock !== null) return clock;
  const seconds = Number(value.replace(/s$/i, ""));
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000) : null;
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

function formatWebVttTimestamp(timeMs: number): string {
  const totalMilliseconds = Math.max(0, Math.round(timeMs));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function serializeWebVttCues(cues: SubtitleSyncCue[]): string {
  const blocks = cues.map((cue, index) => {
    const text = cue.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    return `${index + 1}\n${formatWebVttTimestamp(cue.startTimeMs)} --> ${formatWebVttTimestamp(cue.endTimeMs)}\n${text}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}