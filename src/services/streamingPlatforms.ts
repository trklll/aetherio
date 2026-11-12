import { tmdbFetch } from "../config/apiKeys";
import type { CatalogRowData } from "../types/ui";
import { mapMovieSeriesGenreItem } from "./movieSeriesGenres";

export const STREAMING_PLATFORMS = [
  {
    id: "netflix",
    name: "Netflix",
    description: "Disfruta de series, películas, documentales y producciones originales de todo el mundo, con historias para todos los gustos.",
    cardImage: "/assets/streaming-platforms/netflix-card.png",
    logoImage: "/assets/streaming-platforms/netflix-logo-sidebar.png",
    intro: "/assets/streaming-platforms/netflix-intro.mp4",
    accent: "#e50914",
    titleImage: "/assets/streaming-platforms/Netflix_titlel.png",
    providerIds: "8",
  },
  {
    id: "hbo-max",
    name: "HBO Max",
    description: "Explora grandes historias, series originales, películas exitosas y contenido exclusivo de HBO, Warner Bros. y DC.",
    cardImage: "/assets/streaming-platforms/max-card.png",
    logoImage: "/assets/streaming-platforms/hbomax-logo-sidebar.png",
    intro: "/assets/streaming-platforms/hbomax_intro.mp4",
    accent: "#7138ff",
    titleImage: "/assets/streaming-platforms/hbomax_title.svg",
    providerIds: "1899|384",
  },
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    description: "Sumérgete en el mundo del anime con miles de episodios, películas y nuevos estrenos directamente desde Japón.",
    cardImage: "/assets/streaming-platforms/crunchyroll-card.png",
    logoImage: "/assets/streaming-platforms/crunchyroll-logo-sidebar.png",
    intro: "/assets/streaming-platforms/crunchyroll-intro.mp4",
    accent: "#f47521",
    titleImage: "/assets/streaming-platforms/Crunchyroll-title.png",
    providerIds: "283",
  },
  {
    id: "prime-video",
    name: "Prime Video",
    description: "Disfruta de películas, series y producciones originales de Prime Video, con estrenos para todos los gustos.",
    cardImage: "/assets/streaming-platforms/prime-video-card.png",
    logoImage: "/assets/streaming-platforms/prime-video-logo-sidebar.png",
    intro: "/assets/streaming-platforms/prime-video-intro.mp4",
    accent: "#00a8e0",
    titleImage: "/assets/streaming-platforms/primevideo-title.png",
    providerIds: "9",
  },
  {
    id: "apple-tv-plus",
    name: "Apple TV+",
    description: "Disfruta de series y películas originales exclusivas, con historias innovadoras, producciones galardonadas y nuevos estrenos cada semana.",
    cardImage: "/assets/streaming-platforms/apple-tv-plus-card.jpg",
    logoImage: "/assets/streaming-platforms/apple-tv-logo-sidebar.png",
    intro: "/assets/streaming-platforms/apple-tv-plus-intro.mp4",
    accent: "#d0d1d4",
    titleImage: "/assets/streaming-platforms/appletv_title.png",
    providerIds: "350",
  },
  {
    id: "mubi",
    name: "MUBI",
    description: "Descubre una selección cuidadosamente elegida de cine independiente, clásicos, películas de autor y obras premiadas de todo el mundo.",
    cardImage: "/assets/streaming-platforms/mubi-card.png",
    logoImage: "/assets/streaming-platforms/mubi-logo-sidebar.png",
    intro: "/assets/streaming-platforms/mubi-intro.mp4",
    accent: "#1024a0",
    titleImage: "/assets/streaming-platforms/mubi_title.png",
    providerIds: "11",
  },
  {
    id: "disney-plus",
    name: "Disney+",
    description: "Descubre la magia de Disney, Pixar, Marvel, Star Wars y National Geographic, con clásicos inolvidables y producciones exclusivas.",
    cardImage: "/assets/streaming-platforms/disney-plus-card.jpg",
    logoImage: "/assets/streaming-platforms/disney-logo-sidebar.png",
    intro: "/assets/streaming-platforms/disney-plus-intro.mp4",
    accent: "#1176ce",
    titleImage: "/assets/streaming-platforms/disney-plus-logo.svg",
    providerIds: "337",
  },
] as const;

export type StreamingPlatform = (typeof STREAMING_PLATFORMS)[number];
export type StreamingPlatformId = StreamingPlatform["id"];

