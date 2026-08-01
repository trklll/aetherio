// Catálogo centralizado de premiaciones de Aetherio.
// El cliente ya NO parsea fuentes externas: consume el worker
// (GET /api/awards/media) que sirve los datos de AWARDS_DB (D1).

import { useQuery } from "@tanstack/react-query";

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

// =============================================================================
// Tipos espejo del catálogo (website/worker/awards/types.ts)
// =============================================================================

export type AwardCeremony =
  | "oscar"
  | "bafta"
  | "golden_globes"
  | "emmy"
  | "goya"
  | "japan_academy"
  | "crunchyroll"
  | "cannes"
  | "venice"
  | "mar_del_plata";

export type AwardStatus = "winner" | "nominee" | "official_selection";
export type AwardSubject = "work" | "person" | "episode" | "song" | "technical";
export type MediaType = "movie" | "tv" | "anime";
export type AwardResolutionStatus = "resolved" | "pending" | "ambiguous" | "unresolved";

export interface AwardRecord {
  id: string;
  ceremony: AwardCeremony;
  edition: number | null;
  awardYear: number;
  categoryEs: string;
  categoryOriginal: string;
  status: AwardStatus;
  subject: AwardSubject;
  recipients: string[];
  workTitle: string;
  workYear?: number;
  sourceUrl: string;
  sourceTier: "official" | "secondary";
  mediaType?: MediaType;
  tmdbId?: number;
  imdbId?: string;
  anilistId?: number;
}

export interface CoverageSummary {
  ceremony: AwardCeremony;
  /** Ediciones esperadas según el manifest (complete + partial). */
  expectedEditions: number[];
  /** Esperadas sin importar todavía. */
  pendingEditions: number[];
  /** Huecos explícitos: canceladas, sin archivo o bloqueadas. */
  gapEditions: Array<{ edition: number; type: "canceled" | "no_archive" | "blocked" }>;
  completeEditions: number[];
  partialEditions: number[];
  staleEditions: number[];
  failedEditions: number[];
  lastSyncAt: string | null;
}

/** Razón por la que una obra no devuelve registros de premiaciones. */
export type AwardEmptyReason =
  | "edition_not_imported"
  | "identity_unresolved"
  | "identity_ambiguous"
  | "no_matching_records"
  | "sync_failed";

/** Identidad coincidente con la obra consultada (qué se vinculó y contra qué). */
export interface AwardMatched {
  workKey: string;
  workTitle: string;
  workYear: number | null;
  matchedTitle: string | null;
  matchedYear: number | null;
  tmdbId: number | null;
  imdbId: string | null;
  anilistId: number | null;
}

export interface AwardsResponse {
  mediaType?: MediaType;
  tmdbId?: number | null;
  imdbId?: string | null;
  anilistId?: number | null;
  records: AwardRecord[];
  featured: AwardRecord | null;
  /** Null cuando hay registros; la razón del vacío en caso contrario. */
  reason?: AwardEmptyReason | null;
  resolution: {
    status: AwardResolutionStatus;
    workKey: string | null;
    matchedTitle?: string | null;
    matchedYear?: number | null;
  };
  matched: AwardMatched | null;
  coverage: Record<AwardCeremony, CoverageSummary>;
  /** Cobertura de las ceremonias con ediciones en los años de la obra. */
  relevantCoverage?: Record<string, CoverageSummary>;
  generatedAt: string;
}

export interface AwardPersonResponse {
  personName: string;
  identity: {
    id: string | null;
    canonicalName: string | null;
    tmdbId: number | null;
    imdbId: string | null;
    wikidataId: string | null;
    anilistStaffId: number | null;
  };
  resolution: {
    status: AwardResolutionStatus;
    reason: string | null;
  };
  records: AwardRecord[];
  summary: { winners: number; nominees: number; ceremonies: number };
  generatedAt: string;
}

export interface PersonAwardsData {
  records: AwardRecord[];
  resolutionStatus: AwardResolutionStatus | null;
  reason: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  retry: () => void;
}

export interface AwardsData {
  records: AwardRecord[];
  featured: AwardRecord | null;
  coverage: Record<AwardCeremony, CoverageSummary> | null;
  reason: AwardEmptyReason | null;
  matched: AwardMatched | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  resolutionStatus: AwardResolutionStatus | null;
  retry: () => void;
}

// =============================================================================
// Metadatos de ceremonias para la UI (espejo de website/worker/awards/schema.ts)
// =============================================================================

