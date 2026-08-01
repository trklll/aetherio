import { tmdbFetch } from "../config/apiKeys";
import type { UnifiedSearchResult } from "./searchProviders";

const TMDB_IMAGE = "https://image.tmdb.org/t/p";

type SemanticMediaType = "movie" | "series";
type SemanticSort = "popularity.desc" | "vote_average.desc" | "date.desc";

interface GenreRule {
  key: string;
  aliases: string[];
  movie: number[];
  series: number[];
}

interface AnimeSubgenreRule {
  key: string;
  aliases: string[];
  keywords: string[];
  movie: number[];
  series: number[];
}

interface LanguageRule {
  code: string;
  aliases: string[];
}

export interface SemanticSearchIntent {
  active: boolean;
  mediaTypes: SemanticMediaType[];
  anime: boolean;
  genres: string[];
  animeSubgenres: string[];
  originalLanguage?: string;
  year?: number;
  dateFrom?: string;
  dateTo?: string;
  sort: SemanticSort;
  minimumVotes: number;
  person?: { name: string; role: "cast" | "crew" };
  company?: string;
  signalCount: number;
}

const GENRES: GenreRule[] = [
  { key: "action", aliases: ["accion", "action", "artes marciales", "combate", "peleas"], movie: [28], series: [10759] },
  { key: "adventure", aliases: ["aventura", "aventuras", "adventure", "exploracion"], movie: [12], series: [10759] },
  { key: "animation", aliases: ["animacion", "animation", "animated", "dibujos animados", "caricaturas"], movie: [16], series: [16] },
  { key: "comedy", aliases: ["comedia", "comedias", "comedy", "humor", "divertida", "divertidas", "sitcom"], movie: [35], series: [35] },
  { key: "crime", aliases: ["crimen", "crime", "criminal", "policial", "detectives", "mafia", "gangsters"], movie: [80], series: [80] },
  { key: "documentary", aliases: ["documental", "documentales", "documentary", "docuserie", "docuseries"], movie: [99], series: [99] },
  { key: "drama", aliases: ["drama", "dramatico", "dramatica", "dramaticas"], movie: [18], series: [18] },
  { key: "family", aliases: ["familia", "familiar", "family", "para la familia", "para toda la familia"], movie: [10751], series: [10751] },
  { key: "fantasy", aliases: ["fantasia", "fantasy", "magia", "magica", "magico", "sobrenatural"], movie: [14], series: [10765] },
  { key: "history", aliases: ["historia", "historica", "historico", "history", "de epoca"], movie: [36], series: [] },
  { key: "horror", aliases: ["terror", "horror", "miedo", "sustos"], movie: [27], series: [9648] },
  { key: "kids", aliases: ["infantil", "kids", "children", "ninos", "para ninos", "preescolar"], movie: [10751], series: [10762] },
  { key: "music", aliases: ["musica", "music", "musical", "concierto", "conciertos"], movie: [10402], series: [] },
  { key: "mystery", aliases: ["misterio", "mystery", "enigmas", "investigacion"], movie: [9648], series: [9648] },
  { key: "reality", aliases: ["reality", "reality show", "telerrealidad"], movie: [], series: [10764] },
  { key: "romance", aliases: ["romance", "romantica", "romantico", "romanticas"], movie: [10749], series: [18] },
  { key: "science-fiction", aliases: ["ciencia ficcion", "sci fi", "scifi", "science fiction", "cyberpunk", "espacial", "futurista"], movie: [878], series: [10765] },
  { key: "thriller", aliases: ["suspenso", "thriller", "tension"], movie: [53], series: [9648] },
  { key: "war", aliases: ["guerra", "war", "militar", "belica", "belico"], movie: [10752], series: [10768] },
  { key: "western", aliases: ["western", "oeste", "vaqueros"], movie: [37], series: [37] },
];