type PlatformMediaType = "movie" | "series";
type PlatformRailKind = "popular" | "top-rated";

interface TmdbPlatformResult {
  id?: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  original_language?: string;
}

interface TmdbPlatformPage {
  results?: TmdbPlatformResult[];
  total_pages?: number;
}

interface TmdbWatchProvider {
  provider_id?: number;
  display_priorities?: Record<string, number>;
}

interface TmdbWatchProvidersPage {
  results?: TmdbWatchProvider[];
}

const WATCH_REGIONS = ["PE", "US"] as const;
const PLATFORM_RAIL_ITEM_LIMIT = 20;
const STREAMING_TRENDING_CONCURRENCY = 8;
const CRUNCHYROLL_RAIL_ITEM_LIMIT = 200;
const CRUNCHYROLL_MAX_PAGES_PER_REGION = 10;
const PLATFORM_COLLECTION_SOURCE_LIMIT = 40;
const PLATFORM_COLLECTION_CANDIDATE_LIMIT = 24;
const PLATFORM_COLLECTION_LIMIT = 10;

export interface StreamingTrendingGenre {
  key: string;
  label: string;
  movieGenreIds: readonly number[];
  seriesGenreIds: readonly number[];
}

/** One genre bar mapped to the separate TMDB movie and TV taxonomies. */
export const STREAMING_TRENDING_GENRES = [
  { key: "action-adventure", label: "Acción y aventura", movieGenreIds: [28, 12], seriesGenreIds: [10759] },
  { key: "animation", label: "Animación", movieGenreIds: [16], seriesGenreIds: [16] },
  { key: "comedy", label: "Comedia", movieGenreIds: [35], seriesGenreIds: [35] },
  { key: "crime", label: "Crimen", movieGenreIds: [80], seriesGenreIds: [80] },
  { key: "documentary", label: "Documental", movieGenreIds: [99], seriesGenreIds: [99] },
  { key: "drama", label: "Drama", movieGenreIds: [18], seriesGenreIds: [18] },
  { key: "family", label: "Familia", movieGenreIds: [10751], seriesGenreIds: [10751] },
  { key: "fantasy-sci-fi", label: "Ciencia ficción y fantasía", movieGenreIds: [878, 14], seriesGenreIds: [10765] },
  { key: "history", label: "Historia", movieGenreIds: [36], seriesGenreIds: [] },
  { key: "horror", label: "Terror", movieGenreIds: [27], seriesGenreIds: [] },
  { key: "kids", label: "Infantil", movieGenreIds: [], seriesGenreIds: [10762] },
  { key: "music", label: "Música", movieGenreIds: [10402], seriesGenreIds: [] },
  { key: "mystery", label: "Misterio", movieGenreIds: [9648], seriesGenreIds: [9648] },
  { key: "news", label: "Noticias", movieGenreIds: [], seriesGenreIds: [10763] },
  { key: "reality", label: "Reality", movieGenreIds: [], seriesGenreIds: [10764] },
  { key: "romance", label: "Romance", movieGenreIds: [10749], seriesGenreIds: [] },
  { key: "soap", label: "Telenovela", movieGenreIds: [], seriesGenreIds: [10766] },
  { key: "talk", label: "Talk show", movieGenreIds: [], seriesGenreIds: [10767] },
  { key: "thriller", label: "Suspense", movieGenreIds: [53], seriesGenreIds: [] },
  { key: "tv-movie", label: "Película de TV", movieGenreIds: [10770], seriesGenreIds: [] },
  { key: "war-politics", label: "Guerra y política", movieGenreIds: [10752], seriesGenreIds: [10768] },
  { key: "western", label: "Western", movieGenreIds: [37], seriesGenreIds: [37] },
] as const satisfies readonly StreamingTrendingGenre[];

/** Shared cross-media categories used to keep MUBI's genre bar unified. */
export const MUBI_TRENDING_CATEGORIES = STREAMING_TRENDING_GENRES;

/** Apple TV uses the same cross-media genre taxonomy as other platforms. */
export const APPLE_TV_TRENDING_GENRES = STREAMING_TRENDING_GENRES;

export interface StreamingPlatformCollection {
  id: number;
  name: string;
  poster?: string;
  background?: string;
  itemCount: number;
}