const CEREMONY_INFO: Record<AwardCeremony, { nameEs: string; nameOriginal: string; logo: string }> = {
  oscar: { nameEs: "Premios Oscar", nameOriginal: "Academy Awards", logo: oscarLogo },
  cannes: { nameEs: "Festival de Cannes", nameOriginal: "Festival de Cannes", logo: cannesLogo },
  venice: { nameEs: "Festival de Venecia", nameOriginal: "Venice Film Festival", logo: veniceLogo },
  golden_globes: { nameEs: "Globos de Oro", nameOriginal: "Golden Globe Awards", logo: goldenGlobeLogo },
  bafta: { nameEs: "Premios BAFTA", nameOriginal: "British Academy Film Awards", logo: baftaLogo },
  emmy: { nameEs: "Premios Emmy", nameOriginal: "Emmy Awards", logo: emmyLogo },
  goya: { nameEs: "Premios Goya", nameOriginal: "Premios Goya", logo: goyaLogo },
  japan_academy: { nameEs: "Japan Academy Prize", nameOriginal: "Japan Academy Prize", logo: japanAcademyLogo },
  crunchyroll: { nameEs: "Crunchyroll Anime Awards", nameOriginal: "Crunchyroll Anime Awards", logo: crunchyrollLogo },
  mar_del_plata: { nameEs: "Festival de Mar del Plata", nameOriginal: "Festival Internacional de Cine de Mar del Plata", logo: marDelPlataLogo },
};

