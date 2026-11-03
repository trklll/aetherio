import type { MediaStream } from "../types/stream.ts";
import { getMagnetBtih, isValidMagnetUri, normalizeBtih } from "../utils/playableMedia.ts";
import { normalizeSeederCount } from "../utils/torrentHealth.ts";

interface RuntimeTorrentOrigin { key: string; name: string; ownerName: string; repositoryName: string; logo?: string }

/** Script providers may return BitTorrent identity, not just direct HTTP files. */
export function normalizeProviderRuntimeTorrent(
  raw: Record<string, unknown>, origin: RuntimeTorrentOrigin, index: number,
): MediaStream | null {
  const sources = [raw.url, ...(Array.isArray(raw.sources) ? raw.sources : [])]
    .filter((value): value is string => typeof value === "string" && isValidMagnetUri(value));
  const infoHash = normalizeBtih(raw.infoHash) ?? sources.map(getMagnetBtih).find(Boolean);
  if (!infoHash) return null;
  const hints = raw.behaviorHints && typeof raw.behaviorHints === "object" ? raw.behaviorHints as Record<string, unknown> : {};
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title : origin.name;
  const seeders = normalizeSeederCount(raw.seeders ?? hints.seeders);
  return {
    id: `provider|${origin.key}|${index}|${infoHash}`,
    addonId: `providerRuntime-provider:${origin.key}`,
    addonName: `${origin.ownerName} · ${origin.repositoryName}`,
    sourceName: origin.name, sourceLogo: origin.logo, name: origin.name, title, infoHash,
    sources: sources.length ? [...new Set(sources)] : undefined,
    seeders, size: typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size > 0 ? raw.size : undefined,
    fileIdx: typeof raw.fileIdx === "number" && Number.isSafeInteger(raw.fileIdx) && raw.fileIdx >= 0 ? raw.fileIdx : undefined,
    languages: Array.isArray(raw.languages) ? raw.languages.filter((value): value is string => typeof value === "string") : undefined,
    behaviorHints: { ...hints, filename: title, providerName: origin.name, sourceOrigin: "providerRuntime", providerRepository: origin.repositoryName, providerOwner: origin.ownerName },
  };
}
