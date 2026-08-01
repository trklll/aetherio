// Parser del archivo de Crunchyroll Anime Awards (crunchyroll.com/animeawards).
// Combina la página de ganadores con los artículos anuales de nominados.

import type { AwardCeremony, AwardSubject, ParsedEdition, ParsedRecord } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "crunchyroll";
const LATEST_EDITION = 10; // 10.ª edición, 2026

const DICTIONARY: Record<string, string> = {
  "Anime of the Year": "Mejor Anime del Año",
  "Best Continuing Series": "Mejor Serie en Emisión",
  "Best New Series": "Mejor Serie Nueva",
  "Best Film": "Mejor Película",
  "Best Drama": "Mejor Drama",
  "Best Fantasy": "Mejor Fantasía",
  "Best Comedy": "Mejor Comedia",
  "Best Romance": "Mejor Romance",
  "Best Action": "Mejor Acción",
  "Best Director": "Mejor Dirección",
  "Best Character Design": "Mejor Diseño de Personajes",
  "Best Animation": "Mejor Animación",
  "Best Score": "Mejor Banda Sonora",
  "Best VA Performance": "Mejor Actuación de Voz",
  "Best Voice Artist Performance": "Mejor Actuación de Actor de Voz",
  "Best Opening Sequence": "Mejor Secuencia de Apertura",
  "Best Ending Sequence": "Mejor Secuencia de Cierre",
  "Best Anime Song": "Mejor Canción de Anime",
};

const SUBJECT_OVERRIDES: Record<string, AwardSubject> = {
  "Best Opening Sequence": "song",
  "Best Ending Sequence": "song",
  "Best Anime Song": "song",
  "Best VA Performance": "person",
  "Best Voice Artist Performance": "person",
  "Best Character Design": "technical",
  "Best Animation": "technical",
  "Best Score": "technical",
};

export const crunchyrollParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: 2016 + edition,
        coverage: "complete",
        url: `https://www.crunchyroll.com/animeawards/pastwinners`,
      });
    }
    return editions;
  },

  recentEditions() {
    return [
      { ceremony: CEREMONY, edition: LATEST_EDITION },
      { ceremony: CEREMONY, edition: LATEST_EDITION - 1 },
    ];
  },

  gapEditions() {
    return Array.from({ length: 6 }, (_, index) => ({ edition: index + 1, awardYear: index + 2017, type: "no_archive" as const }));
  },

  extraSource(edition: number): string | null {
    return `https://www.crunchyroll.com/news/announcements/2026/1/1/crunchyroll-anime-awards-${edition}${2016 + edition}-nominees`;
  },

  parseEdition(html: string, meta: ParserMeta, extra?: { url: string; html: string }): ParsedEdition {
    const $ = loadHtml(html);
    const sections = walkSections($, "h2, h3", "li, .winner, [class*='winner'], [class*='nominee']");
    let records = recordsFromSections(sections, meta, {
      ceremony: CEREMONY,
      dictionary: DICTIONARY,
      defaultStatus: "nominee",
      personCategories: true,
      subjectOverrides: SUBJECT_OVERRIDES,
    });

    if (extra) {
      const $extra = loadHtml(extra.html);
      const extraSections = walkSections($extra, "h2, h3, h4", "li");
      const extraRecords = recordsFromSections(extraSections, meta, {
        ceremony: CEREMONY,
        dictionary: DICTIONARY,
        defaultStatus: "nominee",
        personCategories: true,
        subjectOverrides: SUBJECT_OVERRIDES,
      });
      // Los artículos solo enumeran nominados: sin marcador explícito no hay
      // ganadoras duplicadas de la página oficial.
      const extraRecordsNoWinners: ParsedRecord[] = extraRecords.map(record =>
        record.status === "winner" ? ({ ...record, status: "nominee" as const }) : record,
      );
      records = mergeRecords(records, extraRecordsNoWinners);
    }

    return {
      ceremony: CEREMONY,
      edition: meta.edition,
      awardYear: meta.awardYear,
      coverage: meta.coverage,
      records,
    };
  },
};

function mergeRecords(primary: ParsedRecord[], secondary: ParsedRecord[]): ParsedRecord[] {
  const seen = new Set<string>();
  const out: ParsedRecord[] = [];
  for (const record of primary) {
    const key = JSON.stringify([record.categoryOriginal, record.workTitle.toLowerCase()]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  for (const record of secondary) {
    // Los artículos duplican ganadoras oficiales: se descartan sin importar el estado.
    const key = JSON.stringify([record.categoryOriginal, record.workTitle.toLowerCase()]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}