// Algunas ediciones antiguas fueron importadas antes de que el parser
// tuviera diccionario, por lo que categoryEs puede contener todavía el texto
// original. Traducimos en la presentación para que no sea necesario esperar a
// un backfill para corregir el subtítulo del hero.
const AWARD_CATEGORY_TRANSLATIONS: Record<string, string> = {
  "Anime of the Year": "Anime del año",
  "Mejor Anime del Año": "Anime del año",
  "Best Picture": "Mejor Película",
  "Best Film": "Mejor Película",
  "Outstanding British Film": "Mejor Película Británica",
  "Outstanding Debut by a British Writer, Director or Producer": "Mejor Ópera Prima Británica",
  "Best Director": "Mejor Director",
  "Best Directing": "Mejor Dirección",
  "Best Direction": "Mejor Dirección",
  "Best Leading Actor": "Mejor Actor Protagónico",
  "Best Leading Actress": "Mejor Actriz Protagónica",
  "Best Actor in a Leading Role": "Mejor Actor Protagónico",
  "Best Actress in a Leading Role": "Mejor Actriz Protagónica",
  "Best Supporting Actor": "Mejor Actor de Reparto",
  "Best Supporting Actress": "Mejor Actriz de Reparto",
  "Best Actor in a Supporting Role": "Mejor Actor de Reparto",
  "Best Actress in a Supporting Role": "Mejor Actriz de Reparto",
  "Best Original Screenplay": "Mejor Guion Original",
  "Best Adapted Screenplay": "Mejor Guion Adaptado",
  "Best Screenplay": "Mejor Guion",
  "Best Cinematography": "Mejor Fotografía",
  "Best Editing": "Mejor Montaje",
  "Best Film Editing": "Mejor Montaje",
  "Best Production Design": "Mejor Diseño de Producción",
  "Best Costume Design": "Mejor Diseño de Vestuario",
  "Best Make Up & Hair": "Mejor Maquillaje y Peluquería",
  "Best Makeup and Hairstyling": "Mejor Maquillaje y Peinado",
  "Best Sound": "Mejor Sonido",
  "Best Special Visual Effects": "Mejores Efectos Visuales",
  "Best Visual Effects": "Mejores Efectos Visuales",
  "Best Original Score": "Mejor Banda Sonora Original",
  "Best Original Song": "Mejor Canción Original",
  "Best Animated Film": "Mejor Película de Animación",
  "Best Animated Feature Film": "Mejor Película de Animación",
  "Best Animated Short Film": "Mejor Cortometraje Animado",
  "Best Casting": "Mejor Reparto (Casting)",
  "Best Documentary": "Mejor Documental",
  "Best Documentary Feature Film": "Mejor Documental",
  "Best Documentary Short Subject": "Mejor Cortometraje Documental",
  "Best Live Action Short Film": "Mejor Cortometraje de Ficción",
  "Best Film Not in the English Language": "Mejor Película en Lengua No Inglesa",
  "Best Motion Picture – Drama": "Mejor Película Dramática",
  "Best Motion Picture – Musical or Comedy": "Mejor Película de Comedia o Musical",
  "Best Motion Picture – Non-English Language": "Mejor Película en Lengua No Inglesa",
  "Best Actor in a Motion Picture – Drama": "Mejor Actor de Película Dramática",
  "Best Actor in a Motion Picture – Musical or Comedy": "Mejor Actor de Comedia o Musical",
  "Best Actress in a Motion Picture – Drama": "Mejor Actriz de Película Dramática",
  "Best Actress in a Motion Picture – Musical or Comedy": "Mejor Actriz de Comedia o Musical",
  // Los Globos de Oro cambiaron recientemente el texto de estas categorías
  // a "Performance by a Female/Male Actor". Conservamos ambas variantes para
  // que las ediciones históricas y las nuevas se vean siempre en español.
  "Best Performance by a Female Actor in a Motion Picture – Drama": "Mejor Actuación de una Actriz en una Película Dramática",
  "Best Performance by a Male Actor in a Motion Picture – Drama": "Mejor Actuación de un Actor en una Película Dramática",
  "Best Performance by a Female Actor in a Motion Picture – Musical or Comedy": "Mejor Actuación de una Actriz en una Película de Comedia o Musical",
  "Best Performance by a Male Actor in a Motion Picture – Musical or Comedy": "Mejor Actuación de un Actor en una Película de Comedia o Musical",
  "Best Performance by a Female Actor in a Television Series – Drama": "Mejor Actuación de una Actriz en una Serie de Televisión Dramática",
  "Best Performance by a Male Actor in a Television Series – Drama": "Mejor Actuación de un Actor en una Serie de Televisión Dramática",
  "Best Performance by a Female Actor in a Television Series – Musical or Comedy": "Mejor Actuación de una Actriz en una Serie de Televisión de Comedia o Musical",
  "Best Performance by a Male Actor in a Television Series – Musical or Comedy": "Mejor Actuación de un Actor en una Serie de Televisión de Comedia o Musical",
  "Best Performance by a Female Actor in a Limited Series, Anthology Series, or a Motion Picture Made for Television": "Mejor Actuación de una Actriz en una Miniserie, Antología o Película para Televisión",
  "Best Performance by a Male Actor in a Limited Series, Anthology Series, or a Motion Picture Made for Television": "Mejor Actuación de un Actor en una Miniserie, Antología o Película para Televisión",
  "Best Performance by a Female Actor in a Supporting Role in Any Motion Picture": "Mejor Actuación de una Actriz de Reparto en una Película",
  "Best Performance by a Male Actor in a Supporting Role in Any Motion Picture": "Mejor Actuación de un Actor de Reparto en una Película",
  "Best Performance by an Actress in a Motion Picture – Drama": "Mejor Actuación de una Actriz en una Película Dramática",
  "Best Performance by an Actor in a Motion Picture – Drama": "Mejor Actuación de un Actor en una Película Dramática",
  "Best Performance by an Actress in a Motion Picture – Musical or Comedy": "Mejor Actuación de una Actriz en una Película de Comedia o Musical",
  "Best Performance by an Actor in a Motion Picture – Musical or Comedy": "Mejor Actuación de un Actor en una Película de Comedia o Musical",
  "Best Performance by an Actress in a Supporting Role in any Motion Picture": "Mejor Actuación de una Actriz de Reparto en una Película",
  "Best Performance by an Actor in a Supporting Role in any Motion Picture": "Mejor Actuación de un Actor de Reparto en una Película",
  "Best Director - Motion Picture": "Mejor Dirección - Película",
  "Best Screenplay - Motion Picture": "Mejor Guion - Película",
  "Best Supporting Actor in a Motion Picture": "Mejor Actor de Reparto",
  "Best Supporting Actress in a Motion Picture": "Mejor Actriz de Reparto",
  "Best Television Series – Drama": "Mejor Serie de Televisión Dramática",
  "Best Television Series – Musical or Comedy": "Mejor Serie de Comedia o Musical",
  "Best Limited Series, Anthology Series or Television Film": "Mejor Miniserie, Antología o Película para TV",
  "Best Actor in a Television Series – Drama": "Mejor Actor de Serie Dramática",
  "Best Actor in a Television Series – Musical or Comedy": "Mejor Actor de Serie de Comedia o Musical",
  "Best Actress in a Television Series – Drama": "Mejor Actriz de Serie Dramática",
  "Best Actress in a Television Series – Musical or Comedy": "Mejor Actriz de Serie de Comedia o Musical",
  "Best Supporting Actor in a Television Series": "Mejor Actor de Reparto en TV",
  "Best Supporting Actress in a Television Series": "Mejor Actriz de Reparto en TV",
  "Outstanding Drama Series": "Mejor Serie Dramática",
  "Outstanding Comedy Series": "Mejor Serie de Comedia",
  "Outstanding Limited or Anthology Series": "Mejor Miniserie o Serie Limitada",
  "Outstanding Lead Actor in a Drama Series": "Mejor Actor Principal en Serie Dramática",
  "Outstanding Lead Actress in a Drama Series": "Mejor Actriz Principal en Serie Dramática",
  "Outstanding Lead Actor in a Comedy Series": "Mejor Actor Principal en Serie de Comedia",
  "Outstanding Lead Actress in a Comedy Series": "Mejor Actriz Principal en Serie de Comedia",
  "Outstanding Lead Actor in a Limited or Anthology Series or Movie": "Mejor Actor Principal en Miniserie o Película",
  "Outstanding Lead Actress in a Limited or Anthology Series or Movie": "Mejor Actriz Principal en Miniserie o Película",
  "Outstanding Supporting Actor in a Drama Series": "Mejor Actor de Reparto en Serie Dramática",
  "Outstanding Supporting Actress in a Drama Series": "Mejor Actriz de Reparto en Serie Dramática",
  "Outstanding Supporting Actor in a Comedy Series": "Mejor Actor de Reparto en Serie de Comedia",
  "Outstanding Supporting Actress in a Comedy Series": "Mejor Actriz de Reparto en Serie de Comedia",
  "Outstanding Supporting Actor in a Limited or Anthology Series or Movie": "Mejor Actor de Reparto en Miniserie o Película",
  "Outstanding Supporting Actress in a Limited or Anthology Series or Movie": "Mejor Actriz de Reparto en Miniserie o Película",
  "Outstanding Animated Program": "Mejor Programa Animado",
  "Outstanding Reality Competition Program": "Mejor Programa de Reality y Competencia",
  "Outstanding Talk Series": "Mejor Programa de Entrevistas",
  "Outstanding Variety Special": "Mejor Especial de Variedades",
  "Outstanding Guest Actor in a Drama Series": "Mejor Actor Invitado en Serie Dramática",
  "Outstanding Guest Actress in a Drama Series": "Mejor Actriz Invitada en Serie Dramática",
  "Outstanding Casting for a Drama Series": "Mejor Casting en Serie Dramática",
  "Outstanding Cinematography for a Single-Camera Series": "Mejor Fotografía en Serie",
  "Outstanding Production Design for a Narrative Contemporary Program": "Mejor Diseño de Producción",
  "Outstanding Costumes for a Series": "Mejor Diseño de Vestuario",
  "Outstanding Makeup for a Series": "Mejor Maquillaje",
  "Outstanding Sound Mixing for a Comedy or Drama Series": "Mejor Mezcla de Sonido",
  "Outstanding Music Composition for a Series": "Mejor Composición Musical",
  "Outstanding Original Music and Lyrics": "Mejor Música y Letras Originales",
  "Outstanding Directing for a Drama Series": "Mejor Dirección en Serie Dramática",
  "Outstanding Directing for a Comedy Series": "Mejor Dirección en Serie de Comedia",
  "Outstanding Writing for a Drama Series": "Mejor Guion en Serie Dramática",
  "Outstanding Writing for a Comedy Series": "Mejor Guion en Serie de Comedia",
  "Best Continuing Series": "Mejor Serie en Emisión",
  "Best New Series": "Mejor Serie Nueva",
  "Best Drama": "Mejor Drama",
  "Best Fantasy": "Mejor Fantasía",
  "Best Comedy": "Mejor Comedia",
  "Best Romance": "Mejor Romance",
  "Best Action": "Mejor Acción",
  "Best Character Design": "Mejor Diseño de Personajes",
  "Best Animation": "Mejor Animación",
  "Best Score": "Mejor Banda Sonora",
  "Best VA Performance": "Mejor Actuación de Voz",
  "Best Voice Artist Performance": "Mejor Actuación de Actor de Voz",
  "Best Opening Sequence": "Mejor Secuencia de Apertura",
  "Best Ending Sequence": "Mejor Secuencia de Cierre",
  "Best Anime Song": "Mejor Canción de Anime",
  "Cinematic and Box Office Achievement": "Logro Cinematográfico y de Taquilla",
  "Palme d'Or": "Palma de Oro",
  "Grand Prix": "Gran Premio",
  "Prix du Jury": "Premio del Jurado",
  "Prix de la mise en scène": "Premio a la Dirección",
  "Prix d'interprétation masculine": "Premio de Interpretación Masculina",
  "Prix d'interprétation féminine": "Premio de Interpretación Femenina",
  "Prix du scénario": "Premio al Guion",
  "Caméra d'Or": "Cámara de Oro",
  "Palme d'Or du court métrage": "Palma de Oro al Cortometraje",
  "Queer Palm": "Palma Queer",
  "Golden Eye": "Ojo de Oro (Premio del Documental)",
  "Prix Un Certain Regard": "Premio Un Certain Regard",
  "Golden Lion for Best Film": "León de Oro a la Mejor Película",
  "Grand Jury Prize": "Gran Premio del Jurado",
  "Silver Lion for Best Director": "León de Plata a la Mejor Dirección",
  "Special Jury Prize": "Premio Especial del Jurado",
  "Volpi Cup for Best Actor": "Copa Volpi al Mejor Actor",
  "Volpi Cup for Best Actress": "Copa Volpi a la Mejor Actriz",
};

