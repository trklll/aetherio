import { useEffect, useState } from "react";
import {
  isProviderEnabled,
  isSeanimeExtensionEnabled,
  isScraperSiteEnabled,
  sourcePreferencesSignature,
  useSourcePreferences,
} from "../config/sourcePreferences";
import { isTauriRuntime } from "../runtime/platform";
import { getNuvioProviderRepositories, scrapeNuvioProviders } from "../services/nuvioProviderService";
import { getScraperSites, scrapeStreams, type ScrapedStream } from "../services/scraperService";
import { getSeanimeExtensionInventory, scrapeSeanimeExtensions } from "../services/seanimeExtensionService";
import type { MediaStream, StreamQuery } from "../types/stream";
import { isPlayableMediaStream } from "../utils/playableMedia";

const SCRAPED_CACHE_TTL_MS = 5 * 60 * 1000;
const scrapedCache = new Map<string, { streams: MediaStream[]; updatedAt: number }>();

function cacheKey(query: StreamQuery, searchName: string, preferencesKey: string): string {
  const ep = typeof query.season === "number" && query.episode
    ? `${query.id}:${query.season}:${query.episode}`
    : query.id;
  return `providers-v2|${query.type}|${ep}|${searchName}|${preferencesKey}`;
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
      iframeUrl: scraped.embedUrl,
      headers: scraped.headers,
      referrer: scraped.headers?.Referer ?? (scraped.embedUrl ? new URL(scraped.embedUrl).origin : undefined),
    },
  } satisfies MediaStream;
  return isPlayableMediaStream(stream) ? stream : null;
}

export function useScrapedStreams(query: StreamQuery | null, titleOverride?: string) {
  const sourcePreferences = useSourcePreferences();
  const preferencesKey = sourcePreferencesSignature(sourcePreferences);
  const [streams, setStreams] = useState<MediaStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query || !isTauriRuntime()) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const searchName = titleOverride?.trim() || query.id.replace(/^(tmdb|imdb):/, "");
    const key = cacheKey(query, searchName, preferencesKey);
    const cached = scrapedCache.get(key);
    if (cached && Date.now() - cached.updatedAt < SCRAPED_CACHE_TTL_MS) {
      setStreams(cached.streams.filter(isPlayableMediaStream));
      setLoading(false);
      return;
    }

    const batches: { native: MediaStream[]; providers: MediaStream[]; seanime: MediaStream[] } = {
      native: [],
      providers: [],
      seanime: [],
    };
    const failures: string[] = [];
    let pending = 3;
    const publish = () => {
      if (cancelled) return;
      const merged = [...batches.native, ...batches.providers, ...batches.seanime]
        .filter(isPlayableMediaStream);
      scrapedCache.set(key, { streams: merged, updatedAt: Date.now() });
      setStreams(merged);
    };
    const complete = (error?: unknown) => {
      if (error) failures.push(String(error));
      pending -= 1;
      if (!cancelled && pending === 0) {
        setLoading(false);
        setError(failures.length === 3 ? failures.join("\n") : null);
      }
    };

    getScraperSites()
      .then(sites => scrapeStreams(
        searchName,
        query.type === "tv" ? "series" : query.type,
        query.id,
        query.season,
        query.episode,
        sites
          .filter(site => isScraperSiteEnabled(sourcePreferences, site.id, site.enabledByDefault))
          .map(site => site.id),
      ))
      .then(results => {
        if (cancelled) return;
        batches.native = results.map(scrapedToMediaStream).filter(isPlayableMediaStream);
        publish();
      })
      .catch(err => {
        if (cancelled) return;
        failures.push(String(err));
      })
      .finally(() => {
        if (!cancelled) complete();
      });

    getNuvioProviderRepositories()
      .then(repositories => scrapeNuvioProviders(
        query,
        titleOverride?.trim() || undefined,
        repositories.flatMap(repository => repository.scrapers
          .filter(scraper => (
            scraper.supportsExternalPlayer
            && isProviderEnabled(
              sourcePreferences,
              repository.key,
              scraper.key,
              scraper.enabledByManifest,
            )
          ))
          .map(scraper => scraper.key)),
      ))
      .then(results => {
        if (cancelled) return;
        batches.providers = results;
        publish();
      })
      .catch(error => {
        if (!cancelled) failures.push(String(error));
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
  }, [query?.type, query?.id, query?.season, query?.episode, titleOverride, preferencesKey]);

  return { streams, loading, error };
}
