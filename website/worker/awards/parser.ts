// Marco de parsers de ceremonias: contrato + construcción de registros.

import type {
  AwardCeremony,
  AwardCoverage,
  AwardStatus,
  AwardSubject,
  ParsedEdition,
  ParsedRecord,
  SourceTier,
} from "./types";
import type { Section } from "./sections";
import { stripStatusMarkers, extractYear, classifySubject, translateCategory, cleanWorkTitle } from "./parse";

export interface EditionSpec {
  edition: number;
  awardYear: number;
  coverage: AwardCoverage;
  url: string;
}

export interface ParserMeta {
  ceremony: AwardCeremony;
  edition: number;
  awardYear: number;
  url: string;
  coverage: AwardCoverage;
}

export interface ExtraSource {
  url: string;
}

export type GapType = "canceled" | "no_archive" | "blocked";

export interface GapEdition {
  edition: number;
  awardYear: number;
  type: GapType;
}

export interface CeremonyParser {
  ceremony: AwardCeremony;
  archiveEditions(): EditionSpec[];
  recentEditions(now?: Date): Array<{ ceremony: AwardCeremony; edition: number }>;
  parseEdition(html: string, meta: ParserMeta, extra?: { url: string; html: string }): ParsedEdition;
  extraSource?(edition: number): string | null;
  /** Ediciones sin archivo publicable: canceladas, inexistentes o bloqueadas. */
  gapEditions?(): GapEdition[];
}

export function parseEditionOrThrow(
  parser: CeremonyParser,
  html: string,
  meta: ParserMeta,
  extra?: { url: string; html: string },
): ParsedEdition {
  if (meta.ceremony !== parser.ceremony) {
    throw new Error(`El parser de ${parser.ceremony} no admite la ceremonia ${meta.ceremony}.`);
  }
  const result = parser.parseEdition(html, meta, extra);
  if (result.ceremony !== parser.ceremony) {
    throw new Error(`El parser de ${parser.ceremony} devolvió otra ceremonia.`);
  }
  return result;
}

/** Quita el sufijo " as Personaje" de una obra ("Reversal of Fortune as Claus von Bülow"). */
function cleanWorkSuffix(raw: string): string {
  const out = raw.trim();
  if (!out || /^as\s/i.test(out)) return out;
  return out.split(/\s+as\s+/i)[0].trim();
}

/** Divide filas de categorías personales: "Nombre — Título", "Nombre (Título)", "Nombre como Personaje". */
export function splitPersonRow(raw: string): { recipients: string[]; workTitle: string } {
  const cleaned = stripStatusMarkers(raw).replace(/^[-•·*–—\s]+/, "").trim();
  if (!cleaned) return { recipients: [], workTitle: "" };

  const paren = /^(.*?)\s*\(([^()]+)\)$/.exec(cleaned);
  if (paren) {
    const recipient = paren[1].trim();
    let work = paren[2].trim();
    if (/\b(?:as|como)\b/i.test(work)) {
      work = cleanWorkSuffix(work);
    }
    return { recipients: [recipient], workTitle: work };
  }

  const dash = /^(.*?)\s*[–—-]\s*(.+)$/.exec(cleaned);
  if (dash) {
    const left = dash[1].trim();
    const right = dash[2].trim();
    const leftWords = left.split(/\s+/).length;
    const rightWords = right.split(/\s+/).length;
    // Persona primero si la izquierda parece un nombre (≥2 palabras, sin
    // artículo) o la derecha es una sola palabra ("Cher – Burlesque").
    // En cambio "Goodfellas – Nicholas Pileggi and Martin Scorsese" es obra
    // primero: los destinatarios van a la derecha (recortando "from Libro by...").
    const leftIsPerson = (leftWords >= 2 && !/\b(the|a|an|el|la|los|las|un|una)\b/i.test(left)) || rightWords === 1;
    return leftIsPerson
      ? { recipients: [left], workTitle: cleanWorkSuffix(right) }
      : { recipients: right.split(/\s+from\s+/i)[0].split(/\s+and\s+/i).map(name => name.trim()).filter(Boolean), workTitle: left };
  }

  if (/\b(?:as|como)\b/i.test(cleaned)) {
    const parts = cleaned.split(/\s+as\s+|\s+como\s+/i);
    const left = parts[0].trim();
    if (left.split(/\s+/).length === 1) return { recipients: [], workTitle: left };
    return { recipients: [left], workTitle: left };
  }

  return { recipients: [cleaned], workTitle: cleaned };
}