function normalizeAwardCategory(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const NORMALIZED_AWARD_CATEGORY_TRANSLATIONS = new Map(
  Object.entries(AWARD_CATEGORY_TRANSLATIONS).map(([key, value]) => [normalizeAwardCategory(key), value]),
);

/**
 * Traduce categorías nuevas que todavía no existían cuando se creó el
 * diccionario (por ejemplo, las variantes "Performance by a Female Actor"
 * de Globos de Oro). Se aplica solo como último recurso y únicamente sobre
 * el nombre de la categoría, nunca sobre el título de la obra.
 */
function translateAwardCategoryFallback(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bPerformance\s+by\s+a\s+Female\s+Actor\b/gi, "Actuación de una Actriz"],
    [/\bPerformance\s+by\s+a\s+Male\s+Actor\b/gi, "Actuación de un Actor"],
    [/\bPerformance\s+by\s+an\s+Actress\b/gi, "Actuación de una Actriz"],
    [/\bPerformance\s+by\s+an\s+Actor\b/gi, "Actuación de un Actor"],
    [/\bPerformance\s+in\s+Stand-Up\s+Comedy\s+on\s+Television\b/gi, "Actuación de Stand-Up en TV"],
    [/\bin\s+any\s+Motion\s+Picture\b/gi, "en cualquier Película"],
    [/\bin\s+a\s+Motion\s+Picture\b/gi, "en una Película"],
    [/\bin\s+an\s+Motion\s+Picture\b/gi, "en una Película"],
    [/\bin\s+a\s+Television\s+Series\b/gi, "en una Serie de Televisión"],
    [/\bin\s+an\s+Limited\s+Series\b/gi, "en una Miniserie"],
    [/\bin\s+a\s+Supporting\s+Role\b/gi, "en un Papel de Reparto"],
    [/\bin\s+an\s+Supporting\s+Role\b/gi, "en un Papel de Reparto"],
    [/\bMotion\s+Picture\b/gi, "Película"],
    [/\bTelevision\s+Series\b/gi, "Serie de Televisión"],
    [/\bTelevision\s+Film\b/gi, "Película para Televisión"],
    [/\bLimited\s+Series\b/gi, "Miniserie"],
    [/\bAnthology\s+Series\b/gi, "Serie de Antología"],
    [/\bMusical\s+or\s+Comedy\b/gi, "de Comedia o Musical"],
    [/\bNon-English\s+Language\b/gi, "Lengua No Inglesa"],
    [/\bSupporting\s+Role\b/gi, "Papel de Reparto"],
    [/\bLeading\s+Role\b/gi, "Papel Protagónico"],
    [/\bMade\s+for\s+Television\b/gi, "para Televisión"],
    [/\bFemale\s+Actor\b/gi, "Actriz"],
    [/\bMale\s+Actor\b/gi, "Actor"],
    [/\bActress\b/gi, "Actriz"],
    [/\bActor\b/gi, "Actor"],
    [/\bPerformance\b/gi, "Actuación"],
    [/\bOutstanding\b/gi, "Mejor"],
    [/\bBest\b/gi, "Mejor"],
    [/\bDirecting\b/gi, "Dirección"],
    [/\bDirector\b/gi, "Director"],
    [/\bScreenplay\b/gi, "Guion"],
    [/\bWriting\b/gi, "Guion"],
    [/\bCinematography\b/gi, "Fotografía"],
    [/\bEditing\b/gi, "Montaje"],
    [/\bProduction\s+Design\b/gi, "Diseño de Producción"],
    [/\bCostume\s+Design\b/gi, "Diseño de Vestuario"],
    [/\bVisual\s+Effects\b/gi, "Efectos Visuales"],
    [/\bOriginal\s+Score\b/gi, "Banda Sonora Original"],
    [/\bOriginal\s+Song\b/gi, "Canción Original"],
    [/\bAnimated\s+(?:Feature\s+)?Film\b/gi, "Película de Animación"],
    [/\bDocumentary\s+Feature\s+Film\b/gi, "Documental"],
    [/\bDocumentary\b/gi, "Documental"],
    [/\bShort\s+Film\b/gi, "Cortometraje"],
    [/\bFilm\b/gi, "Película"],
    [/\bMovie\b/gi, "Película"],
    [/\bSeries\b/gi, "Serie"],
    [/\bDrama\b/gi, "Dramática"],
    [/\bComedy\b/gi, "Comedia"],
    [/\bFantasy\b/gi, "Fantasía"],
    [/\bAction\b/gi, "Acción"],
    [/\bRomance\b/gi, "Romance"],
    [/\bAnimation\b/gi, "Animación"],
    [/\bScore\b/gi, "Banda Sonora"],
    [/\bCasting\b/gi, "Reparto"],
    [/\bDesign\b/gi, "Diseño"],
    [/\bSound\b/gi, "Sonido"],
    [/\bAward\b/gi, "Premio"],
    [/\bPrize\b/gi, "Premio"],
    [/\bAchievement\b/gi, "Logro"],
    [/\bLifetime\s+Achievement\b/gi, "Trayectoria"],
    [/\bAny\b/gi, "cualquier"],
    [/\bAnother\b/gi, "Otro"],
    [/\bPreviously\b/gi, "Previamente"],
    [/\bProduced\b/gi, "Producido"],
    [/\bPublished\b/gi, "Publicado"],
    [/\bBased\b/gi, "Basado"],
    [/\bMaterial\b/gi, "Material"],
    [/\bMedium\b/gi, "Medio"],
    [/\bEnglish\b/gi, "Inglesa"],
    [/\bInternational\b/gi, "Internacional"],
    [/\bOriginal\b/gi, "Original"],
    [/\bAdapted\b/gi, "Adaptado"],
    [/\bfor\b/gi, "para"],
    [/\bfrom\b/gi, "de"],
    [/\bwith\b/gi, "con"],
    [/\bwithout\b/gi, "sin"],
    [/\bof\b/gi, "de"],
    [/\bon\b/gi, "en"],
    [/\bin\b/gi, "en"],
    [/\bby\b/gi, "por"],
    [/\band\b/gi, "y"],
    [/\bor\b/gi, "o"],
  ];

  let translated = value.replace(/[–—]/g, " - ");
  for (const [pattern, replacement] of replacements) translated = translated.replace(pattern, replacement);
  return translated
    .replace(/\s+/g, " ")
    .replace(/\s+([,)])/g, "$1")
    .replace(/\bMejor\s+Mejor\b/gi, "Mejor")
    .trim();
}