export interface StreamingPlatformCatalogRequest {
  path: string;
  type: "movie" | "series";
  variants: Array<{ params: Record<string, string> }>;
}

export function getStreamingPlatform(id: string | undefined): StreamingPlatform | undefined {
  return STREAMING_PLATFORMS.find(platform => platform.id === id);
}

export function getStreamingPlatformPath(platformId: string, bigPicture = false): string {
  const encodedId = encodeURIComponent(platformId);
  return bigPicture
    ? `/big-picture/platform/${encodedId}`
    : `/platform/${encodedId}`;
}

/** Resolve the TMDB query represented by one of this page's rows. */
export function getStreamingPlatformCatalogRequest(catalogId: string): StreamingPlatformCatalogRequest | null {
  const match = catalogId.match(/^streaming\.([a-z0-9-]+)\.(movie|series|anime)\.(popular|top-rated|top-10)$/);
  if (!match) return null;

  const [, platformId, rowType, kind] = match;
  const platform = getStreamingPlatform(platformId);
  if (!platform || (rowType === "anime" && kind !== "top-10")) return null;

  const type = rowType === "movie" ? "movie" : "series";
  const path = type === "movie" ? "/discover/movie" : "/discover/tv";
  const isAnime = rowType === "anime";
  const isTopRated = kind !== "popular";
  const variants = WATCH_REGIONS.map(region => ({
    params: {
      language: "es-ES",
      include_adult: "false",
      sort_by: isTopRated ? "vote_average.desc" : "popularity.desc",
      ...(isTopRated ? { "vote_count.gte": isAnime ? "100" : type === "movie" ? "100" : "50" } : {}),
      ...(isAnime ? { with_genres: "16", with_original_language: "ja" } : {}),
      region,
      watch_region: region,
      with_watch_monetization_types: "flatrate",
      with_watch_providers: platform.providerIds,
    },
  }));

  return { path, type, variants };
}

