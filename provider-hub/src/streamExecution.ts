import { mergeProviderStreams } from "./merge.ts";
import type { MediaStream, ProviderRecord } from "./types.ts";

/** All enabled providers for a media type; registry position must not hide later sources. */
export function selectEnabledStreamProviders(
  providers: ProviderRecord[],
  type: "movie" | "tv",
): ProviderRecord[] {
  return providers.filter(provider => provider.enabled && provider.supportedTypes.includes(type));
}

/** Warm every enabled bundled module, plus explicitly retained compileAlways bundles. */
export function selectProvidersToWarmup<T extends { id: string; enabled: boolean }>(
  providers: T[],
  compileAlwaysIds: string[],
): T[] {
  const selected = new Set(providers.filter(provider => provider.enabled).map(provider => provider.id));
  for (const id of compileAlwaysIds) selected.add(id);
  return providers.filter(provider => selected.has(provider.id));
}

/** Bounded fan-out keeps broad provider coverage without launching every scraper at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency debe ser un entero positivo");
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

/** Stable identity across direct links, info hashes, and magnet-only results. */
export function streamDedupeKey(stream: MediaStream): string {
  const directUrl = typeof stream.url === "string" ? stream.url.trim() : "";
  if (directUrl) return `url:${directUrl}`;

  const infoHash = typeof stream.infoHash === "string" ? stream.infoHash.trim().toLowerCase() : "";
  if (infoHash) return `hash:${infoHash}`;

  const magnet = stream.sources?.find(source => typeof source === "string" && /^magnet:/i.test(source.trim()));
  return magnet ? `magnet:${magnet.trim().toLowerCase()}` : "";
}

/** The Stremio stream resource supports direct links and BitTorrent identities. */
export function streamsForStremio(provider: ProviderRecord, streams: MediaStream[]): MediaStream[] {
  return mergeProviderStreams(provider, streams).desktop;
}