/** Categoría visible en español, incluso para imports históricos en inglés. */
export function awardCategoryLabel(record: Pick<AwardRecord, "categoryEs" | "categoryOriginal">): string {
  const translated = NORMALIZED_AWARD_CATEGORY_TRANSLATIONS.get(normalizeAwardCategory(record.categoryOriginal))
    ?? NORMALIZED_AWARD_CATEGORY_TRANSLATIONS.get(normalizeAwardCategory(record.categoryEs));
  if (translated) return translated;

  const original = record.categoryOriginal?.trim() || "";
  const localized = record.categoryEs?.trim() || "";
  const englishPattern = /\b(?:best|outstanding|performance|motion|television|actor|actress|film|series|award|prize|directing|screenplay|writing)\b/i;
  const value = englishPattern.test(original) ? original : (localized || original);
  return translateAwardCategoryFallback(value);
}

export const STATUS_LABELS: Record<AwardStatus, string> = {
  winner: "Ganadora",
  nominee: "Nominada",
  official_selection: "Selección oficial",
};

/** Nombre corto para frases tipo "Ganadora del ...". */
function badgeName(ceremony: AwardCeremony): string {
  const name = CEREMONY_INFO[ceremony]?.nameEs ?? ceremony;
  const singular = name.replace(/^Premios\s+/, "Premio ");
  if (ceremony === "golden_globes") return "Globo de Oro";
  return singular;
}

