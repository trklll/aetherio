import { tmdbFetch } from "../config/apiKeys";

const IMG = "https://image.tmdb.org/t/p";
const JIKAN = "https://api.jikan.moe/v4";
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

const malFranchiseCache = new Map<string, DetailCollectionItem[]>();
const wikidataSeriesCache = new Map<number, DetailCollectionResult | null>();
const malToTmdbCache = new Map<string, { id: number; type: "movie" | "series" }>();

async function fetchJson(url: string, init?: RequestInit) {
  try {
    const response = await fetch(url, init);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function tmdbType(type: string) {
  return type === "movie" ? "movie" : "tv";
}

function yearFrom(value: unknown) {
  const year = String(value ?? "").slice(0, 4);
  return /^\d{4}$/.test(year) ? year : undefined;
}

async function fetchTmdbArtwork(type: string, id: number) {
  const tmdbMediaType = type === "movie" ? "movie" : "tv";
  let endpoint = `/${tmdbMediaType}/${id}`;
  let [detail, images] = await Promise.all([
    tmdbFetch<any>(endpoint, { params: { language: "es-ES" } }),
    tmdbFetch<any>(`${endpoint}/images`, { params: { include_image_language: "es,en,null" } }),
  ]);
  if (!detail && tmdbMediaType === "tv") {
    endpoint = `/movie/${id}`;
    [detail, images] = await Promise.all([
      tmdbFetch<any>(endpoint, { params: { language: "es-ES" } }),
      tmdbFetch<any>(`${endpoint}/images`, { params: { include_image_language: "es,en,null" } }),
    ]);
  }
  const logos = images?.logos ?? [];
  const logo = logos.find((item: any) => item.iso_639_1 === "es")
    ?? logos.find((item: any) => item.iso_639_1 === "en")
    ?? logos.find((item: any) => item.iso_639_1 == null)
    ?? logos[0];
  return {
    poster: detail?.poster_path ? `${IMG}/w342${detail.poster_path}` : undefined,
    backdrop: detail?.backdrop_path ? `${IMG}/original${detail.backdrop_path}` : undefined,
    logo: logo?.file_path ? `${IMG}/w500${logo.file_path}` : undefined,
    title: detail?.name ?? detail?.title,
    description: detail?.overview,
    year: yearFrom(detail?.first_air_date ?? detail?.release_date),
  };
}

async function fetchMovieCollection(request: CollectionRequest): Promise<DetailCollectionResult | null> {
  const collection = request.tmdbData?.belongs_to_collection;
  if (request.mediaType !== "movie" || !collection?.id) return null;
  const payload = await tmdbFetch<any>(`/collection/${collection.id}`, { params: { language: "es-ES" } });
  const parts = (payload?.parts ?? []).filter((item: any) => Number(item.id) !== request.tmdbId);
  const items = await Promise.all(parts.map(async (item: any): Promise<DetailCollectionItem> => {
    const artwork = await fetchTmdbArtwork("movie", Number(item.id));
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
    const artwork = await fetchTmdbArtwork("series", tmdbId);
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

async function fetchJikanAnime(malId: string) {
  const payload = await fetchJson(`${JIKAN}/anime/${encodeURIComponent(malId)}`);
  return payload?.data ?? null;
}

async function searchJikanAnime(title: string) {
  const payload = await fetchJson(`${JIKAN}/anime?q=${encodeURIComponent(title)}&limit=5`);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const normalized = title.trim().toLowerCase();
  const exact = rows.find((item: any) => [item.title_english, item.title]
    .some(value => String(value ?? "").trim().toLowerCase() === normalized));
  const partial = rows.find((item: any) => [item.title_english, item.title]
    .some(value => String(value ?? "").toLowerCase().includes(normalized)));
  return String((exact ?? partial ?? rows[0])?.mal_id ?? "") || null;
}

async function resolveMalToTmdb(malId: string, preferredType: "movie" | "series") {
  const cached = malToTmdbCache.get(malId);
  if (cached) return cached;
  const anime = await fetchJikanAnime(malId);
  const title = anime?.title_english || anime?.title;
  if (!title) return null;
  const inferredType: "movie" | "series" = String(anime.type).toLowerCase() === "movie" ? "movie" : "series";
  const types = Array.from(new Set([preferredType, inferredType]));
  for (const type of types) {
    const result = await tmdbFetch<any>(`/search/${tmdbType(type)}`, { params: { query: title, language: "en-US" } });
    const id = Number(result?.results?.[0]?.id);
    if (id > 0) {
      const resolved = { id, type };
      malToTmdbCache.set(malId, resolved);
      return resolved;
    }
  }
  return null;
}

async function resolveTitleToTmdb(title: string, type: "movie" | "series") {
  const result = await tmdbFetch<any>(`/search/${tmdbType(type)}`, { params: { query: title, language: "en-US" } });
  const id = Number(result?.results?.[0]?.id);
  return id > 0 ? { id, type } : null;
}

async function fetchAniListFranchise(request: CollectionRequest): Promise<DetailCollectionItem[]> {
  const payload = await fetchJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `query ($search: String) {
        Media(search: $search, type: ANIME) {
          relations {
            edges {
              relationType
              node {
                idMal
                format
                seasonYear
                description(asHtml: false)
                title { english romaji }
                coverImage { extraLarge large }
                bannerImage
              }
            }
          }
        }
      }`,
      variables: { search: request.title },
    }),
  });
  const edges = payload?.data?.Media?.relations?.edges ?? [];
  const seen = new Set<string>();
  const items: DetailCollectionItem[] = [];
  for (const edge of edges) {
    if (items.length >= 10) break;
    const node = edge?.node;
    const title = node?.title?.english || node?.title?.romaji;
    if (!title) continue;
    const type: "movie" | "series" = node.format === "MOVIE" ? "movie" : "series";
    const resolved = await resolveTitleToTmdb(title, type);
    if (resolved?.id === request.tmdbId) continue;
    const id = resolved ? `tmdb:${resolved.id}` : node.idMal ? `mal:${node.idMal}` : "";
    const key = `${type}:${id}`;
    if (!id || seen.has(key)) continue;
    seen.add(key);
    const artwork: { poster?: string; backdrop?: string; logo?: string } = resolved
      ? await fetchTmdbArtwork(type, resolved.id)
      : {};
    items.push({
      id,
      title,
      type,
      description: node.description,
      poster: artwork.poster ?? node.coverImage?.extraLarge ?? node.coverImage?.large,
      backdrop: artwork.backdrop ?? node.bannerImage,
      logo: artwork.logo,
      year: yearFrom(node.seasonYear),
    });
  }
  return items;
}

async function fetchAnimeFranchise(request: CollectionRequest): Promise<DetailCollectionResult | null> {
  const isAnime = request.mediaId.startsWith("mal:")
    || (request.tmdbData?.original_language === "ja" && request.tmdbData?.genres?.some((genre: any) => genre.id === 16));
  if (!isAnime) return null;
  const malId = request.mediaId.startsWith("mal:")
    ? request.mediaId.slice(4)
    : await searchJikanAnime(request.title);
  const cacheKey = malId || `title:${request.title.toLowerCase()}`;
  const cached = malFranchiseCache.get(cacheKey);
  if (cached) return cached.length ? { name: "Franquicia", items: cached } : null;
  const payload = malId ? await fetchJson(`${JIKAN}/anime/${encodeURIComponent(malId)}/relations`) : null;
  const relations = (payload?.data ?? []).flatMap((relation: any) => relation.entry ?? []);
  const seen = new Set<string>();
  const items: DetailCollectionItem[] = [];
  for (const relation of relations) {
    if (items.length >= 10) break;
    const relationMalId = String(relation?.mal_id ?? "");
    if (!relationMalId) continue;
    const anime = await fetchJikanAnime(relationMalId);
    const title = anime?.title_english || anime?.title;
    if (!title) continue;
    const type: "movie" | "series" = String(anime.type).toLowerCase() === "movie" ? "movie" : "series";
    const resolved = await resolveMalToTmdb(relationMalId, type);
    const id = resolved ? `tmdb:${resolved.id}` : `mal:${relationMalId}`;
    const key = `${type}:${id}`;
    if (seen.has(key) || (resolved?.id === request.tmdbId)) continue;
    seen.add(key);
    const artwork: { poster?: string; backdrop?: string; logo?: string } = resolved
      ? await fetchTmdbArtwork(resolved.type, resolved.id)
      : {};
    items.push({
      id,
      title,
      type,
      description: anime.synopsis,
      poster: artwork.poster,
      backdrop: artwork.backdrop,
      logo: artwork.logo,
      year: yearFrom(anime.year),
    });
  }
  if (!items.length) items.push(...await fetchAniListFranchise(request));
  malFranchiseCache.set(cacheKey, items);
  return items.length ? { name: "Franquicia", items } : null;
}

export async function fetchDetailCollection(request: CollectionRequest): Promise<DetailCollectionResult | null> {
  const anime = await fetchAnimeFranchise(request);
  if (anime?.items.length) return anime;
  if (request.mediaType === "movie") return fetchMovieCollection(request);
  return fetchWikidataSeriesCollection(request);
}
