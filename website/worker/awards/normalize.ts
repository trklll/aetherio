// Normalización de títulos para claves estables y comparaciones exactas.
// Siempre se conserva el texto original en los registros; esto solo produce
// claves de comparación. No hay coincidencia difusa en ningún punto.

export interface SeasonEpisode {
  season: number | null;
  episode: number | null;
}

const SEASON_PATTERNS = [
  /\bseason\s+(\d{1,3})\b/i,
  /\btemporada\s+(\d{1,3})\b/i,
  /\bs(\d{1,3})e(\d{1,3})\b/i,
  /\bs(\d{1,3})\b/i,
  /第\s*(\d{1,3})\s*期/i,
];

const EPISODE_PATTERNS = [
  /\bepisode\s+(\d{1,3})\b/i,
  /\bep\s+(\d{1,3})\b/i,
  /\bs\d{1,3}e(\d{1,3})\b/i,
  /\be(\d{1,3})\b/i,
  /\bcap[ií]tulo\s+(\d{1,3})\b/i,
  /第\s*(\d{1,3})\s*話/i,
];

export function extractSeasonEpisode(raw: string): SeasonEpisode {
  const value = String(raw ?? "").normalize("NFKC");
  let season: number | null = null;
  let episode: number | null = null;
  for (const pattern of SEASON_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      season = Number(match[1]);
      break;
    }
  }
  for (const pattern of EPISODE_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      episode = Number(match[1]);
      break;
    }
  }
  return { season, episode };
}

/** Deja solo [a-z0-9] más kana/kanji, sin diacríticos ni apóstrofos. */
function baseNormalized(value: string): string {
  return value
    .replace(/[\u00C0-\u024F]/g, ch => ch.normalize("NFD")[0] ?? ch)
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quita marcadores de temporada/episodio del título base. */
function stripSeasonEpisodeTokens(value: string): string {
  return value
    .replace(/\bs\d{1,3}e\d{1,3}\b/gi, " ")
    .replace(/\bseason\s+\d{1,3}\b/gi, " ")
    .replace(/\btemporada\s+\d{1,3}\b/gi, " ")
    .replace(/\bs\d{1,3}\b/gi, " ")
    .replace(/\bepisode\s+\d{1,3}\b/gi, " ")
    .replace(/\bep\s+\d{1,3}\b/gi, " ")
    .replace(/\be\d{1,3}\b/gi, " ")
    .replace(/\bcap[ií]tulo\s+\d{1,3}\b/gi, " ")
    .replace(/第\s*\d{1,3}\s*期/g, " ")
    .replace(/第\s*\d{1,3}\s*話/g, " ")
    .replace(/[「」『』（）()\[\]【】・、。!?！？]/g, " ");
}

/**
 * Normaliza un título a clave estable: minúsculas, NFKC (variantes
 * japonesas de ancho completo), sin diacríticos/apóstrofos/puntuación y
 * con temporada/episodio como sufijo canónico (`s2`, `e3`).
 */
export function normalizeTitle(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const nfkc = value.normalize("NFKC").toLowerCase();
  const { season, episode } = extractSeasonEpisode(nfkc);
  const base = baseNormalized(stripSeasonEpisodeTokens(nfkc));
  if (!base) return "";
  let key = base;
  if (season !== null) key = `${key} s${season}`;
  if (episode !== null) key = `${key} e${episode}`;
  return key;
}

/**
 * Clave estable de identidad de una obra (para media links y aliases).
 * Incluye el año cuando se conoce: obras homónimas de años distintos no
 * comparten identidad ("A Star Is Born" 1976 vs 2018 no se mezclan).
 */
export function workKey(workTitle: string, workYear?: number | null): string {
  const base = normalizeTitle(workTitle);
  if (!base) return "";
  const year = Number(workYear);
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? `${base} [${year}]` : base;
}

/** Clave de importación idempotente: ceremony + edition + category + status + work + recipients. */
export function makeImportKey(input: {
  ceremony: string;
  edition: number | null;
  category: string;
  status: string;
  workTitle: string;
  recipients: string[];
}): string {
  const recipients = [...input.recipients].map(recipient => normalizeTitle(recipient)).sort();
  return JSON.stringify([
    input.ceremony,
    input.edition,
    normalizeTitle(input.category),
    input.status,
    normalizeTitle(input.workTitle),
    recipients,
  ]);
}

/** Compara dos títulos por clave normalizada. */
export function titlesEqual(left: string, right: string): boolean {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  return a.length > 0 && a === b;
}

/** Normaliza "Oscar"/"Óscar" y otras variantes de nombres propios. */
export function normalizeName(raw: string): string {
  return normalizeTitle(raw);
}
