import type { StreamTechnicalMetadata } from "../types/stream.ts";

const FIRST_VALUE_KEYS = {
  resolutionHeight: ["resolutionHeight", "height", "videoHeight", "video_height", "resolution"],
  videoCodec: ["videoCodec", "video_codec", "codecVideo", "videoCodecName", "video_codecs"],
  audioCodec: ["audioCodec", "audio_codec", "codecAudio", "audioCodecName", "audio_codecs"],
  audioChannels: ["audioChannels", "audio_channels", "channels", "channelCount"],
  dynamicRange: ["dynamicRange", "dynamic_range", "videoRange", "video_range", "hdr", "range"],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstValue(records: Record<string, unknown>[], keys: readonly string[]) {
  for (const current of records) {
    for (const key of keys) {
      const value = current[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const dimensions = value.match(/\b\d{3,5}\s*[x×]\s*(\d{3,5})\b/i);
  if (dimensions) return Number(dimensions[1]);
  const match = value.match(/\b(\d{2,5})\s*(?:p|px)?\b/i);
  const parsed = Number(match?.[1] ?? value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeChannels(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const layout = value.match(/(?:^|\D)([1-9]\d?)\s*\.\s*([0-9])(?:\s*(?:ch|channels?))?(?:$|\D)/i);
  if (layout) return Number(layout[1]) + Number(layout[2]);
  const match = value.match(/(?:^|\D)([1-9]\d?)(?:\.0|\.1|\s*(?:ch|channels?))?(?:$|\D)/i);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Extracts only explicitly supplied technical fields; it never infers channels from codecs. */
export function normalizeStreamTechnicalMetadata(...values: unknown[]): StreamTechnicalMetadata | undefined {
  const records = values.map(record).filter(current => Object.keys(current).length > 0);
  if (!records.length) return undefined;
  const metadata: StreamTechnicalMetadata = {
    resolutionHeight: positiveInteger(firstValue(records, FIRST_VALUE_KEYS.resolutionHeight)),
    videoCodec: normalizeText(firstValue(records, FIRST_VALUE_KEYS.videoCodec))
      ?? normalizeText(firstValue(records, ["codec", "codecs"])),
    audioCodec: normalizeText(firstValue(records, FIRST_VALUE_KEYS.audioCodec)),
    audioChannels: normalizeChannels(firstValue(records, FIRST_VALUE_KEYS.audioChannels)),
    dynamicRange: firstValue(records, FIRST_VALUE_KEYS.dynamicRange) === true
      ? "HDR"
      : normalizeText(firstValue(records, FIRST_VALUE_KEYS.dynamicRange)),
  };
  return Object.values(metadata).some(value => value !== undefined) ? metadata : undefined;
}

export function mergeStreamTechnicalMetadata(
  base?: StreamTechnicalMetadata,
  next?: StreamTechnicalMetadata,
): StreamTechnicalMetadata | undefined {
  const merged = { ...base, ...next };
  return Object.values(merged).some(value => value !== undefined) ? merged : undefined;
}