async function fetchPlatformRail(
  platform: StreamingPlatform,
  type: PlatformMediaType,
  kind: PlatformRailKind,
): Promise<CatalogRowData | null> {
  const isMovie = type === "movie";
  const isTopRated = kind === "top-rated";
  const path = isMovie ? "/discover/movie" : "/discover/tv";
  const name = isMovie
    ? isTopRated ? "Películas mejor valoradas" : "Películas populares"
    : isTopRated ? "Series mejor valoradas" : "Series populares";
  const catalogId = `streaming.${platform.id}.${type}.${kind}`;

  if (platform.id === "crunchyroll") {
    const regionResults: TmdbPlatformResult[] = [];
    for (const region of WATCH_REGIONS) {
      const params = {
        language: "es-ES",
        include_adult: "false",
        sort_by: isTopRated ? "vote_average.desc" : "popularity.desc",
        ...(isTopRated ? { "vote_count.gte": isMovie ? "100" : "50" } : {}),
        region,
        watch_region: region,
        with_watch_monetization_types: "flatrate",
        with_watch_providers: platform.providerIds,
      };

      let firstPage: TmdbPlatformPage | null;
      try {
        firstPage = await tmdbFetch<TmdbPlatformPage>(path, {
          params: { ...params, page: "1" },
        });
      } catch {
        // Un error regional no debe impedir cargar el catálogo de la otra región.
        continue;
      }
      const firstResults = firstPage?.results ?? [];
      regionResults.push(...firstResults);
      if (!firstResults.length) continue;

      const reportedPageCount = Math.trunc(Number(firstPage?.total_pages));
      const pageCount = Number.isFinite(reportedPageCount) && reportedPageCount > 0
        ? Math.min(reportedPageCount, CRUNCHYROLL_MAX_PAGES_PER_REGION)
        : 1;
      for (let page = 2; page <= pageCount; page += 1) {
        try {
          const nextPage = await tmdbFetch<TmdbPlatformPage>(path, {
            params: { ...params, page: String(page) },
          });
          regionResults.push(...(nextPage?.results ?? []));
        } catch {
          // Conserva las páginas que ya llegaron y aún intenta la otra región.
          break;
        }
      }
    }

    const seen = new Set<string>();
    const orderedResults = isTopRated
      ? [...regionResults].sort((a, b) => Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0))
      : regionResults;
    const items = orderedResults
      .map(item => mapMovieSeriesGenreItem(item, type, true))
      .filter((item): item is NonNullable<typeof item> => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, CRUNCHYROLL_RAIL_ITEM_LIMIT);
    if (!items.length) return null;

    return {
      addonId: "tmdb",
      addonName: platform.name,
      catalogId,
      type,
      name,
      subtitle: platform.name,
      items,
    };
  }

  for (const region of WATCH_REGIONS) {
    try {
      const page = await tmdbFetch<TmdbPlatformPage>(path, {
        params: {
          language: "es-ES",
          page: "1",
          include_adult: "false",
          sort_by: isTopRated ? "vote_average.desc" : "popularity.desc",
          ...(isTopRated ? { "vote_count.gte": isMovie ? "100" : "50" } : {}),
          region,
          watch_region: region,
          with_watch_monetization_types: "flatrate",
          with_watch_providers: platform.providerIds,
        },
      });
      const seen = new Set<string>();
      const results = [...(page?.results ?? [])];
      if (isTopRated) results.sort((a, b) => Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0));
      const items = results
        .map(item => mapMovieSeriesGenreItem(item, type))
        .filter((item): item is NonNullable<typeof item> => {
          if (!item || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .slice(0, PLATFORM_RAIL_ITEM_LIMIT);
      if (!items.length) continue;

      return {
        addonId: "tmdb",
        addonName: platform.name,
        catalogId,
        type,
        name,
        subtitle: platform.name,
        items,
      };
    } catch {
      // Si falla la región primaria, se intenta la alternativa en el siguiente ciclo.
    }
  }

  return null;
}

async function fetchPlatformAnimeTopTen(platform: StreamingPlatform): Promise<CatalogRowData | null> {
  for (const region of WATCH_REGIONS) {
    try {
      const page = await tmdbFetch<TmdbPlatformPage>("/discover/tv", {
        params: {
          language: "es-ES",
          page: "1",
          include_adult: "false",
          sort_by: "vote_average.desc",
          "vote_count.gte": "100",
          with_genres: "16",
          with_original_language: "ja",
          region,
          watch_region: region,
          with_watch_monetization_types: "flatrate",
          with_watch_providers: platform.providerIds,
        },
      });
      const items = (page?.results ?? [])
        .filter(item => Number(item.vote_average) > 0 && item.genre_ids?.includes(16) && item.original_language?.toLowerCase() === "ja")
        .sort((a, b) => Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0))
        .map(item => mapMovieSeriesGenreItem(item, "series", true))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .slice(0, 10);
      if (!items.length) continue;

      return {
        addonId: "tmdb",
        addonName: platform.name,
        catalogId: `streaming.${platform.id}.anime.top-10`,
        type: "series",
        name: "Top 10 Anime",
        subtitle: platform.name,
        items,
      };
    } catch {
      // Si falla la región primaria, se intenta la alternativa.
    }
  }
  return null;
}

interface TrendingMediaSource {
  type: "movie" | "series";
  tmdbType: "movie" | "tv";
}

const TRENDING_MEDIA_SOURCES: readonly TrendingMediaSource[] = [
  { type: "movie", tmdbType: "movie" },
  { type: "series", tmdbType: "tv" },
];