const ANIME_SUBGENRES: AnimeSubgenreRule[] = [
  { key: "shonen", aliases: ["shonen", "shounen"], keywords: ["shounen", "shonen"], movie: [28], series: [10759] },
  { key: "shojo", aliases: ["shojo", "shoujo"], keywords: ["shoujo", "shojo"], movie: [10749], series: [18] },
  { key: "seinen", aliases: ["seinen"], keywords: ["seinen"], movie: [18], series: [18] },
  { key: "josei", aliases: ["josei"], keywords: ["josei"], movie: [10749], series: [18] },
  { key: "isekai", aliases: ["isekai", "otro mundo"], keywords: ["isekai"], movie: [14], series: [10765] },
  { key: "mecha", aliases: ["mecha", "robots gigantes"], keywords: ["mecha"], movie: [878], series: [10765] },
  { key: "slice-of-life", aliases: ["slice of life", "recuentos de la vida", "vida cotidiana"], keywords: ["slice of life"], movie: [18], series: [18] },
  { key: "sports", aliases: ["deportes", "deportivo", "sports"], keywords: ["sports"], movie: [18], series: [18] },
  { key: "magical-girl", aliases: ["magical girl", "mahou shoujo", "chicas magicas"], keywords: ["magical girl"], movie: [14], series: [10765] },
  { key: "samurai", aliases: ["samurai", "samurais"], keywords: ["samurai"], movie: [28], series: [10759] },
  { key: "ninja", aliases: ["ninja", "ninjas"], keywords: ["ninja"], movie: [28], series: [10759] },
  { key: "dark-fantasy", aliases: ["dark fantasy", "fantasia oscura"], keywords: ["dark fantasy"], movie: [14], series: [10765] },
];

const LANGUAGES: LanguageRule[] = [
  { code: "ja", aliases: ["japonesa", "japonesas", "japones", "japanese", "de japon"] },
  { code: "ko", aliases: ["coreana", "coreanas", "coreano", "korean", "de corea", "k drama", "kdrama"] },
  { code: "es", aliases: ["espanola", "espanolas", "espanol", "spanish", "de espana"] },
  { code: "fr", aliases: ["francesa", "francesas", "frances", "french", "de francia"] },
  { code: "zh", aliases: ["china", "chinas", "chino", "chinese", "de china"] },
  { code: "hi", aliases: ["india", "indias", "indio", "hindi", "bollywood"] },
  { code: "tr", aliases: ["turca", "turcas", "turco", "turkish", "de turquia"] },
  { code: "th", aliases: ["tailandesa", "tailandesas", "tailandes", "thai", "de tailandia"] },
  { code: "it", aliases: ["italiana", "italianas", "italiano", "italian", "de italia"] },
  { code: "de", aliases: ["alemana", "alemanas", "aleman", "german", "de alemania"] },
  { code: "en", aliases: ["inglesa", "inglesas", "ingles", "english", "en ingles"] },
];

const COMPANY_ALIASES = [
  "marvel", "marvel studios", "dc", "dc studios", "pixar", "disney", "netflix",
  "hbo", "warner", "warner bros", "a24", "dreamworks", "ghibli", "studio ghibli",
  "paramount", "universal", "sony pictures", "apple tv", "amazon studios",
];

function normalizeIntentText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(query: string, phrase: string) {
  const normalizedPhrase = normalizeIntentText(phrase);
  return (` ${query} `).includes(` ${normalizedPhrase} `);
}

function firstMatchingRule<T extends { aliases: string[] }>(query: string, rules: T[]) {
  return rules.find(rule => rule.aliases.some(alias => containsPhrase(query, alias)));
}

function allMatchingRules<T extends { aliases: string[] }>(query: string, rules: T[]) {
  return rules.filter(rule => rule.aliases.some(alias => containsPhrase(query, alias)));
}

function parseYearRange(query: string) {
  const exactYear = query.match(/\b((?:19|20)\d{2})\b/);
  if (exactYear) return { year: Number(exactYear[1]) };

  const shortDecade = query.match(/\b(?:anos?\s+)?(50|60|70|80|90)(?:s)?\b/);
  if (shortDecade) {
    const start = 1900 + Number(shortDecade[1]);
    return { dateFrom: `${start}-01-01`, dateTo: `${start + 9}-12-31` };
  }

  const longDecade = query.match(/\b((?:19|20)\d0)s?\b/);
  if (longDecade) {
    const start = Number(longDecade[1]);
    return { dateFrom: `${start}-01-01`, dateTo: `${start + 9}-12-31` };
  }

  const currentYear = new Date().getFullYear();
  if (["reciente", "recientes", "nueva", "nuevas", "nuevo", "nuevos", "estreno", "estrenos"].some(word => containsPhrase(query, word))) {
    return { dateFrom: `${currentYear - 2}-01-01`, dateTo: `${currentYear}-12-31` };
  }
  if (["clasico", "clasicos", "clasica", "clasicas", "antigua", "antiguas"].some(word => containsPhrase(query, word))) {
    return { dateTo: "1989-12-31" };
  }
  return {};
}

