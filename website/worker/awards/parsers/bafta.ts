// Parser del archivo oficial de BAFTA (bafta.org/awards/film/).

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "bafta";
const LATEST_EDITION = 79; // 79.ª ceremonia, 2026

const DICTIONARY: Record<string, string> = {
  "Best Film": "Mejor Película",
  "Outstanding British Film": "Mejor Película Británica",
  "Outstanding Debut by a British Writer, Director or Producer": "Mejor Ópera Prima Británica",
  "Best Director": "Mejor Director",
  "Best Leading Actor": "Mejor Actor Protagónico",
  "Best Leading Actress": "Mejor Actriz Protagónica",
  "Best Supporting Actor": "Mejor Actor de Reparto",
  "Best Supporting Actress": "Mejor Actriz de Reparto",
  "Best Original Screenplay": "Mejor Guion Original",
  "Best Adapted Screenplay": "Mejor Guion Adaptado",
  "Best Cinematography": "Mejor Fotografía",
  "Best Editing": "Mejor Montaje",
  "Best Production Design": "Mejor Diseño de Producción",
  "Best Costume Design": "Mejor Diseño de Vestuario",
  "Best Make Up & Hair": "Mejor Maquillaje y Peluquería",
  "Best Sound": "Mejor Sonido",
  "Best Special Visual Effects": "Mejores Efectos Visuales",
  "Best Original Score": "Mejor Banda Sonora Original",
  "Best Casting": "Mejor Reparto (Casting)",
  "Best Documentary": "Mejor Documental",
  "Best Animated Film": "Mejor Película de Animación",
  "Best Film Not in the English Language": "Mejor Película en Lengua No Inglesa",
  "EE Rising Star Award": "Premio Estrella Emergente",
};

export const baftaParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: edition + 1947,
        coverage: "complete",
        url: `https://www.bafta.org/awards/film/${edition + 1947}`,
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

  // El archivo histórico de BAFTA no ofrece fichas parseables para estas
  // ceremonias; se registran como huecos explícitos y no como reintentos.
  gapEditions() {
    const editions = [3, 4, 5, 18, 19, 20, 21, 22, 23, 24, 25];
    return editions.map(edition => ({ edition, awardYear: edition + 1947, type: "no_archive" as const }));
  },

  parseEdition(html: string, meta: ParserMeta): ParsedEdition {
    const sections = walkSections(loadHtml(html), "h2, h3", "li");
    const records = recordsFromSections(sections, meta, {
      ceremony: CEREMONY,
      dictionary: DICTIONARY,
      defaultStatus: "nominee",
      personCategories: true,
    });
    return {
      ceremony: CEREMONY,
      edition: meta.edition,
      awardYear: meta.awardYear,
      coverage: meta.coverage,
      records,
    };
  },
};
