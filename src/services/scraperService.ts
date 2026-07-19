import { invokeCommand, isTauriRuntime } from "../runtime/platform";

export interface ScrapedStream {
  id: string;
  url: string;
  name: string;
  title?: string;
  quality?: string;
  languages?: string[];
  siteId: string;
  siteName: string;
  embedUrl?: string;
  headers?: Record<string, string>;
  subtitles?: Array<{
    id?: string;
    url: string;
    lang?: string;
    language?: string;
    title?: string;
  }>;
}

export interface ScraperSiteInfo {
  id: string;
  name: string;
  baseUrl: string;
  category: string;
  types: string[];
  enabledByDefault: boolean;
}

export async function scrapeStreams(
  query: string,
  mediaType: string,
  externalId?: string,
  season?: number,
  episode?: number,
  siteIds?: string[]
): Promise<ScrapedStream[]> {
  if (!query.trim()) return [];
  if (!isTauriRuntime()) return [];
  return invokeCommand<ScrapedStream[]>("scrape_streams", {
    query,
    mediaType,
    externalId: externalId ?? null,
    season: season ?? null,
    episode: episode ?? null,
    sites: siteIds ?? null,
  });
}

export async function getScraperSites(): Promise<ScraperSiteInfo[]> {
  if (!isTauriRuntime()) return [];
  return invokeCommand<ScraperSiteInfo[]>("get_scraper_sites");
}
