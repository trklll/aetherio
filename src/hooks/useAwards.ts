import { useQuery } from "@tanstack/react-query";
import { tmdbFetch, getApiKeys } from "../config/apiKeys.ts";

// Logos originales negros: Detail adapta su contraste al backdrop con CSS.
import oscarLogo from "../assets/logo premios/oscar-removebg-preview.png";
import goldenGlobeLogo from "../assets/logo premios/golden-globe-awards.png";
import baftaLogo from "../assets/logo premios/bafta-logo-.png";
import emmyLogo from "../assets/logo premios/emmy-award-logo.png";
import cannesLogo from "../assets/logo premios/festival-de-cannes-logo.png";
import veniceLogo from "../assets/logo premios/Venice-Film-Festival-logo.png";
import japanAcademyLogo from "../assets/logo premios/japan-academy-prize.png";
import marDelPlataLogo from "../assets/logo premios/Festival de Mar del Plata-logo.png";
import goyaLogo from "../assets/logo premios/goya-logo-removebg-preview.png";
import crunchyrollLogo from "../assets/logo premios/Crunchyroll_Logo.png";

const AWARD_LOGOS: Record<string, string> = {
  Oscar: oscarLogo,
  "Globo de Oro": goldenGlobeLogo,
  BAFTA: baftaLogo,
  Emmy: emmyLogo,
  "Festival de Cannes": cannesLogo,
  "Festival de Venecia": veniceLogo,
  "Japan Academy Prize": japanAcademyLogo,
  "Premios Goya": goyaLogo,
  "Mar del Plata": marDelPlataLogo,
  "Crunchyroll Anime Awards": crunchyrollLogo,
};

interface TmdbExternalIds {
  id?: number;
  imdb_id?: string | null;
  wikidata_id?: string | null;
}

interface TmdbDetails {
  id?: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
}

export interface AwardBadge {
  awardName: string;
  awardLogoUrl?: string;
  year?: number;
  winner: boolean;
  category?: string;
}

// Map de patrones de etiqueta -> {categoryName, priority}
// Solo los premios PRINCIPALES de cada premiacion. priority mas bajo = mas importante.
// `awardName` debe venir de los matchers (nos dice el contexto), `categoryTags` filtran por subcadena.
const PRIORITY_AWARDS: Array<{ awardName: string; awardTags: string[]; category: string; categoryTags: string[]; priority: number }> = [
  // Oscar - Mejor Película
  { awardName: "Oscar", awardTags: ["academy award", "oscar"], category: "Mejor Película", categoryTags: ["best picture", "mejor película", "mejor pelicula"], priority: 10 },
  // Oscar - Mejor Director
  { awardName: "Oscar", awardTags: ["academy award", "oscar"], category: "Mejor Director", categoryTags: ["best director", "mejor director"], priority: 11 },
  // Oscar - Mejor Actor
  { awardName: "Oscar", awardTags: ["academy award", "oscar"], category: "Mejor Actor", categoryTags: ["best actor", "mejor actor"], priority: 12 },
  // Oscar - Mejor Actriz
  { awardName: "Oscar", awardTags: ["academy award", "oscar"], category: "Mejor Actriz", categoryTags: ["best actress", "mejor actriz"], priority: 13 },
  // Palme d'Or (Cannes)
  { awardName: "Festival de Cannes", awardTags: ["cannes", "palme d'or", "palme dor", "palma de oro"], category: "Palma de Oro", categoryTags: ["palme", "palma"], priority: 20 },
  // Lion d'Oro (Venice)
  { awardName: "Festival de Venecia", awardTags: ["venice", "venecia", "golden lion", "león de oro", "leon de oro"], category: "León de Oro", categoryTags: ["lion", "león", "leon"], priority: 21 },
  // Golden Bear (Berlin)
  { awardName: "Festival de Berlín", awardTags: ["berlin", "berlín", "golden bear", "oso de oro"], category: "Oso de Oro", categoryTags: ["bear", "oso"], priority: 22 },
  // Golden Globe Best Picture (Drama or Musical/Comedy)
  { awardName: "Globo de Oro", awardTags: ["golden globe", "globo de oro"], category: "Mejor Película", categoryTags: ["best motion picture", "best picture", "best film", "mejor película", "mejor pelicula"], priority: 30 },
  // BAFTA Best Film
  { awardName: "BAFTA", awardTags: ["bafta", "british academy"], category: "Mejor Película", categoryTags: ["best film", "best picture", "mejor película", "mejor pelicula"], priority: 40 },
  // Emmy Outstanding Drama/Comedy Series
  { awardName: "Emmy", awardTags: ["emmy", "emmys", "emmi"], category: "Mejor Serie", categoryTags: ["drama series", "comedy series", "outstanding series", "mejor serie"], priority: 50 },
  // SAG Best Cast
  { awardName: "SAG", awardTags: ["screen actors guild", "sag award", "sag award-ensemble"], category: "Mejor Reparto", categoryTags: ["best cast", "best ensemble", "outstanding performance by a cast", "mejor reparto"], priority: 60 },
  // Goya Best Film
  { awardName: "Goya", awardTags: ["goya award", "premios goya", "goya"], category: "Mejor Película", categoryTags: ["best film", "best picture", "mejor película", "mejor pelicula"], priority: 70 },
  // Crunchyroll Anime of the Year
  { awardName: "Crunchyroll Anime Awards", awardTags: ["crunchyroll anime", "crunchyroll award"], category: "Mejor Anime", categoryTags: ["anime of the year", "mejor anime"], priority: 80 },
];