export interface RecordsOptions {
  ceremony: AwardCeremony;
  dictionary?: Record<string, string>;
  /** Estado cuando un ítem no trae marcador (palmarés = winner, listas = nominee). */
  defaultStatus: AwardStatus;
  /** Categorías cuyo sujeto se fuerza (evita heurísticas). */
  subjectOverrides?: Record<string, AwardSubject>;
  /** Divide la fila como categoría personal (destinatarios vs obra). */
  personCategories?: boolean;
  /** Mantiene la sección del festival en cada registro. */
  keepSection?: boolean;
  /** Indica que los ítems son selecciones oficiales (festival). */
  selections?: boolean;
  /** Etiqueta de procedencia de la fuente (Wikipedia/verificada = secondary). */
  sourceTier?: SourceTier;
}

/** Año de la obra cuando el texto no lo declara: los festivales premian obras
 * del mismo año; el resto de ceremonias, del año anterior (Oscar 63 → 1990). */
function fallbackWorkYear(ceremony: AwardCeremony, awardYear: number): number {
  return ceremony === "cannes" || ceremony === "venice" || ceremony === "mar_del_plata" ? awardYear : awardYear - 1;
}

/** Convierte secciones del archivo oficial en registros de importación. */
export function recordsFromSections(sections: Section[], meta: ParserMeta, options: RecordsOptions): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  const subjectOverrides = options.subjectOverrides ?? {};

  for (const section of sections) {
    const categoryOriginal = section.category;
    if (!categoryOriginal) continue;
    const baseSubject = subjectOverrides[categoryOriginal] ?? classifySubject(categoryOriginal);
    const categoryEs = options.dictionary ? translateCategory(categoryOriginal, options.dictionary) : categoryOriginal;

    for (const item of section.items) {
      const status: AwardStatus = options.selections
        ? "official_selection"
        : (item.status ?? options.defaultStatus);
      let workTitle = stripStatusMarkers(item.text).replace(/^[-•·*–—\s]+/, "").trim();
      if (!workTitle) continue;
      const extractedYear = extractYear(workTitle);
      const workYear = extractedYear ?? fallbackWorkYear(meta.ceremony, meta.awardYear);
      if (extractedYear !== undefined) {
        workTitle = workTitle.replace(/\s*\(\s*(?:19|20)\d{2}\s*\)\s*$/, "").replace(/\s*-\s*(?:19|20)\d{2}\s*$/, "").trim();
      }

      let recipients: string[] = [];
      let subject = baseSubject;
      if (options.personCategories && (subject === "person" || subject === "song")) {
        const split = splitPersonRow(workTitle);
        recipients = split.recipients.filter(Boolean);
        workTitle = split.workTitle || workTitle;
      } else if (subject === "work" || subject === "episode" || subject === "technical") {
        // "Obra – Personas, roles" en categorías de obra: la obra va primero
        // ("Goodfellas – Irwin Winkler, producer" -> "Goodfellas"). La parte
        // derecha son recipients solo si no es un rol ("Thelma Schoonmaker",
        // "Nicholas Pileggi and Martin Scorsese from Wiseguy...").
        const dashMatch = /^(.*?)\s+[–—-]\s+(.+)$/.exec(workTitle);
        if (dashMatch) {
          const left = dashMatch[1].trim();
          const right = dashMatch[2].trim();
          workTitle = left;
          const roleSuffix = /\b(?:producers?|directors?|editors?|cinematographers?|screenplay|story)\b/i;
          if (right && !roleSuffix.test(right)) {
            const namesPart = right.split(/\s+from\s+/i)[0];
            recipients = namesPart.split(/\s+and\s+/i).map(name => name.trim().replace(/,$/, "")).filter(Boolean);
          }
        }
      }

      workTitle = cleanWorkTitle(workTitle);
      if (!workTitle) continue;

      records.push({
        categoryOriginal,
        categoryEs,
        status,
        subject,
        recipients,
        workTitle,
        workYear,
        section: options.keepSection ? section.category : undefined,
        sourceUrl: meta.url,
        sourceTier: options.sourceTier ?? "official",
      });
    }
  }
  return records;
}