function parsePerson(query: string): SemanticSearchIntent["person"] {
  const patterns: Array<{ regex: RegExp; role: "cast" | "crew" }> = [
    { regex: /\b(?:con|protagonizada por|protagonizado por)\s+([a-z][a-z ]{2,})$/, role: "cast" },
    { regex: /\b(?:del director|de la directora|dirigida por|dirigido por)\s+([a-z][a-z ]{2,})$/, role: "crew" },
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern.regex);
    if (match?.[1]) return { name: match[1].trim(), role: pattern.role };
  }
  return undefined;
}

export function parseSemanticSearchIntent(value: string): SemanticSearchIntent {
  const query = normalizeIntentText(value);
  const anime = containsPhrase(query, "anime") || containsPhrase(query, "animacion japonesa");
  const movieRequested = ["pelicula", "peliculas", "film", "films", "cine"].some(alias => containsPhrase(query, alias));
  const seriesRequested = ["serie", "series", "programa de tv", "programas de tv", "tv show", "tv shows"].some(alias => containsPhrase(query, alias));
  const mediaTypes: SemanticMediaType[] = movieRequested && !seriesRequested
    ? ["movie"]
    : seriesRequested && !movieRequested
      ? ["series"]
      : ["movie", "series"];
  const genreRules = allMatchingRules(query, GENRES);
  const subgenreRules = allMatchingRules(query, ANIME_SUBGENRES);
  const language = firstMatchingRule(query, LANGUAGES)?.code;
  const yearRange = parseYearRange(query);
  const person = parsePerson(query);
  const company = COMPANY_ALIASES
    .slice()
    .sort((a, b) => b.length - a.length)
    .find(alias => containsPhrase(query, alias));
  const hasSemanticSubject = anime
    || movieRequested
    || seriesRequested
    || genreRules.length > 0
    || subgenreRules.length > 0
    || Boolean(language)
    || Boolean(yearRange.year || yearRange.dateFrom || yearRange.dateTo)
    || Boolean(person)
    || Boolean(company);
  const topModifier = containsPhrase(query, "top") && (query === "top" || hasSemanticSubject);
  const bestRated = topModifier
    || ["mejor valorada", "mejor valoradas", "mejor valorado", "mejor valorados", "mejores"].some(alias => containsPhrase(query, alias));
  const newest = ["reciente", "recientes", "nueva", "nuevas", "nuevo", "nuevos", "estreno", "estrenos"].some(alias => containsPhrase(query, alias));
  const popular = ["popular", "populares", "tendencia", "trending"].some(alias => containsPhrase(query, alias));
  const sort: SemanticSort = bestRated ? "vote_average.desc" : newest ? "date.desc" : "popularity.desc";
  const signalCount = Number(anime)
    + Number(movieRequested || seriesRequested)
    + genreRules.length
    + subgenreRules.length
    + Number(Boolean(language))
    + Number(Boolean(yearRange.year || yearRange.dateFrom || yearRange.dateTo))
    + Number(bestRated || newest || popular)
    + Number(Boolean(person))
    + Number(Boolean(company));

  return {
    active: signalCount > 0,
    mediaTypes,
    anime,
    genres: genreRules.map(rule => rule.key),
    animeSubgenres: subgenreRules.map(rule => rule.key),
    originalLanguage: anime ? "ja" : language,
    ...yearRange,
    sort,
    minimumVotes: bestRated ? 250 : 0,
    person,
    company,
    signalCount,
  };
}

function genreIdsForType(intent: SemanticSearchIntent, type: SemanticMediaType) {
  const standard = GENRES
    .filter(rule => intent.genres.includes(rule.key))
    .flatMap(rule => rule[type]);
  const animeSubgenres = ANIME_SUBGENRES
    .filter(rule => intent.animeSubgenres.includes(rule.key))
    .flatMap(rule => rule[type]);
  const animation = intent.anime ? [16] : [];
  return Array.from(new Set([...animation, ...standard, ...animeSubgenres]));
}

