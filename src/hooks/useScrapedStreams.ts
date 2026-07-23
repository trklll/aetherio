import { useCallback, useEffect, useState } from "react";
import {
  isProviderEnabled,
  isSeanimeExtensionEnabled,
  isScraperSiteEnabled,
  sourcePreferencesSignature,
  useSourcePreferences,
} from "../config/sourcePreferences";
import { isTauriRuntime } from "../runtime/platform";
import {
  getGlobalCloudstreamRepositories,
  selectCloudstreamAdapters,
  type CloudstreamCompatibleAdapter,
} from "../services/cloudstreamRepositoryService";
import {
  clearNuvioProviderResultCache,
  getNuvioProviderRepositories,
  scrapeNuvioProviders,
} from "../services/nuvioProviderService";
import { getScraperSites, scrapeStreams, type ScrapedStream } from "../services/scraperService";
import {
  clearSeanimeCaches,
  getSeanimeExtensionInventory,
  scrapeSeanimeExtensions,
} from "../services/seanimeExtensionService";
import type { MediaStream, StreamQuery } from "../types/stream";
import { isPlayableMediaStream } from "../utils/playableMedia";

const SCRAPED_CACHE_TTL_MS = 5 * 60 * 1000;
const OKRU_SIGNED_CACHE_TTL_MS = 30 * 1000;
const SIGNED_MEDIA_CACHE_TTL_MS = 2 * 60 * 1000;
const DEBUG_SCRAPERS = import.meta.env.DEV;
const scrapedCache = new Map<string, { streams: MediaStream[]; updatedAt: number; ttlMs: number }>();

function cacheKey(query: StreamQuery, searchName: string, preferencesKey: string): string {
  const ep = typeof query.season === "number" && query.episode
    ? `${query.id}:${query.season}:${query.episode}`
    : query.id;
  return `providers-v5|${query.type}|${ep}|${searchName}|${preferencesKey}`;
}

function scrapedToMediaStream(scraped: ScrapedStream): MediaStream | null {
  const iframeFallback = Boolean(scraped.embedUrl && scraped.embedUrl === scraped.url);
  if (iframeFallback) return null;
  const stream = {
    id: `scraped|${scraped.id}`,
    addonId: "scraper",
    addonName: scraped.siteName,
    name: scraped.siteName,
    title: scraped.title ?? scraped.siteName,
    description: scraped.quality ? `Calidad: ${scraped.quality}` : iframeFallback ? "Reproductor web" : undefined,
    url: scraped.url,
    languages: scraped.languages,
    subtitles: scraped.subtitles,
    behaviorHints: {
      filename: scraped.title,
      notWebReady: false,
      scraperPlayback: "direct",
      scraperResolvedDirect: true,
      iframeUrl: scraped.embedUrl,
      headers: scraped.headers,
      referrer: scraped.headers?.Referer ?? (scraped.embedUrl ? new URL(scraped.embedUrl).origin : undefined),
    },
  } satisfies MediaStream;
  return isPlayableMediaStream(stream) ? stream : null;
}

