// Parser del archivo del Festival de Mar del Plata
// (mardelplatafilmfest.com, ediciones anteriores). Palmarés + selección oficial.

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "mar_del_plata";

const DICTIONARY: Record<string, string> = {
  "Astor de Oro": "Astor de Oro a la Mejor Película",
  "Premio Especial del Jurado": "Premio Especial del Jurado",
  "Mejor Dirección": "Mejor Dirección",
  "Mejor Interpretación Masculina": "Mejor Interpretación Masculina",
  "Mejor Interpretación Femenina": "Mejor Interpretación Femenina",
  "Mejor Guion": "Mejor Guion",
  "Mejor Fotografía": "Mejor Fotografía",
  "Premio del Público": "Premio del Público",
  "Premio a la Mejor Película Latinoamericana": "Mejor Película Latinoamericana",
};

// Ediciones irregulares: 1954, 1959-1970, pausa hasta 1996, 2020 cancelada.
const EDITION_YEARS: Array<[number, number, "complete" | "partial"]> = [
  [1, 1954, "complete"],
  [2, 1959, "complete"],
  [3, 1960, "complete"],
  [4, 1961, "complete"],
  [5, 1962, "complete"],
  [6, 1963, "complete"],
  [7, 1964, "complete"],
  [8, 1965, "complete"],
  [9, 1966, "complete"],
  [10, 1967, "complete"],
  [11, 1968, "complete"],
  [12, 1970, "complete"],
  [13, 1996, "complete"],
  [14, 1997, "complete"],
  [15, 1998, "complete"],
  [16, 1999, "complete"],
  [17, 2000, "complete"],
  [18, 2001, "complete"],
  [19, 2002, "complete"],
  [20, 2003, "complete"],
  [21, 2004, "complete"],
  [22, 2005, "complete"],
  [23, 2006, "complete"],
  [24, 2007, "complete"],
  [25, 2008, "complete"],
  [26, 2009, "complete"],
  [27, 2010, "complete"],
  [28, 2011, "complete"],
  [29, 2012, "complete"],
  [30, 2013, "complete"],
  [31, 2014, "complete"],
  [32, 2015, "complete"],
  [33, 2016, "complete"],
  [34, 2017, "complete"],
  [35, 2018, "complete"],
  [36, 2019, "complete"],
  [37, 2020, "partial"],
  [38, 2023, "complete"],
  [39, 2024, "complete"],
  [40, 2025, "complete"],
  [41, 2026, "complete"],
];

export const marDelPlataParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    return EDITION_YEARS.map(([edition, year, coverage]) => ({
      edition,
      awardYear: year,
      coverage,
      url: `https://mardelplatafilmfest.com/${edition}/es/premios-independientes-todas-las-ganadoras-2/`,
    }));
  },

  recentEditions() {
    const last = EDITION_YEARS[EDITION_YEARS.length - 1];
    return [
      { ceremony: CEREMONY, edition: last[0] },
      { ceremony: CEREMONY, edition: EDITION_YEARS[EDITION_YEARS.length - 2][0] },
    ];
  },

  gapEditions() {
    // 2020 (ed. 37): festival cancelado por la pandemia; sin archivo.
    const noArchive = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 38, 41]
      .map(edition => ({ edition, awardYear: EDITION_YEARS.find(item => item[0] === edition)?.[1] ?? 0, type: "no_archive" as const }));
    return [{ edition: 37, awardYear: 2020, type: "canceled" as const }, ...noArchive];
  },

  extraSource(edition: number): string | null {
    // Selection pages are not consistently archived in the current CMS; do
    // not make a valid palmarès import fail on a missing optional page.
    return null;
  },

  parseEdition(html: string, meta: ParserMeta, extra?: { url: string; html: string }): ParsedEdition {
    const $ = loadHtml(html);
    const realSections: Array<{ category: string; items: Array<{ text: string; status: "winner" }> }> = [];
    $(".entry-content").each((_entryIndex, entry) => {
      $(entry).find("p").each((_pIndex, paragraph) => {
        const nodes = $(paragraph).find("strong, em").toArray();
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index];
          if ($(node).prop("tagName")?.toString().toLowerCase() !== "strong" || $(node).closest("em").length > 0) continue;
          const category = $(node).text().replace(/\s+/g, " ").trim();
          if (!/premio|mención|mencion|voto del público|astor|martínez|banco|alta definición/i.test(category)) continue;
          let work = "";
          for (let next = index + 1; next < nodes.length; next += 1) {
            if ($(nodes[next]).prop("tagName")?.toString().toLowerCase() === "em") {
              work = $(nodes[next]).text().replace(/\s+/g, " ").trim();
              break;
            }
            if ($(nodes[next]).closest("em").length === 0 && $(nodes[next]).prop("tagName")?.toString().toLowerCase() === "strong") break;
          }
          if (!work) continue;
          const existing = realSections.find(section => section.category === category);
          if (existing) existing.items.push({ text: work, status: "winner" });
          else realSections.push({ category, items: [{ text: work, status: "winner" }] });
        }
      });
    });
    const sections = realSections.length > 0 ? realSections : walkSections($, "h2, h3, h4", "li");
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