async function fetchStreamingTrendingRows(
  platformId: string,
  platformName: string,
  providerIds: readonly number[],
  genres: readonly StreamingTrendingGenre[],
  genreKey?: string,
): Promise<CatalogRowData[]> {
  const selectedGenre = genreKey ? genres.find(genre => genre.key === genreKey) : undefined;
  if (genreKey && !selectedGenre) {
    throw new Error(`Género no reconocido para ${platformName}: ${genreKey}`);
  }

  let providerLookupAttempts = 0;
  let providerLookupErrors = 0;
  const mediaResults = await Promise.all(TRENDING_MEDIA_SOURCES.map(async source => {
    const genreIds = selectedGenre
      ? selectedGenre[source.type === "movie" ? "movieGenreIds" : "seriesGenreIds"]
      : [...new Set(genres.flatMap(genre => genre[source.type === "movie" ? "movieGenreIds" : "seriesGenreIds"]))];
    if (!genreIds.length) return { source, results: [] as TmdbPlatformResult[] };

    providerLookupAttempts += 1;
    let providers: TmdbWatchProvidersPage | null;
    try {
      providers = await tmdbFetch<TmdbWatchProvidersPage>(`/watch/providers/${source.tmdbType}`, {
        params: { language: "en-US" },
      });
    } catch {
      providerLookupErrors += 1;
      return { source, results: [] as TmdbPlatformResult[] };
    }

    const regions = [...new Set(providerIds.flatMap(providerId => {
      const provider = providers?.results?.find(candidate => candidate.provider_id === providerId);
      return Object.keys(provider?.display_priorities ?? {}).filter(region => /^[A-Z]{2}$/.test(region));
    }))].sort();
    const regionalResults = await mapConcurrent(regions, STREAMING_TRENDING_CONCURRENCY, async region => {
      try {
        const page = await tmdbFetch<TmdbPlatformPage>(`/discover/${source.tmdbType}`, {
          params: {
            language: "es-ES",
            page: "1",
            include_adult: "false",
            sort_by: "popularity.desc",
            with_genres: genreIds.join("|"),
            watch_region: region,
            with_watch_monetization_types: "flatrate",
            with_watch_providers: providerIds.join("|"),
          },
        });
        return page?.results ?? [];
      } catch {
        // Una región temporalmente inaccesible no cancela el catálogo global.
        return [];
      }
    });

    const uniqueResults = new Map<number, TmdbPlatformResult>();
    for (const result of regionalResults.flat()) {
      if (Number.isInteger(result.id) && !uniqueResults.has(result.id!)) {
        uniqueResults.set(result.id!, result);
      }
    }

    return {
      source,
      results: [...uniqueResults.values()].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)),
    };
  }));

  if (providerLookupAttempts > 0 && providerLookupErrors === providerLookupAttempts) {
    throw new Error(`No se pudo consultar la disponibilidad global de ${platformName} en TMDB.`);
  }

  const visibleGenres = selectedGenre ? [selectedGenre] : genres;
  const rows: CatalogRowData[] = [];
  for (const { source, results } of mediaResults) {
    const typeGenreIds = (genre: StreamingTrendingGenre) =>
      genre[source.type === "movie" ? "movieGenreIds" : "seriesGenreIds"];
    const createRow = (key: string, name: string, candidates: TmdbPlatformResult[]): CatalogRowData => {
      const seen = new Set<string>();
      const items = candidates
        .map(result => mapMovieSeriesGenreItem(result, source.type))
        .filter((item): item is NonNullable<typeof item> => {
          if (!item || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .slice(0, PLATFORM_RAIL_ITEM_LIMIT);

      return {
        addonId: "tmdb",
        addonName: platformName,
        catalogId: `streaming.${platformId}.${source.type}.genre.${key}`,
        type: source.type,
        name,
        subtitle: platformName,
        items,
      };
    };

    if (!selectedGenre) {
      rows.push(createRow("all", source.type === "movie" ? "Películas" : "Series", results));
    }

    for (const genre of visibleGenres) {
      const genreIds = typeGenreIds(genre);
      const candidates = results.filter(result => result.genre_ids?.some(id => genreIds.includes(id)));
      rows.push(createRow(genre.key, source.type === "movie" ? "Películas" : "Series", candidates));
    }
  }

  return rows;
}

/** Fetches any configured platform's movies and series from every TMDB provider region. */
export function fetchStreamingPlatformTrendingRows(platformId: string, genreKey?: string): Promise<CatalogRowData[]> {
  const platform = getStreamingPlatform(platformId);
  if (!platform) return Promise.resolve([]);

  const providerIds = platform.providerIds.split("|")
    .map(value => Number(value.trim()))
    .filter(providerId => Number.isInteger(providerId) && providerId > 0);
  if (!providerIds.length) return Promise.resolve([]);

  return fetchStreamingTrendingRows(platform.id, platform.name, providerIds, STREAMING_TRENDING_GENRES, genreKey);
}

/** Fetches MUBI movies and series globally, preserving a genre row for each type. */
export function fetchMubiTrendingRows(genreKey?: string): Promise<CatalogRowData[]> {
  return fetchStreamingPlatformTrendingRows("mubi", genreKey);
}

/** Fetches Apple TV movies and series globally, preserving a genre row for each type. */
export function fetchAppleTvTrendingRows(genreKey?: string): Promise<CatalogRowData[]> {
  return fetchStreamingPlatformTrendingRows("apple-tv-plus", genreKey);
}

export async function fetchStreamingPlatformCollections(
  platformId: string,
  movies: CatalogRowData["items"],
): Promise<StreamingPlatformCollection[]> {
  if (!getStreamingPlatform(platformId)) return [];

  const movieIds = [...new Set(movies
    .slice(0, PLATFORM_COLLECTION_SOURCE_LIMIT)
    .map(item => item.id.match(/^tmdb:(\d+)$/)?.[1])
    .filter((id): id is string => Boolean(id)))];
  if (!movieIds.length) return [];

  const collectionCandidates = await Promise.all(movieIds.map(async movieId => {
    try {
      const detail = await tmdbFetch<{ belongs_to_collection?: { id?: number; name?: string } | null }>(`/movie/${movieId}`, {
        params: { language: "es-ES" },
      });
      const collection = detail?.belongs_to_collection;
      return collection?.id && collection.name ? { id: collection.id, name: collection.name } : null;
    } catch {
      return null;
    }
  }));

  const uniqueCollections = new Map<number, string>();
  for (const collection of collectionCandidates) {
    if (collection && !uniqueCollections.has(collection.id)) uniqueCollections.set(collection.id, collection.name);
  }

  const collectionIds = Array.from(uniqueCollections.keys()).slice(0, PLATFORM_COLLECTION_CANDIDATE_LIMIT);
  const collections = await Promise.all(collectionIds.map(async id => {
    try {
      const data = await tmdbFetch<{
        name?: string;
        poster_path?: string | null;
        backdrop_path?: string | null;
        parts?: Array<{
          id?: number;
          title?: string;
          release_date?: string;
        }>;
      }>(`/collection/${id}`, { params: { language: "es-ES" } });
      // TMDB also groups shorts, OVAs and assorted specials into anime-themed
      // collections. Only surface a saga when it contains multiple released
      // feature films, not merely several entries under a franchise name.
      const featureCandidates = (data?.parts ?? []).filter(part =>
        Number.isInteger(part.id) &&
        typeof part.title === "string" && part.title.trim().length > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(part.release_date ?? ""),
      ).slice(0, 12);
      const runtimes = await Promise.all(featureCandidates.map(async part => {
        try {
          const movie = await tmdbFetch<{ runtime?: number }>(`/movie/${part.id}`, {
            params: { language: "es-ES" },
          });
          return Number(movie?.runtime) || 0;
        } catch {
          return 0;
        }
      }));
      const itemCount = runtimes.filter(runtime => runtime >= 60).length;
      const collectionName = data?.name || uniqueCollections.get(id) || `Colección ${id}`;
      // TMDB sometimes labels broad anime franchise groupings as a “Series”;
      // those are not film collections even when they contain movie entries.
      if (/\bseries\b|シリーズ/i.test(collectionName)) return null;
      if (itemCount < 2) return null;
      return {
        id,
        name: collectionName,
        poster: data?.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        background: data?.backdrop_path ? `https://image.tmdb.org/t/p/original${data.backdrop_path}` : undefined,
        itemCount,
      } satisfies StreamingPlatformCollection;
    } catch {
      return null;
    }
  }));

  return collections
    .filter((collection): collection is NonNullable<typeof collection> => collection !== null)
    .slice(0, PLATFORM_COLLECTION_LIMIT);
}

export async function fetchStreamingPlatformRows(platformId: string): Promise<CatalogRowData[]> {
  const platform = getStreamingPlatform(platformId);
  if (!platform) return [];

  const [popularMovies, topRatedMovies, popularSeries, topRatedSeries, animeTopTen] = await Promise.all([
    fetchPlatformRail(platform, "movie", "popular"),
    fetchPlatformRail(platform, "movie", "top-rated"),
    fetchPlatformRail(platform, "series", "popular"),
    fetchPlatformRail(platform, "series", "top-rated"),
    fetchPlatformAnimeTopTen(platform),
  ]);

  const topTenMovies = topRatedMovies?.items.length
    ? {
      ...topRatedMovies,
      catalogId: `streaming.${platform.id}.movie.top-10`,
      name: "Top 10 Películas",
      items: topRatedMovies.items.slice(0, 10),
    }
    : null;

  // Coloca el Top 10 de películas tras dos filas editoriales, y el anime por
  // puntuación antes de todo el catálogo cuando TMDB devuelve resultados.
  return [animeTopTen, popularMovies, popularSeries, topTenMovies, topRatedSeries]
    .filter((row): row is CatalogRowData => Boolean(row));
}

async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }));

  return results;
}