function mergeStreams(current: MediaStream[], incoming: MediaStream[]) {
  const seen = new Set<string>();
  return [...current, ...incoming].filter(stream => {
    const key = `${stream.url ?? ""}|${stream.infoHash ?? ""}|${JSON.stringify(stream.behaviorHints?.headers ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cloudstreamAdapterForStream(
  stream: MediaStream,
  adaptersByProviderKey: ReadonlyMap<string, CloudstreamCompatibleAdapter>,
) {
  const addonId = stream.addonId ?? "";
  if (!addonId.startsWith("nuvio-provider:")) return undefined;
  return adaptersByProviderKey.get(addonId.slice("nuvio-provider:".length));
}

function labelCloudstreamStreams(
  streams: MediaStream[],
  adapters: CloudstreamCompatibleAdapter[],
) {
  const adaptersByProviderKey = new Map(adapters.map(adapter => [adapter.providerKey, adapter]));
  return streams.flatMap(stream => {
    const adapter = cloudstreamAdapterForStream(stream, adaptersByProviderKey);
    if (!adapter) return [];
    return [{
      ...stream,
      addonName: `Cloudstream · ${adapter.repositoryName}`,
      behaviorHints: {
        ...stream.behaviorHints,
        sourceOrigin: "cloudstream",
        cloudstreamRepository: adapter.repositoryName,
        cloudstreamRepositoryUrl: adapter.repositoryUrl,
        cloudstreamPlugin: adapter.pluginName,
        cloudstreamLanguage: adapter.language,
      },
    } satisfies MediaStream];
  });
}

function hasSignedOkruStream(streams: MediaStream[]) {
  return streams.some(stream => {
    try {
      return new URL(stream.url ?? "").hostname.toLowerCase().endsWith("okcdn.ru");
    } catch {
      return false;
    }
  });
}

function hasLikelySignedStream(streams: MediaStream[]) {
  const signedKeys = ["token", "expires", "expiry", "exp", "signature", "sig", "auth", "hdnts", "policy", "key-pair-id"];
  return streams.some(stream => {
    try {
      const url = new URL(stream.url ?? "");
      return signedKeys.some(key => url.searchParams.has(key));
    } catch {
      return false;
    }
  });
}

function scrapedResultCacheTtl(streams: MediaStream[]) {
  if (hasSignedOkruStream(streams)) return OKRU_SIGNED_CACHE_TTL_MS;
  if (hasLikelySignedStream(streams)) return SIGNED_MEDIA_CACHE_TTL_MS;
  return SCRAPED_CACHE_TTL_MS;
}

export function useScrapedStreams(query: StreamQuery | null, titleOverride?: string) {
  const sourcePreferences = useSourcePreferences();
  const preferencesKey = sourcePreferencesSignature(sourcePreferences);
  const [streams, setStreams] = useState<MediaStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  const reload = useCallback(() => {
    scrapedCache.clear();
    clearNuvioProviderResultCache();
    clearSeanimeCaches();
    setRefreshIndex(value => value + 1);
  }, []);

  useEffect(() => {
    if (!query || !isTauriRuntime()) return;
    const resolvedTitle = titleOverride?.trim();
    if (!resolvedTitle || resolvedTitle === query.id || /^\d+$/.test(resolvedTitle)) {
      setStreams([]);
      setLoading(true);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const searchName = resolvedTitle;
    const key = cacheKey(query, searchName, preferencesKey);
    const cached = scrapedCache.get(key);
    if (cached && Date.now() - cached.updatedAt < cached.ttlMs) {
      const playableCached = cached.streams.filter(isPlayableMediaStream);
      if (playableCached.length) {
        if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] cache hit", {
          queryId: query.id,
          streamCount: playableCached.length,
          ageMs: Date.now() - cached.updatedAt,
          ttlMs: cached.ttlMs,
        });
        setStreams(playableCached);
        setLoading(false);
        return;
      }
    }
    scrapedCache.delete(key);

    const batches: { native: MediaStream[]; providers: MediaStream[]; seanime: MediaStream[] } = {
      native: [],
      providers: [],
      seanime: [],
    };
    const failures: string[] = [];
    let pending = 3;
    const publish = (cacheCompleteResult = false) => {
      if (cancelled) return;
      const merged = [...batches.native, ...batches.providers, ...batches.seanime]
        .filter(isPlayableMediaStream);
      setStreams(merged);
      if (!cacheCompleteResult || !merged.length) return;
      scrapedCache.set(key, {
        streams: merged,
        updatedAt: Date.now(),
        ttlMs: scrapedResultCacheTtl(merged),
      });
    };
    const complete = (error?: unknown) => {
      if (error) failures.push(String(error));
      pending -= 1;
      if (!cancelled && pending === 0) {
        const finalStreams = [...batches.native, ...batches.providers, ...batches.seanime]
          .filter(isPlayableMediaStream);
        const cacheable = failures.length === 0 && finalStreams.length > 0;
        publish(cacheable);
        if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] complete", {
          queryId: query.id,
          streamCount: finalStreams.length,
          failureCount: failures.length,
          cached: cacheable,
          cacheTtlMs: cacheable
            ? scrapedResultCacheTtl(finalStreams)
            : 0,
        });
        setLoading(false);
        setError(failures.length === 3 ? failures.join("\n") : null);
      }
    };

    getScraperSites()
      .then(sites => {
        const selectedSites = sites
          .filter(site => isScraperSiteEnabled(sourcePreferences, site.id, site.enabledByDefault))
          .map(site => site.id);
        const prioritySites = selectedSites.filter(site => site === "okru");
        const remainingSites = selectedSites.filter(site => site !== "okru");
        if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] native request", {
          queryId: query.id,
          searchName,
          selectedSites,
          selectedSiteIds: selectedSites.join(","),
        });
        const runSites = (siteIds: string[], batch: "priority" | "remaining") => {
          if (!siteIds.length) return Promise.resolve([] as MediaStream[]);
          return scrapeStreams(
            searchName,
            query.type === "tv" ? "series" : query.type,
            query.id,
            query.season,
            query.episode,
            siteIds,
          ).then(results => {
            const fresh = results.map(scrapedToMediaStream).filter(isPlayableMediaStream);
            if (!cancelled && fresh.length) {
              batches.native = mergeStreams(batches.native, fresh);
              publish();
            }
            if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] native partial", {
              queryId: query.id,
              batch,
              siteIds,
              count: fresh.length,
              sources: [...new Set(fresh.map(stream => stream.addonName))],
            });
            if (DEBUG_SCRAPERS && batch === "priority") console.info("[AETHERIO:OKRU] result", JSON.stringify({
              queryId: query.id,
              title: searchName,
              selected: siteIds.includes("okru"),
              rawCount: results.length,
              acceptedCount: fresh.length,
              hosts: fresh.map(stream => {
                try { return new URL(stream.url ?? "").hostname; } catch { return "invalid"; }
              }),
            }));
            return fresh;
          });
        };
        return Promise.all([
          runSites(prioritySites, "priority"),
          runSites(remainingSites, "remaining"),
        ]).then(() => batches.native);
      })
      .then(results => {
        if (cancelled) return;
        if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] native result", {
          queryId: query.id,
          count: results.length,
          sources: [...new Set(results.map(stream => stream.addonName))],
        });
        publish();
      })
      .catch(err => {
        if (cancelled) return;
        if (DEBUG_SCRAPERS) console.error("[AETHERIO:SCRAPERS] native error", err);
        failures.push(String(err));
      })
      .finally(() => {
        if (!cancelled) complete();
      });

    getNuvioProviderRepositories()
      .then(async repositories => {
        const selectedProviders = repositories.flatMap(repository => repository.scrapers
          .filter(scraper => (
            scraper.supportsExternalPlayer
            && isProviderEnabled(
              sourcePreferences,
              repository.key,
              scraper.key,
              scraper.enabledByManifest,
            )
          ))
          .map(scraper => scraper.key));
        if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] providers request", {
          queryId: query.id,
          searchName,
          selectedProviders,
          selectedProviderIds: selectedProviders.join(","),
          scheduling: "immediate-progressive",
        });
        let cloudstreamAdapters: CloudstreamCompatibleAdapter[] = [];
        const onCloudstreamStreams = (fresh: MediaStream[]) => {
          if (cancelled || !fresh.length) return;
          // Prefer the Cloudstream-labelled copy while retaining the exact URL,
          // headers and resolver result produced by the single Nuvio JS run.
          batches.providers = mergeStreams(fresh, batches.providers);
          if (DEBUG_SCRAPERS) console.info("[AETHERIO:CLOUDSTREAM] spanish adapter result", JSON.stringify({
            queryId: query.id,
            count: fresh.length,
            executionMode: "reused-nuvio-js-result",
            streams: fresh.map(stream => ({
              cloudstreamRepository: stream.behaviorHints?.cloudstreamRepository,
              cloudstreamPlugin: stream.behaviorHints?.cloudstreamPlugin,
              adapterRepository: stream.behaviorHints?.providerRepository,
              provider: stream.name,
              providerKey: stream.addonId?.replace(/^nuvio-provider:/, ""),
              language: stream.behaviorHints?.cloudstreamLanguage,
            })),
          }));
          publish();
        };
        const onNuvioStreams = (fresh: MediaStream[]) => {
          if (cancelled || !fresh.length) return;
          batches.providers = mergeStreams(batches.providers, fresh);
          if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] provider partial", {
            queryId: query.id,
            count: fresh.length,
            sources: [...new Set(fresh.map(stream => stream.name))],
          });
          const labelled = labelCloudstreamStreams(fresh, cloudstreamAdapters);
          if (labelled.length) onCloudstreamStreams(labelled);
          else publish();
        };
        const cloudstreamInventoryPromise = getGlobalCloudstreamRepositories(repositories, refreshIndex > 0)
          .then(cloudstreamRepositories => {
            cloudstreamAdapters = selectCloudstreamAdapters(
              cloudstreamRepositories,
              new Set(selectedProviders),
            );
            if (DEBUG_SCRAPERS) console.info("[AETHERIO:CLOUDSTREAM] spanish adapters request", JSON.stringify({
              queryId: query.id,
              title: searchName,
              repositories: cloudstreamRepositories.map(repository => ({
                name: repository.name,
                activeExtensions: repository.pluginCount,
                spanishExtensions: repository.spanishPluginCount,
              })),
              adapters: cloudstreamAdapters.map(adapter => ({
                cloudstreamRepository: adapter.repositoryName,
                cloudstreamPlugin: adapter.pluginName,
                provider: adapter.providerName,
                providerKey: adapter.providerKey,
                adapterRepository: adapter.adapterRepositoryName,
                adapterRepositoryKey: adapter.adapterRepositoryKey,
                candidateProviderKeys: adapter.candidateProviderKeys,
                selectionReason: adapter.selectionReason,
                language: adapter.language,
                executionMode: "reuse-nuvio-js-adapter",
              })),
            }));
            const alreadyResolved = labelCloudstreamStreams(batches.providers, cloudstreamAdapters);
            if (alreadyResolved.length) onCloudstreamStreams(alreadyResolved);
            return cloudstreamRepositories;
          });
        let providerFailureCount = 0;
        const nuvioPromise = scrapeNuvioProviders(
          query,
          resolvedTitle,
          selectedProviders,
          onNuvioStreams,
          undefined,
          status => {
            providerFailureCount = status.failedProviderCount;
          },
        );
        const [nuvioResults] = await Promise.all([
          nuvioPromise,
          cloudstreamInventoryPromise,
        ]);
        const cloudstreamResults = labelCloudstreamStreams(nuvioResults, cloudstreamAdapters);
        if (cloudstreamResults.length) onCloudstreamStreams(cloudstreamResults);
        if (providerFailureCount > 0) {
          throw new Error(`${providerFailureCount} provider(s) directo(s) fallaron; no se almacenara el resultado parcial.`);
        }
        return mergeStreams(cloudstreamResults, nuvioResults);
      })
      .then(results => {
        if (cancelled) return;
        batches.providers = mergeStreams(batches.providers, results);
        if (DEBUG_SCRAPERS) console.info("[AETHERIO:SCRAPERS] providers result", {
          queryId: query.id,
          count: results.length,
          sources: [...new Set(results.map(stream => stream.name))],
        });
        publish();
      })
      .catch(error => {
        if (!cancelled) {
          if (DEBUG_SCRAPERS) console.error("[AETHERIO:SCRAPERS] providers error", error);
          failures.push(String(error));
        }
      })
      .finally(() => {
        if (!cancelled) complete();
      });

    getSeanimeExtensionInventory()
      .then(inventory => scrapeSeanimeExtensions(
        query,
        searchName,
        inventory.installed
          .filter(extension => isSeanimeExtensionEnabled(sourcePreferences, extension.id))
          .map(extension => extension.id),
      ))
      .then(results => {
        if (cancelled) return;
        batches.seanime = results;
        publish();
      })
      .catch(err => {
        if (cancelled) return;
        failures.push(String(err));
      })
      .finally(() => {
        if (!cancelled) complete();
      });

    return () => { cancelled = true; };
  }, [query?.type, query?.id, query?.season, query?.episode, titleOverride, preferencesKey, refreshIndex]);

  return { streams, loading, error, reload };
}