function matchPriorityAward(fullLabel: string, _winner: boolean): { awardName: string; category: string; priority: number } | null {
  const lower = fullLabel.toLowerCase().trim();
  // Recorremos por priority ascendente (los mas prioritarios ya estan primero en la lista)
  for (const award of PRIORITY_AWARDS) {
    const awardMatches = award.awardTags.some(t => lower.includes(t));
    if (!awardMatches) continue;
    const categoryMatches = award.categoryTags.some(t => lower.includes(t));
    if (!categoryMatches) continue;
    return { awardName: award.awardName, category: award.category, priority: award.priority };
  }
  return null;
}

// Dado un arreglo de AwardBadge (de cualquier fuente), filtra solo los principales
// y devuelve solo 1 (el de mayor prioridad). winner=true aplica -100 a su priority para priorizar.
function pickTopAward(all: AwardBadge[]): AwardBadge[] {
  const candidates: Array<AwardBadge & { priority: number }> = [];
  for (const badge of all) {
    const label = `${badge.awardName} ${badge.category ?? ""}`.trim();
    const m = matchPriorityAward(label, badge.winner);
    if (!m) continue;
    const logo = AWARD_LOGOS[m.awardName];
    candidates.push({
      ...badge,
      awardName: m.awardName,
      category: m.category,
      awardLogoUrl: logo,
      priority: m.priority,
    });
  }
  if (!candidates.length) return [];

  candidates.sort((a, b) => {
    const aBoost = a.winner ? -100 : 0;
    const bBoost = b.winner ? -100 : 0;
    return (a.priority + aBoost) - (b.priority + bBoost);
  });

  return [candidates[0]];
}

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const OMDB_ENDPOINT = "https://www.omdbapi.com/";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

function isSeriesType(type: string) {
  const normalized = type.toLowerCase();
  return normalized === "series" || normalized === "tv" || normalized === "anime";
}

