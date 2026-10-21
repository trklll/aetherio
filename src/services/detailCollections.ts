import { tmdbFetch } from "../config/apiKeys.ts";
import { fetchTmdbArtwork } from "./tmdbArtworkService.ts";
import { tmdbImage as tmdbImageUrl } from "../utils/tmdbArtwork.ts";

const IMG = "https://image.tmdb.org/t/p";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

export interface DetailCollectionItem {
  id: string;
  title: string;
  type: "movie" | "series";
  description?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  year?: string;
}

export interface DetailCollectionResult {
  name: string;
  items: DetailCollectionItem[];
}

interface CollectionRequest {
  mediaId: string;
  mediaType: string;
  tmdbId: number;
  title: string;
  tmdbData: any;
}

const wikidataSeriesCache = new Map<number, DetailCollectionResult | null>();

async function fetchJson(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function yearFrom(value: unknown) {
  const year = String(value ?? "").slice(0, 4);
  return /^\d{4}$/.test(year) ? year : undefined;
}

async function fetchArtwork(type: string, id: number) {
  const tmdbMediaType = type === "movie" ? "movie" : "tv";
  const artwork = await fetchTmdbArtwork(tmdbMediaType, id);
  return {
    poster: artwork ? tmdbImageUrl(artwork.posterPath, "w342") : undefined,
    backdrop: artwork ? tmdbImageUrl(artwork.backdropPath, "original") : undefined,
    logo: artwork ? tmdbImageUrl(artwork.logoPath, "w500") : undefined,
    title: artwork?.title,
    description: artwork?.description,
    year: artwork?.year,
  };
}

async function fetchMovieCollection(request: CollectionRequest): Promise<DetailCollectionResult | null> {
  const collection = request.tmdbData?.belongs_to_collection;
  if (request.mediaType !== "movie" || !collection?.id) return null;
  const payload = await tmdbFetch<any>(`/collection/${collection.id}`, { params: { language: "es-ES" } });
  const parts = (payload?.parts ?? []).filter((item: any) => Number(item.id) !== request.tmdbId);
  const items = await Promise.all(parts.map(async (item: any): Promise<DetailCollectionItem> => {
    const artwork = await fetchArtwork("movie", Number(item.id));
    return {
      id: `tmdb:${item.id}`,
      title: item.title ?? item.original_title ?? "",
      type: "movie",
      description: item.overview,
      poster: artwork.poster ?? (item.poster_path ? `${IMG}/w342${item.poster_path}` : undefined),
      backdrop: artwork.backdrop ?? (item.backdrop_path ? `${IMG}/original${item.backdrop_path}` : undefined),
      logo: artwork.logo,
      year: yearFrom(item.release_date),
    };
  }));
  return items.length ? { name: collection.name || payload?.name || "Colección", items } : null;
}

function wikidataClaimIds(entity: any, property: string) {
  return (entity?.claims?.[property] ?? [])
    .map((claim: any) => claim?.mainsnak?.datavalue?.value?.id)
    .filter((id: unknown): id is string => typeof id === "string" && /^Q\d+$/.test(id));
}

async function wikidataQuery(query: string) {
  const url = new URL(WIKIDATA_SPARQL);
  url.searchParams.set("format", "json");
  url.searchParams.set("query", query);
  const payload = await fetchJson(url.toString(), {
    headers: { Accept: "application/sparql-results+json" },
  });
  return Array.isArray(payload?.results?.bindings) ? payload.results.bindings : [];
}

async function fetchWikidataSeriesCollection(request: CollectionRequest): Promise<DetailCollectionResult | null> {
  if (request.mediaType === "movie") return null;
  if (wikidataSeriesCache.has(request.tmdbId)) return wikidataSeriesCache.get(request.tmdbId) ?? null;

  const entityBindings = await wikidataQuery(
    `SELECT ?entity WHERE { ?entity wdt:P4983 "${request.tmdbId}". } LIMIT 1`,
  );
  const entityUrl = entityBindings[0]?.entity?.value;
  const entityId = typeof entityUrl === "string" ? entityUrl.split("/").pop() : "";
  if (!entityId || !/^Q\d+$/.test(entityId)) {
    wikidataSeriesCache.set(request.tmdbId, null);
    return null;
  }

  const entityPayload = await fetchJson(`https://www.wikidata.org/wiki/Special:EntityData/${entityId}.json`);
  const entity = entityPayload?.entities?.[entityId];
  const parentIds = Array.from(new Set([
    ...wikidataClaimIds(entity, "P179"),
    ...wikidataClaimIds(entity, "P361"),
    ...wikidataClaimIds(entity, "P1080"),
  ])).slice(0, 8);
  const directIds = Array.from(new Set([
    ...wikidataClaimIds(entity, "P155"),
    ...wikidataClaimIds(entity, "P156"),
  ])).slice(0, 12);
  if (!parentIds.length && !directIds.length) {
    wikidataSeriesCache.set(request.tmdbId, null);
    return null;
  }

  const parentValues = parentIds.map(id => `wd:${id}`).join(" ");
  const directValues = directIds.map(id => `wd:${id}`).join(" ");
  const branches = [
    parentIds.length
      ? `{ VALUES ?parent { ${parentValues} } VALUES ?relation { wdt:P179 wdt:P361 wdt:P1080 } { ?entity ?relation ?parent. } UNION { ?parent wdt:P527 ?entity. } }`
      : "",
    directIds.length ? `{ VALUES ?entity { ${directValues} } }` : "",
  ].filter(Boolean).join(" UNION ");
  const relatedBindings = await wikidataQuery(
    `SELECT DISTINCT ?tmdbId WHERE { ${branches} ?entity wdt:P4983 ?tmdbId. FILTER(?tmdbId != "${request.tmdbId}") } LIMIT 20`,
  );
  const tmdbIds: number[] = Array.from(new Set<number>(relatedBindings
    .map((binding: any) => Number(binding?.tmdbId?.value))
    .filter((id: number) => Number.isFinite(id) && id > 0))).slice(0, 10);
  if (!tmdbIds.length) {
    wikidataSeriesCache.set(request.tmdbId, null);
    return null;
  }

  const items = await Promise.all(tmdbIds.map(async (tmdbId): Promise<DetailCollectionItem> => {
    const artwork = await fetchArtwork("series", tmdbId);
    return {
      id: `tmdb:${tmdbId}`,
      title: artwork.title ?? "",
      type: "series",
      description: artwork.description,
      poster: artwork.poster,
      backdrop: artwork.backdrop,
      logo: artwork.logo,
      year: artwork.year,
    };
  }));
  const result = { name: "Colección", items: items.filter(item => item.title) };
  wikidataSeriesCache.set(request.tmdbId, result.items.length ? result : null);
  return result.items.length ? result : null;
}

function isAnimeRequest(request: CollectionRequest) {
  const genres = Array.isArray(request.tmdbData?.genres) ? request.tmdbData.genres : [];
  return request.mediaType === "anime"
    || request.mediaId.startsWith("mal:")
    || genres.some((genre: any) => String(genre?.name ?? "").toLowerCase() === "anime")
    || (request.tmdbData?.original_language === "ja"
      && genres.some((genre: any) => Number(genre?.id) === 16));
}

export async function fetchDetailCollection(request: CollectionRequest): Promise<DetailCollectionResult | null> {
  if (isAnimeRequest(request)) return null;
  if (request.mediaType === "movie") return fetchMovieCollection(request);
  return fetchWikidataSeriesCollection(request);
}
