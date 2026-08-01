// Parser del archivo del Festival de Cannes (festival-cannes.com/en/retrospective/awards/).
// Palmarés por edición + selecciones oficiales en página aparte.

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "cannes";
// The 79th edition (2026) has not published its palmarès yet; the latest
// importable official dataset is the 78th edition (2025).
const LATEST_YEAR = 2025;

const DICTIONARY: Record<string, string> = {
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
};

function cannesEditionYears(): Array<{ edition: number; year: number; coverage: "complete" | "partial" }> {
  const years: Array<{ edition: number; year: number; coverage: "complete" | "partial" }> = [];
  let edition = 0;
  for (let year = 1946; year <= LATEST_YEAR; year += 1) {
    if (year === 1948 || year === 1950) continue; // no se celebró
    edition += 1;
    years.push({
      edition,
      year,
      coverage: year === 2020 ? "partial" : "complete", // 2020 cancelada: sin archivo
    });
  }
  return years;
}

export const cannesParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    return cannesEditionYears().map(item => ({
      edition: item.edition,
      awardYear: item.year,
      coverage: item.coverage,
      url: `https://www.festival-cannes.com/en/retrospective/awards/${item.year}/`,
    }));
  },

  recentEditions() {
    const years = cannesEditionYears();
    return [
      { ceremony: CEREMONY, edition: years[years.length - 1].edition },
      { ceremony: CEREMONY, edition: years[years.length - 2].edition },
    ];
  },

  gapEditions() {
    // 2020: festival cancelado (COVID-19); sin archivo que importar.
    const spec = cannesEditionYears().find(item => item.year === 2020);
    return spec ? [{ edition: spec.edition, awardYear: 2020, type: "canceled" as const }] : [];
  },

  extraSource(edition: number): string | null {
    const spec = cannesEditionYears().find(item => item.edition === edition);
    return spec ? `https://www.festival-cannes.com/en/retrospective/official-selections/${spec.year}/` : null;
  },

  parseEdition(html: string, meta: ParserMeta, extra?: { url: string; html: string }): ParsedEdition {
    const $ = loadHtml(html);
    const sections = walkSections($, "h2, h3", "li");
    const records = recordsFromSections(sections, meta, {
      ceremony: CEREMONY,
      dictionary: DICTIONARY,
      defaultStatus: "winner",
      personCategories: true,
    });

    if (extra) {
      const $extra = loadHtml(extra.html);
      const selectionSections = walkSections($extra, "h2, h3, h4", "li");
      const selections = recordsFromSections(selectionSections, meta, {
        ceremony: CEREMONY,
        dictionary: DICTIONARY,
        defaultStatus: "official_selection",
        selections: true,
        keepSection: true,
      });
      records.push(...selections);
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