/** Frase del destacado: "Ganadora del Premio Oscar 2024" / "Nominada al Globo de Oro". */
export function featuredText(record: AwardRecord): string {
  const name = badgeName(record.ceremony);
  if (record.status === "winner") return `Ganadora del ${name}`;
  if (record.status === "nominee") return `Nominada al ${name}`;
  return `Selección oficial en ${name}`;
}

export function ceremonyName(ceremony: AwardCeremony): string {
  return CEREMONY_INFO[ceremony]?.nameEs ?? ceremony;
}

export function ceremonyLogo(ceremony: AwardCeremony): string {
  return CEREMONY_INFO[ceremony]?.logo;
}

// =============================================================================
// Cliente de la API
// =============================================================================

const API_BASE = import.meta.env.VITE_AETHERIO_API_URL?.replace(/\/$/, "")
  ?? "https://trkll.aetherio.workers.dev";

/** Logs de diagnóstico solo en desarrollo (nunca en producción). */
function logAwards(title: string, details: Array<[string, unknown]>): void {
  if (!import.meta.env.DEV) return;
  console.groupCollapsed(`[AETHERIO:AWARDS] ${title}`);
  for (const [label, value] of details) console.log(label, value);
  console.groupEnd();
}

function logAwardsError(title: string, error: unknown): void {
  if (!import.meta.env.DEV) return;
  console.groupCollapsed(`[AETHERIO:AWARDS] ${title}`);
  console.error(error);
  console.groupEnd();
}

function toMediaType(type: string): MediaType | null {
  const normalized = type.toLowerCase();
  if (normalized === "movie" || normalized === "film" || normalized === "pelicula" || normalized === "película") return "movie";
  if (normalized === "tv" || normalized === "series" || normalized === "serie") return "tv";
  if (normalized === "anime") return "anime";
  return null;
}

/** "tmdb:123", "tt000000" o "123" -> parámetros de consulta. */
function parseMediaId(mediaId: string): { tmdbId?: number; imdbId?: string } | null {
  if (!mediaId) return null;
  const trimmed = mediaId.trim();
  const tmdbMatch = /^tmdb:(\d+)$/i.exec(trimmed);
  if (tmdbMatch) {
    const id = Number(tmdbMatch[1]);
    return Number.isFinite(id) && id > 0 ? { tmdbId: id } : null;
  }
  if (/^tt\d+$/i.test(trimmed)) return { imdbId: trimmed };
  const direct = Number(trimmed);
  return Number.isFinite(direct) && direct > 0 ? { tmdbId: direct } : null;
}

