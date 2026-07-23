import type { MediaStream } from "../types/stream";

type StreamTextSource = Pick<MediaStream, "name" | "title" | "description" | "behaviorHints">;

function streamText(stream: StreamTextSource) {
  return [stream.name, stream.title, stream.description, stream.behaviorHints?.filename]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" | ");
}

export function normalizeSeederCount(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  }
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d+(?:[.,]\d+)?)\s*([km])?$/i);
  if (!match) return undefined;
  const suffix = match[2]?.toLowerCase();
  const parsed = suffix
    ? Number(match[1].replace(",", ".")) * (suffix === "m" ? 1_000_000 : 1_000)
    : Number(match[1].replace(/[.,](?=\d{3}(?:\D|$))/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function extractReportedSeedersFromText(text: string): number | undefined {
  const count = "(\\d+(?:[.,]\\d+)?\\s*[kKmM]?)";
  const patterns = [
    new RegExp(`(?:👤|🌱)\\s*[:=x-]?\\s*${count}`),
    new RegExp(`(?:seeders?|seeds?|semillas?)\\s*[:=x-]?\\s*${count}`, "i"),
    new RegExp(`${count}\\s*(?:seeders?|seeds?|semillas?)`, "i"),
    new RegExp(`\\bS\\s*[:=]\\s*${count}`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const parsed = normalizeSeederCount(match?.[1]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function getReportedSeeders(stream: StreamTextSource & { seeders?: number }): number | undefined {
  const direct = normalizeSeederCount(stream.seeders ?? stream.behaviorHints?.seeders);
  return direct ?? extractReportedSeedersFromText(streamText(stream));
}

export function extractByteSizeFromText(text: string): number | undefined {
  const match = text.match(/(?:💾|📦)?\s*(\d+(?:[.,]\d+)?)\s*(tib|tb|gib|gb|mib|mb|kib|kb)\b/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    tib: 1024 ** 4,
    tb: 1e12,
    gib: 1024 ** 3,
    gb: 1e9,
    mib: 1024 ** 2,
    mb: 1e6,
    kib: 1024,
    kb: 1e3,
  };
  const multiplier = multipliers[unit];
  if (!multiplier) return undefined;
  const bytes = value * multiplier;
  return Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
}

export function getStreamSizeBytes(stream: StreamTextSource & { size?: number }): number | undefined {
  if (typeof stream.size === "number" && Number.isFinite(stream.size) && stream.size > 0) return stream.size;
  const hinted = Number(stream.behaviorHints?.videoSize ?? stream.behaviorHints?.size);
  if (Number.isFinite(hinted) && hinted > 0) return hinted;
  return extractByteSizeFromText(streamText(stream));
}

export function torrentHealthScore(stream: StreamTextSource & { seeders?: number; size?: number }) {
  const seeders = getReportedSeeders(stream);
  const size = getStreamSizeBytes(stream);
  let score = 0;
  if (seeders === 0) score -= 80;
  else if (seeders !== undefined) score += Math.min(64, Math.log2(seeders + 1) * 6);
  if (size !== undefined) {
    const sizeGiB = size / (1024 ** 3);
    if (sizeGiB <= 8) score += 10;
    else if (sizeGiB >= 80) score -= 36;
    else if (sizeGiB >= 40) score -= 26;
    else if (sizeGiB >= 20) score -= 16;
    else if (sizeGiB >= 12) score -= 8;
  }
  return score;
}