async function safeTmdbFetch(path: string, params: Record<string, string>, signal?: AbortSignal) {
  try {
    return await tmdbFetch<any>(path, { params, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

async function resolveKeywordIds(intent: SemanticSearchIntent, signal?: AbortSignal) {
  const keywordQueries = ANIME_SUBGENRES
    .filter(rule => intent.animeSubgenres.includes(rule.key))
    .flatMap(rule => rule.keywords);
  const ids = await Promise.all(Array.from(new Set(keywordQueries)).map(async keyword => {
    const json = await safeTmdbFetch("/search/keyword", { query: keyword, page: "1" }, signal);
    const results = Array.isArray(json?.results) ? json.results : [];
    const exact = results.find((item: any) => normalizeIntentText(item?.name ?? "") === normalizeIntentText(keyword));
    const candidate = exact ?? results[0];
    return Number(candidate?.id) || 0;
  }));
  return ids.filter(Boolean);
}

async function resolvePersonId(person?: SemanticSearchIntent["person"], signal?: AbortSignal) {
  if (!person) return undefined;
  const json = await safeTmdbFetch("/search/person", {
    query: person.name,
    language: "es-ES",
    page: "1",
    include_adult: "false",
  }, signal);
  return Number(json?.results?.[0]?.id) || undefined;
}

async function resolveCompanyId(company?: string, signal?: AbortSignal) {
  if (!company) return undefined;
  const json = await safeTmdbFetch("/search/company", { query: company, page: "1" }, signal);
  const results = Array.isArray(json?.results) ? json.results : [];
  const exact = results.find((item: any) => normalizeIntentText(item?.name ?? "") === normalizeIntentText(company));
  return Number((exact ?? results[0])?.id) || undefined;
}

function discoverySort(intent: SemanticSearchIntent, type: SemanticMediaType) {
  if (intent.sort !== "date.desc") return intent.sort;
  return type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
}

function semanticResult(item: any, type: SemanticMediaType, intent: SemanticSearchIntent): UnifiedSearchResult {
  const id = `tmdb:${item.id}`;
  const year = Number((item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || undefined;
  return {
    key: `tmdb:${type}:${id}`,
    id,
    type,
    name: item.title ?? item.name ?? "Sin título",
    poster: item.poster_path ? `${TMDB_IMAGE}/w342${item.poster_path}` : undefined,
    background: item.backdrop_path ? `${TMDB_IMAGE}/original${item.backdrop_path}` : undefined,
    description: item.overview,
    year,
    source: "semantic",
    sourceName: "TMDB",
    mediaLabel: type === "movie" ? "Pelicula" : "Serie",
    popularity: Number(item.popularity) || 0,
    voteCount: Number(item.vote_count) || 0,
    searchScore: 78 + intent.signalCount * 9,
  };
}

async function discoverType(
  type: SemanticMediaType,
  intent: SemanticSearchIntent,
  keywordIds: number[],
  personId?: number,
  companyId?: number,
  signal?: AbortSignal,
) {
  const endpoint = type === "movie" ? "/discover/movie" : "/discover/tv";
  const params: Record<string, string> = {
    language: "es-ES",
    page: "1",
    include_adult: "false",
    sort_by: discoverySort(intent, type),
  };
  const genreIds = genreIdsForType(intent, type);
  if (genreIds.length) params.with_genres = genreIds.join(",");
  if (intent.originalLanguage) params.with_original_language = intent.originalLanguage;
  if (intent.year) {
    params[type === "movie" ? "primary_release_year" : "first_air_date_year"] = String(intent.year);
  }
  if (intent.dateFrom) params[type === "movie" ? "primary_release_date.gte" : "first_air_date.gte"] = intent.dateFrom;
  if (intent.dateTo) params[type === "movie" ? "primary_release_date.lte" : "first_air_date.lte"] = intent.dateTo;
  if (intent.minimumVotes) params["vote_count.gte"] = String(intent.minimumVotes);
  if (keywordIds.length) params.with_keywords = keywordIds.join("|");
  if (personId && intent.person) params[intent.person.role === "crew" ? "with_crew" : "with_cast"] = String(personId);
  if (companyId) params.with_companies = String(companyId);

  let json = await safeTmdbFetch(endpoint, params, signal);
  let results = Array.isArray(json?.results) ? json.results : [];
  if (!results.length && params.with_keywords) {
    const { with_keywords: _keywords, ...fallbackParams } = params;
    json = await safeTmdbFetch(endpoint, fallbackParams, signal);
    results = Array.isArray(json?.results) ? json.results : [];
  }
  return results.slice(0, 24).map((item: any) => semanticResult(item, type, intent));
}

export async function searchTmdbSemantically(query: string, signal?: AbortSignal): Promise<UnifiedSearchResult[]> {
  const intent = parseSemanticSearchIntent(query);
  if (!intent.active) return [];

  const [keywordIds, personId, companyId] = await Promise.all([
    resolveKeywordIds(intent, signal),
    resolvePersonId(intent.person, signal),
    resolveCompanyId(intent.company, signal),
  ]);
  const groups = await Promise.all(
    intent.mediaTypes.map(type => discoverType(type, intent, keywordIds, personId, companyId, signal)),
  );
  return groups.flat();
}