async function fetchMediaAwards(params: {
  type?: MediaType;
  tmdbId?: number;
  imdbId?: string;
  anilistId?: number;
  title?: string | null;
  year?: number | null;
}): Promise<AwardsResponse> {
  const search = new URLSearchParams();
  // Invalida respuestas que el WebView/CDN guardó con la política anterior.
  search.set("v", "2");
  if (params.type) search.set("type", params.type);
  if (params.tmdbId) search.set("tmdbId", String(params.tmdbId));
  if (params.imdbId) search.set("imdbId", params.imdbId);
  if (params.anilistId) search.set("anilistId", String(params.anilistId));

  const url = `${API_BASE}/api/awards/media?${search.toString()}`;
  const startedAt = performance.now();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Accept": "application/json" },
      cache: "no-cache",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    logAwardsError("fallo de red en media", error);
    throw error;
  }

  const durationMs = Math.round(performance.now() - startedAt);

  if (!res.ok) {
    const error = new Error(`Awards API HTTP ${res.status}`);
    logAwardsError(`HTTP ${res.status} en media`, error);
    throw error;
  }

  const payload = await res.json() as AwardsResponse;

  const warnings: string[] = [];
  for (const [ceremony, coverage] of Object.entries(payload.relevantCoverage ?? {})) {
    if (coverage.pendingEditions.length > 0) warnings.push(`${ceremony}: ${coverage.pendingEditions.length} ediciones pendientes de importar`);
    if (coverage.gapEditions.length > 0) warnings.push(`${ceremony}: ${coverage.gapEditions.length} ediciones sin archivo`);
  }
  const ceremonyCount = new Set(payload.records.map(record => record.ceremony)).size;

  const byCeremony = new Map<string, { records: number; editions: number[]; statuses: Record<string, number> }>();
  for (const record of payload.records) {
    const key = `${record.ceremony} ${record.awardYear}`;
    const entry = byCeremony.get(key) ?? { records: 0, editions: [], statuses: {} };
    entry.records += 1;
    if (record.edition != null && !entry.editions.includes(record.edition)) entry.editions.push(record.edition);
    entry.statuses[record.status] = (entry.statuses[record.status] ?? 0) + 1;
    byCeremony.set(key, entry);
  }
  const breakdown = [...byCeremony.entries()]
    .map(([key, entry]) => ({
      ceremonia: key,
      registros: entry.records,
      ediciones: entry.editions.sort((a, b) => b - a),
      estados: entry.statuses,
    }))
    .sort((a, b) => b.registros - a.registros);

  logAwards(`media ${search.get("tmdbId") ?? search.get("imdbId") ?? search.get("anilistId")}`, [
    ["identidad recibida", { type: params.type ?? null, tmdbId: params.tmdbId ?? null, imdbId: params.imdbId ?? null, anilistId: params.anilistId ?? null }],
    ["obra original", { title: params.title ?? null, year: params.year ?? null }],
    [`GET ${new URL(url).pathname}${new URL(url).search}`, `HTTP ${res.status} · ${durationMs} ms · cache ${res.headers.get("Cache-Control") ?? "n/a"}`],
    ["resolución", { status: payload.resolution.status, workKey: payload.resolution.workKey, matchedTitle: payload.resolution.matchedTitle ?? null, matchedYear: payload.resolution.matchedYear ?? null, reason: payload.reason ?? null }],
    ["registros", `${payload.records.length} registros en ${ceremonyCount} ceremonias`],
    ["desglose", breakdown],
    ["cobertura relevante", payload.relevantCoverage ?? {}],
    ...(warnings.length > 0 ? [["advertencias", warnings] as [string, unknown]] : []),
  ]);

  return payload;
}

async function fetchPersonAwards(params: {
  tmdbId: number | null;
  imdbId: string | null;
  wikidataId: string | null;
  anilistStaffId: number | null;
  name: string;
  aliases: string[];
}): Promise<AwardPersonResponse> {
  const search = new URLSearchParams({ v: "2" });
  if (params.tmdbId !== null) search.set("tmdbId", String(params.tmdbId));
  if (params.imdbId) search.set("imdbId", params.imdbId);
  if (params.wikidataId) search.set("wikidataId", params.wikidataId);
  if (params.anilistStaffId !== null) search.set("anilistStaffId", String(params.anilistStaffId));

  const url = `${API_BASE}/api/awards/person?${search.toString()}`;
  const startedAt = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-cache",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    logAwardsError("fallo de red en person", error);
    throw error;
  }
  const durationMs = Math.round(performance.now() - startedAt);
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!res.ok || !contentType.toLowerCase().includes("application/json")) {
    const error = new Error(!res.ok
      ? res.status >= 500 ? "El servicio de premiaciones no está disponible temporalmente." : "No se pudieron consultar las premiaciones."
      : "El servicio de premiaciones devolvió una respuesta inválida.");
    logAwardsError(`HTTP ${res.status} en person`, error);
    throw error;
  }
  const payload = await res.json() as AwardPersonResponse;
  logAwards(`person ${params.tmdbId ?? params.name}`, [
    ["identidad recibida", { tmdbId: params.tmdbId, name: params.name, aliases: params.aliases }],
    [`GET ${new URL(url).pathname}${new URL(url).search}`, `HTTP ${res.status} · ${durationMs} ms · cache ${res.headers.get("Cache-Control") ?? "n/a"}`],
    ["resolución", payload.resolution],
    ["registros", `${payload.records.length} premios`],
  ]);
  return payload;
}

