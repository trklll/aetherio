import { afterEach, expect, it, vi } from "vitest";
import { getInstalledMediaExtensionManifestUrls } from "./mediaExtensionService.ts";
import { GLOBAL_CLOUDSTREAM_REPOSITORY_URLS } from "./cloudstreamRepositoryService.ts";
import { getScraperSites, scrapeStreams } from "./scraperService.ts";
import { PROVIDER_HUB_MANIFEST_URL } from "./providerHubConfig.ts";

afterEach(() => vi.unstubAllGlobals());

it("ships no hardcoded media extensions or CloudStream repositories", () => {
  expect(getInstalledMediaExtensionManifestUrls()).toEqual([]);
  expect(GLOBAL_CLOUDSTREAM_REPOSITORY_URLS).toEqual([]);
});

it("exposes and invokes the restored local scraper inventory", async () => {
  const sites = ["animeav1", "cineby", "rive", "flixer", "miruro", "kickassanime", "animetsu", "okru"]
    .map(id => ({ id, name: id }));
  const streams = [{ id: "local-stream", url: "https://media.example/video.m3u8" }];
  const invoke = vi.fn(async (command: string) => command === "get_scraper_sites" ? sites : streams);
  vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
  expect(await getScraperSites()).toEqual(sites);
  expect(await scrapeStreams("test", "movie")).toEqual(streams);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(invoke).toHaveBeenNthCalledWith(1, "get_scraper_sites", {}, undefined);
  expect(invoke).toHaveBeenNthCalledWith(2, "scrape_streams", {
    query: "test", mediaType: "movie", externalId: null, season: null, episode: null, sites: null,
  }, undefined);
});

it("loads only the Hub plus explicitly user-added JS repositories on port 1420", async () => {
  const personal = "https://personal.example/manifest.json";
  vi.stubGlobal("localStorage", { getItem: (key: string) => key === "aetherio-custom-provider-repositories" ? JSON.stringify([personal]) : null });
  const fetcher = vi.fn(async (url: string) => Response.json({
    name: url === personal ? "User repository" : "Provider Hub", version: "1.0.0", scrapers: [],
  }));
  vi.stubGlobal("fetch", fetcher);
  const { refreshProviderRuntimeRepositories } = await import("./providerRuntimeService.ts");
  const inventory = await refreshProviderRuntimeRepositories();
  expect(inventory.every(repository => !repository.error)).toBe(true);
  expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([PROVIDER_HUB_MANIFEST_URL, personal].sort());
  expect(inventory.flatMap(repository => repository.scrapers)).toEqual([]);
});