function parseTmdbId(mediaId: string): number | null {
  if (!mediaId) return null;
  const trimmed = mediaId.trim();
  const match = /^tmdb:(\d+)$/i.exec(trimmed);
  if (match) {
    const id = Number(match[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }
  const direct = Number(trimmed);
  return Number.isFinite(direct) && direct > 0 ? direct : null;
}

async function resolveTmdbIdFromImdb(_type: string, mediaId: string): Promise<number | null> {
  if (!/^tt\d+/i.test(mediaId)) return null;
  const data = await tmdbFetch<any>(`/find/${mediaId}`, {
    params: { external_source: "imdb_id", language: "es-ES" },
  });
  const results = data?.movie_results?.length ? data.movie_results : data?.tv_results ?? [];
  const id = Number(results[0]?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

async function resolveInfo(type: string, tmdbId: number): Promise<{ qid: string | null; imdbId: string | null; title: string; year?: number }> {
  const tmdbType = isSeriesType(type) ? "tv" : "movie";
  const [ids, details] = await Promise.all([
    tmdbFetch<TmdbExternalIds>(`/${tmdbType}/${tmdbId}/external_ids`),
    tmdbFetch<TmdbDetails>(`/${tmdbType}/${tmdbId}`, { params: { language: "en-US" } }),
  ]);
  const title = String(details?.title ?? details?.name ?? details?.original_title ?? details?.original_name ?? "").trim();
  const dateStr = String(details?.release_date ?? details?.first_air_date ?? "");
  const year = dateStr ? Number(dateStr.slice(0, 4)) : undefined;
  return {
    qid: ids?.wikidata_id?.trim() || null,
    imdbId: ids?.imdb_id?.trim() || null,
    title,
    year: Number.isFinite(year) ? year : undefined,
  };
}

async function fetchAwardsByIdentifier(type: string, mediaId: string): Promise<AwardBadge[]> {
  let tmdbId = parseTmdbId(mediaId);
  if (tmdbId === null) {
    tmdbId = await resolveTmdbIdFromImdb(type, mediaId);
  }
  if (tmdbId === null) return [];
  return fetchAwards(type, tmdbId);
}

async function fetchAwards(type: string, tmdbId: number): Promise<AwardBadge[]> {
  const info = await resolveInfo(type, tmdbId);
  if (!info.qid && !info.imdbId && !info.title) return [];

  // 1) Wikidata (fuente autoritativa con estructura + logos)
  if (info.qid) {
    try {
      const wdAwards = await fetchWikidataAwards(info.qid);
      if (wdAwards.length) return pickTopAward(wdAwards);
    } catch {
      // continue to fallback
    }
  }

  // 2) OMDb (si hay API key configurada) - texto plano "10 nominations"
  if (info.imdbId) {
    try {
      const omdbAwards = await fetchOmdbAwards(info.imdbId);
      if (omdbAwards.length) return pickTopAward(omdbAwards);
    } catch {
      // continue to fallback
    }
  }

  // 3) Wikipedia (Accolades section) - gratis, sin key, último recurso
  if (info.title) {
    try {
      const wikiAwards = await fetchWikipediaAwards(info.title, info.year);
      if (wikiAwards.length) return pickTopAward(wikiAwards);
    } catch {
      // continue
    }
  }

  return [];
}

// =============================================================================
// Wikidata SPARQL
// =============================================================================

async function fetchWikidataAwards(qid: string): Promise<AwardBadge[]> {
  const query = `
SELECT DISTINCT ?award ?awardLabel ?logoPath ?year ?isWinner WHERE {
  {
    wd:${qid} p:P166 ?stmt .
    ?stmt ps:P166 ?award .
    OPTIONAL { ?stmt pq:P585 ?year }
    BIND(true AS ?isWinner)
  } UNION {
    wd:${qid} p:P1411 ?nom .
    ?nom ps:P1411 ?award .
    OPTIONAL { ?nom pq:P585 ?year }
    BIND(false AS ?isWinner)
  }
  OPTIONAL { ?award wdt:P154 ?logoPath }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
ORDER BY DESC(?year) DESC(?isWinner)
LIMIT 30`;

  const fullUrl = `${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(fullUrl, {
    headers: {
      "User-Agent": "Aetherio/1.0 (https://github.com/anomalyco/aetherio)",
      "Accept": "application/sparql-results+json",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];

  const json = await res.json();
  const items: any[] = Array.isArray(json.results?.bindings) ? json.results.bindings : [];
  if (!items.length) return [];

  const winnerBuckets = new Map<string, AwardBadge>();
  const nomineeBuckets = new Map<string, AwardBadge>();

  for (const item of items) {
    const awardName = String(item.awardLabel?.value ?? "").trim();
    if (!awardName) continue;

    const yearRaw = item.year?.value;
    const year = yearRaw ? Number(String(yearRaw).slice(0, 4)) : undefined;
    const isWinner = item.isWinner?.value === "true";
    const logoUrl = item.logoPath?.value ? String(item.logoPath.value) : undefined;

    const bucket = isWinner ? winnerBuckets : nomineeBuckets;
    const key = `${awardName}|${year ?? ""}`;
    const existing = bucket.get(key);
    if (existing && !existing.awardLogoUrl && logoUrl) {
      existing.awardLogoUrl = logoUrl;
      continue;
    }
    if (existing) continue;

    bucket.set(key, {
      awardName,
      awardLogoUrl: logoUrl,
      year: Number.isFinite(year) ? year : undefined,
      winner: isWinner,
    });
  }

  const seen = new Set<string>();
  const winners = [...winnerBuckets.values()].filter(item => {
    const key = `${item.awardName}|${item.year ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const nominees = [...nomineeBuckets.values()].filter(item => {
    const key = `${item.awardName}|${item.year ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return [...winners, ...nominees];
}

// =============================================================================
// OMDb API (requiere key)
// =============================================================================

const OMDB_AWARD_PATTERNS: Array<{ regex: RegExp; awardName: string; winner: boolean }> = [
  { regex: /Won\s+(\d+)\s+Oscars?/i, awardName: "Oscar", winner: true },
  { regex: /Nominated for\s+(\d+)\s+Oscars?/i, awardName: "Oscar", winner: false },
  { regex: /Won\s+(\d+)\s+Golden\s+Globes?/i, awardName: "Globo de Oro", winner: true },
  { regex: /Nominated for\s+(\d+)\s+Golden\s+Globes?/i, awardName: "Globo de Oro", winner: false },
  { regex: /Won\s+(\d+)\s+BAFTA/i, awardName: "BAFTA", winner: true },
  { regex: /Nominated for\s+(\d+)\s+BAFTA/i, awardName: "BAFTA", winner: false },
  { regex: /Won\s+(\d+)\s+Emmys?/i, awardName: "Emmy", winner: true },
  { regex: /Nominated for\s+(\d+)\s+Emmys?/i, awardName: "Emmy", winner: false },
];

async function fetchOmdbAwards(imdbId: string): Promise<AwardBadge[]> {
  const apiKey = getApiKeys().omdbApiKey.trim();
  if (!apiKey) return [];

  const url = `${OMDB_ENDPOINT}?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}&r=json`;
  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  const awardsText = String(data?.Awards ?? "").trim();
  if (!awardsText || /^N\/A$/i.test(awardsText)) return [];

  const year = data?.Year ? Number(String(data.Year).slice(0, 4)) : undefined;
  const seen = new Set<string>();
  const result: AwardBadge[] = [];

  for (const pattern of OMDB_AWARD_PATTERNS) {
    const match = awardsText.match(pattern.regex);
    if (!match) continue;
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count <= 0) continue;
    const key = `${pattern.awardName}|${pattern.winner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      awardName: pattern.awardName,
      year: Number.isFinite(year) ? year : undefined,
      winner: pattern.winner,
    });
  }

  return result;
}

// =============================================================================
// Wikipedia Accolades section (gratis, sin key)
// =============================================================================

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};

function parseCount(match: RegExpMatchArray): number {
  const raw = match[1];
  if (/^\d+$/.test(raw)) return Number(raw);
  const word = String(raw).toLowerCase();
  return WORD_NUMBERS[word] ?? 0;
}

// Map nombre humano -> AwardBadge. La seccion Accolades tiene prosa tipo:
//   "received 10 nominations at the 96th Academy Awards: Best Picture, Best Director..."
//   "nominated for seven Golden Globe Awards"
//   "was nominated for nine British Academy Film Awards"
const WIKIPEDIA_PATTERNS: Array<{ regex: RegExp; awardName: string; winner: boolean }> = [
  // "received N nominations at the Kth Academy Awards"
  { regex: /(?:received\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+nominations?\s+at\s+the\s+\d+\w{0,2}\s+Academy\s+Awards?/i, awardName: "Oscar", winner: false },
  { regex: /won\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:Academy\s+)?Oscars?/i, awardName: "Oscar", winner: true },
  { regex: /nominated for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:Academy\s+Awards?|Oscars?)/i, awardName: "Oscar", winner: false },
  { regex: /(?:received\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+nominations?\s+(?:at\s+the\s+\d+\w{0,2}\s+)?Golden\s+Globe\s+Awards?/i, awardName: "Globo de Oro", winner: false },
  { regex: /nominated for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+Golden\s+Globes?/i, awardName: "Globo de Oro", winner: false },
  { regex: /won\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+Golden\s+Globes?/i, awardName: "Globo de Oro", winner: true },
  { regex: /(?:received\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+nominations?\s+(?:at\s+the\s+\d+\w{0,2}\s+)?British\s+Academy\s+Film\s+Awards?/i, awardName: "BAFTA", winner: false },
  { regex: /nominated for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+BAFTA/i, awardName: "BAFTA", winner: false },
  { regex: /won\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+BAFTA/i, awardName: "BAFTA", winner: true },
  { regex: /(?:received\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+nominations?\s+at\s+the\s+\d+\w{0,2}\s+Emmy\s+Awards?/i, awardName: "Emmy", winner: false },
  { regex: /nominated for\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+Emmys?/i, awardName: "Emmy", winner: false },
  { regex: /won\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+Emmys?/i, awardName: "Emmy", winner: true },
  // "in N categories at the Kth British Academy Film Awards" (BAFTA longlist wording)
  { regex: /in\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s+categories\s+at\s+the\s+\d+\w{0,2}\s+British\s+Academy\s+Film\s+Awards?/i, awardName: "BAFTA", winner: false },
];

async function fetchWikipediaAwards(title: string, year?: number): Promise<AwardBadge[]> {
  // 1) Buscar el titulo Wikipedia del articulo (preferir "(film)")
  const articleTitle = await resolveWikipediaArticleTitle(title);
  if (!articleTitle) return [];

  // 2) Localizar la seccion Accolades/Awards
  const sectionIdx = await findAccoladesSectionIndex(articleTitle);
  if (sectionIdx == null) return [];

  // 3) Fetch del wikitext de esa seccion (limite: primeros 4000 chars suelen alcanzar)
  const wikitext = await fetchSectionWikitext(articleTitle, sectionIdx);
  if (!wikitext) return [];

  // 4) Limpiar refs y extraer primera frase de prosa (donde estan las menciones numericas)
  const cleaned = stripWikipediaMarkup(wikitext);
  const result: AwardBadge[] = [];
  const seen = new Set<string>();

  for (const pattern of WIKIPEDIA_PATTERNS) {
    const match = cleaned.match(pattern.regex);
    if (!match) continue;
    const count = parseCount(match);
    if (!Number.isFinite(count) || count <= 0) continue;
    const key = pattern.awardName;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      awardName: pattern.awardName,
      year,
      winner: pattern.winner,
    });
  }

  return result;
}

async function resolveWikipediaArticleTitle(title: string): Promise<string | null> {
  // Buscar en Wikipedia EN; priorizar resultados con "(film)" si es pelicula
  const searchUrl = `${WIKIPEDIA_API}?action=query&list=search&srsearch=${encodeURIComponent(title)}&srnamespace=0&format=json&srlimit=8&origin=*`;
  const res = await fetch(searchUrl, {
    headers: { "User-Agent": "Aetherio/1.0 (https://github.com/anomalyco/aetherio)", "Accept": "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;

  const json = await res.json();
  const items: any[] = json?.query?.search ?? [];
  if (!items.length) return null;

  const normalizedQuery = title.trim().toLowerCase();
  const lower = (s: string) => s.toLowerCase();

  // 1) Match exacto "(film)"
  const exactFilm = items.find(item => lower(item.title) === `${normalizedQuery} (film)`);
  if (exactFilm) return exactFilm.title;

  // 2) Match exacto (sin sufijo)
  const exact = items.find(item => lower(item.title) === normalizedQuery);
  if (exact) return exact.title;

  // 3) Cualquiera que termine en (film) y empiece con el titulo
  const startsWith = items.find(item => lower(item.title).startsWith(normalizedQuery) && lower(item.title).endsWith("(film)"));
  if (startsWith) return startsWith.title;

  // 4) Cualquiera que empiece con el titulo
  const partial = items.find(item => lower(item.title).startsWith(normalizedQuery));
  if (partial) return partial.title;

  return items[0].title;
}

async function findAccoladesSectionIndex(articleTitle: string): Promise<number | null> {
  const url = `${WIKIPEDIA_API}?action=parse&page=${encodeURIComponent(articleTitle)}&prop=sections&format=json&redirects=1&origin=*`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Aetherio/1.0 (https://github.com/anomalyco/aetherio)", "Accept": "application/json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) return null;

  const json = await res.json();
  const sections: any[] = json?.parse?.sections ?? [];
  if (!sections.length) return null;

  const accolades = sections.find(section =>
    /accolades?|awards?/i.test(String(section?.line ?? ""))
  );
  return accolades ? Number(accolades.index) : null;
}

async function fetchSectionWikitext(articleTitle: string, sectionIdx: number): Promise<string | null> {
  const url = `${WIKIPEDIA_API}?action=parse&page=${encodeURIComponent(articleTitle)}&prop=wikitext&section=${sectionIdx}&format=json&redirects=1&origin=*`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Aetherio/1.0 (https://github.com/anomalyco/aetherio)", "Accept": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;

  const json = await res.json();
  const wikitext: string | undefined = json?.parse?.wikitext?.["*"];
  return typeof wikitext === "string" ? wikitext : null;
}

function stripWikipediaMarkup(wikitext: string): string {
  return wikitext
    // Eliminar refs <ref>...</ref>
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/<ref[^>]*\/>/gi, "")
    // Eliminar templates {{...}}
    .replace(/\{\{[^{}]*\}\}/g, "")
    // Eliminar enlaces [[X|Y]] -> Y, [[X]] -> X
    .replace(/\[\[[^\]]*\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    // Eliminar cabezas de seccion == X ==
    .replace(/^=+\s*[^=]+\s=+$/gm, "")
    // Eliminar listas * y tablas {| ... |}
    .replace(/^\*\s.+$/gm, "")
    .replace(/\{\|[\s\S]*?\|\}/g, "")
    // Multiples espacios
    .replace(/\s+/g, " ")
    .trim();
}

export function useAwardsByIdentifier(type: string, mediaId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["awards", "id", mediaId],
    queryFn: () => fetchAwardsByIdentifier(type, mediaId),
    enabled: enabled && Boolean(mediaId),
    staleTime: 1000 * 60 * 60 * 24 * 7,
    gcTime: 1000 * 60 * 60 * 24 * 30,
    retry: 1,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  }).data ?? [];
}

export function useAwardsByTmdbId(type: string, tmdbId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["awards", "tmdb", tmdbId],
    queryFn: () => fetchAwards(type, tmdbId as number),
    enabled: enabled && tmdbId !== null,
    staleTime: 1000 * 60 * 60 * 24 * 7,
    gcTime: 1000 * 60 * 60 * 24 * 30,
    retry: 1,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  }).data ?? [];
}

// Backwards-compat: el identifier (raw mediaId "tmdb:123" o "tt000000")
export function useAwards(type: string, mediaId: string, enabled: boolean) {
  return useAwardsByIdentifier(type, mediaId, enabled);
}