function useAwardsQuery(
  type: string | null,
  tmdbId: number | null,
  imdbId: string | null,
  anilistId: number | null,
  enabled: boolean,
  title?: string | null,
  year?: number | null,
): AwardsData {
  const mediaType = type ? toMediaType(type) : null;
  const query = useQuery({
    queryKey: ["awards", "media", "v2", mediaType, tmdbId, imdbId, anilistId],
    queryFn: () => fetchMediaAwards({
      type: mediaType ?? undefined,
      tmdbId: tmdbId ?? undefined,
      imdbId: imdbId ?? undefined,
      anilistId: anilistId ?? undefined,
      title: title ?? null,
      year: year ?? null,
    }),
    enabled: enabled && (tmdbId !== null || Boolean(imdbId) || anilistId !== null),
    staleTime: (currentQuery) => {
      const payload = currentQuery.state.data;
      if (!payload || payload.records.length === 0 || payload.resolution.status !== "resolved") return 0;
      return 1000 * 60 * 60;
    },
    gcTime: 1000 * 60 * 60 * 24 * 30,
    refetchOnMount: (currentQuery) => {
      const payload = currentQuery.state.data;
      return !payload || payload.records.length === 0 || payload.resolution.status !== "resolved" ? "always" : false;
    },
    refetchOnWindowFocus: (currentQuery) => {
      const payload = currentQuery.state.data;
      return !payload || payload.records.length === 0 || payload.resolution.status !== "resolved";
    },
    refetchOnReconnect: true,
    retry: 1,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  });
  const data = query.data;
  return {
    records: data?.records ?? [],
    featured: data?.featured ?? null,
    coverage: data?.coverage ?? null,
    reason: data?.reason ?? null,
    matched: data?.matched ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    errorMessage: query.error instanceof Error ? query.error.message : query.error ? "No se pudieron cargar las premiaciones." : null,
    resolutionStatus: data?.resolution.status ?? null,
    retry: () => { void query.refetch(); },
  };
}

/** Detail: consulta por TMDB id (con imdb/anilist opcionales para matchear mejor). */
export function useAwardsByTmdbId(
  type: string,
  tmdbId: number | null,
  enabled: boolean,
  imdbId?: string | null,
  anilistId?: number | null,
  title?: string | null,
  year?: number | null,
): AwardsData {
  return useAwardsQuery(
    type || null,
    tmdbId,
    typeof imdbId === "string" && imdbId.length > 0 ? imdbId : null,
    anilistId ?? null,
    enabled,
    title,
    year,
  );
}

/** Página de persona: premios en los que aparece como destinatario. */
export function usePersonAwards(
  tmdbId: number | null,
  name: string,
  aliases: string[] = [],
  enabled = true,
  external?: { imdbId?: string | null; wikidataId?: string | null; anilistStaffId?: number | null },
): PersonAwardsData {
  const cleanName = name.trim();
  const cleanAliases = [...new Set(aliases.map(alias => alias.trim()).filter(alias => alias && alias !== cleanName))].slice(0, 7);
  const query = useQuery({
    queryKey: ["awards", "person", "v2", tmdbId, external?.imdbId ?? null, external?.wikidataId ?? null, external?.anilistStaffId ?? null],
    queryFn: () => fetchPersonAwards({ tmdbId, imdbId: external?.imdbId ?? null, wikidataId: external?.wikidataId ?? null, anilistStaffId: external?.anilistStaffId ?? null, name: cleanName, aliases: cleanAliases }),
    enabled: enabled && (tmdbId !== null || Boolean(external?.imdbId) || Boolean(external?.wikidataId) || external?.anilistStaffId != null),
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 24 * 30,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: (attempt: number) => Math.min(1000 * 2 ** attempt, 5000),
  });
  return {
    records: query.data?.records ?? [],
    resolutionStatus: query.data?.resolution.status ?? null,
    reason: query.data?.resolution.reason ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    errorMessage: query.error instanceof Error ? query.error.message : query.error ? "No se pudieron cargar los premios de la persona." : null,
    retry: () => { void query.refetch(); },
  };
}

/** Hero y back-compat: identifier crudo ("tmdb:123" o "tt000000"). */
export function useAwards(type: string, mediaId: string, enabled: boolean): AwardsData {
  const parsed = parseMediaId(mediaId);
  return useAwardsQuery(
    type || null,
    parsed?.tmdbId ?? null,
    parsed?.imdbId ?? null,
    null,
    enabled && parsed !== null,
  );
}
