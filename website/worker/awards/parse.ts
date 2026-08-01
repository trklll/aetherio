// Utilidades compartidas por los parsers de cada ceremonia.
// Los parsers son tolerantes a cambios menores de HTML: usan selectores
// semánticos con fallbacks y marcadores de texto, no clases concretas.

import type { AwardStatus, AwardSubject } from "./types";

export function cleanText(el: { text?: () => string; children?: () => unknown } | null | undefined): string {
  if (!el || typeof el.text !== "function") return "";
  return String(el.text() ?? "").replace(/\s+/g, " ").trim();
}

export function cleanLines(el: { find?: (sel: string) => { each: (fn: (i: number, node: unknown) => void) => void; toArray: () => unknown[]; map?: (fn: (i: number, node: unknown) => unknown) => unknown[] } } | null | undefined): string[] {
  if (!el || typeof el.find !== "function") return [];
  const lines: string[] = [];
  el.find("li, tr, .nominee, .winner, [class*='nominee'], [class*='winner'], .title, .work").each((_i, node: unknown) => {
    const text = cleanText(node as { text?: () => string });
    if (text) lines.push(text);
  });
  return dedupeLines(lines);
}

export function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function firstTextMatch(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function hasAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some(needle => lower.includes(needle.toLowerCase()));
}

const WINNER_MARKERS = [
  "ganadora", "ganador", "ganada", "ganadas", "ganados", "ganó", "ganado",
  "winner", "won", "wins", "受賞", "最優秀", "winners", "galardonada",
  "galardonado", "palme d'or", "leone d'oro", "león de oro", "löwe",
  "official awards",
];

const NOMINEE_MARKERS = [
  "nominada", "nominado", "nominación", "nominee", "nominated", "nomination",
  "提名", "優秀", "candidata", "candidato", "shortlist",
];

/** Detecta estado a partir de texto de marcado (etiquetas, badges, prefijos). */
export function detectStatus(
  text: string,
  winners = WINNER_MARKERS,
  nominees = NOMINEE_MARKERS,
): AwardStatus | null {
  if (hasAny(text, winners)) return "winner";
  if (hasAny(text, nominees)) return "nominee";
  return null;
}

export function stripStatusMarkers(text: string): string {
  return text
    .replace(/\b(won|winner|winners|nominated|nominee|nominations?)\b/gi, " ")
    .replace(/\b(ganadora|ganador|ganadas?|ganados?|ganó|ganado|nominada|nominado|nominación)\b/gi, " ")
    .replace(/(^|\s)(受賞|提名|優秀)(?=\s|$)/g, " ")
    .replace(/[★☆✔✓●►▶]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s:…—–-]+/, "")
    .trim();
}

export function removeParentheticalSeason(text: string): string {
  return text.replace(/\s*\([^)]*(?:season|temporada|edición|edicion|cour|part)[^)]*\)/gi, " ").replace(/\s+/g, " ").trim();
}

/** Limpia desambiguadores editoriales que no forman parte del título canónico. */
export function cleanWorkTitle(text: string): string {
  return removeParentheticalSeason(String(text ?? ""))
    .replace(/[†‡]+\s*$/g, "")
    .replace(/\s*\((?:HBO|HBO Max|Max|AMC|Netflix|FX|ABC|CBS|NBC|Hulu|Apple TV\+?|Disney\+?|Amazon|Prime Video|PBS|Showtime|Comedy Central|Adult Swim|Cartoon Network|MTV|TBS|TLC|A&E|Food Network|Bravo|VH1|E!|Lifetime|National Geographic|Paramount\+?)\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae el año de estreno si aparece en el texto de la obra. */
export function extractYear(text: string): number | undefined {
  const match = /(?:\(((?:19|20)\d{2})\)|\s[-–—]\s*((?:19|20)\d{2}))\s*$/.exec(String(text ?? "").trim());
  if (!match) return undefined;
  const year = Number(match[1] ?? match[2]);
  if (year < 1900 || year > 2100) return undefined;
  return year;
}

// ---------------------------------------------------------------------------
// Clasificación de categorías en subject (obra/persona/episodio/canción/técnica)
// ---------------------------------------------------------------------------

const PERSON_PATTERNS = [
  /\b(?:best\s+)?(?:actor|actress|performer|performance|director|directing|screenplay|screenwriter|writer|writing|showrunner)\b/i,
  /\b(?:mejor\s+)?(?:actor|actriz|reparto|interpretación|interpretacion|dirección|direccion|director|guion|guionista)\b/i,
  /\b(?:voice|director|writer|score)\s+(?:actor|performance|award)\b/i,
  /\b(主演|助演|監督|脚本|主演男優|主演女優|助演男優|助演女優)\b/,
];

const EPISODE_PATTERNS = [
  /\b(?:best\s+)?episode\b/i,
  /\b(?:mejor\s+)?episodio\b/i,
  /\b(話|ep)\b/,
];

const SONG_PATTERNS = [
  /\b(?:original\s+)?song\b/i,
  /\b(?:original\s+)?canción\b/i,
  /\b(?:cançã|canción)\b/i,
  /\b(?:best\s+)?(?:opening|ending)\b/i,
  /\b主題歌|挿入歌|opening theme|ending theme\b/i,
];

const TECHNICAL_PATTERNS = [
  /\b(?:cinematography|photography|editing|sound|visual effects|production design|art direction|makeup|hair|costume|wardrobe|animation|character design|compositing|score|music)\b/i,
  /\b(?:fotografía|fotografia|montaje|sonido|efectos|diseño de producción|produccion|dirección de arte|direccion de arte|maquillaje|vestuario|diseño de caracteres|banda sonora|música|musica)\b/i,
  /\b(撮影|編集|美術|録音|音響|視覚効果|キャラクターデザイン|音楽)\b/,
];

export function classifySubject(category: string): AwardSubject {
  if (!category) return "work";
  if (SONG_PATTERNS.some(pattern => pattern.test(category))) return "song";
  if (EPISODE_PATTERNS.some(pattern => pattern.test(category))) return "episode";
  if (PERSON_PATTERNS.some(pattern => pattern.test(category))) return "person";
  if (TECHNICAL_PATTERNS.some(pattern => pattern.test(category))) return "technical";
  return "work";
}

/** Traduce categoría conocida al español; si no está, conserva el original. */
export function translateCategory(category: string, dictionary: Record<string, string>): string {
  const exact = dictionary[category.trim()];
  if (exact) return exact;
  const normalized = category.trim().toLowerCase();
  const found = Object.keys(dictionary).find(key => key.toLowerCase() === normalized);
  return found ? dictionary[found] : category.trim();
}

export interface ParseResult {
  categoryOriginal: string;
  categoryEs: string;
  workTitle: string;
  workYear?: number;
  recipients: string[];
  status: AwardStatus;
  subject: AwardSubject;
  section?: string;
}

/** Convierte una fila textual de nominado en un resultado parcial de parseo. */
export function rowToRecord(
  category: string,
  rowText: string,
  status: AwardStatus,
  dictionary: Record<string, string>,
  extra?: Partial<ParseResult>,
): ParseResult | null {
  const clean = stripStatusMarkers(rowText).replace(/^[-•·*]+/, "").trim();
  if (!clean) return null;
  const workYear = extractYear(clean);
  const categoryOriginal = category.trim();
  return {
    categoryOriginal,
    categoryEs: translateCategory(categoryOriginal, dictionary),
    workTitle: clean,
    workYear,
    recipients: [],
    status,
    subject: classifySubject(categoryOriginal),
    ...extra,
  };
}
