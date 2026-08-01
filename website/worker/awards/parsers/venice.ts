// Parser del archivo del Festival de Venecia (labiennale.org, official awards por edición).
// Palmarés en artículo oficial + selecciones en páginas separadas.

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "venice";
const LATEST_EDITION = 82; // 82.ª edición, 2025 (la 83.ª aún no tiene palmarés)

const DICTIONARY: Record<string, string> = {
  "Golden Lion for Best Film": "León de Oro a la Mejor Película",
  "Grand Jury Prize": "Gran Premio del Jurado",
  "Silver Lion for Best Director": "León de Plata a la Mejor Dirección",
  "Special Jury Prize": "Premio Especial del Jurado",
  "Volpi Cup for Best Actor": "Copa Volpi al Mejor Actor",
  "Volpi Cup for Best Actress": "Copa Volpi a la Mejor Actriz",
  "Marcello Mastroianni Award": "Premio Marcello Mastroianni",
  "Golden Lion for Lifetime Achievement": "León de Oro a la Trayectoria",
  "Special Lion": "León Especial",
  "Osella for Best Screenplay": "Osella al Mejor Guion",
  "Osella for Best Original Score": "Osella a la Mejor Banda Sonora",
  "Golden Lion for Best Short Film": "León de Oro al Mejor Cortometraje",
  "Future Lion Award": "Premio León del Futuro",
};

// Ediciones irregulares (1939 sin premios oficiales; 1940-42 no competitivas;
// 1943-45 suspendido). Años sin archivo -> cobertura parcial.
function veniceEditions(): Array<{ edition: number; year: number; coverage: "complete" | "partial" }> {
  const explicit: Array<[number, number, "complete" | "partial"]> = [
    [1, 1932, "complete"],
    [2, 1934, "complete"],
    [3, 1935, "complete"],
    [4, 1936, "complete"],
    [5, 1937, "complete"],
    [6, 1938, "complete"],
    [7, 1939, "partial"],
    [8, 1940, "partial"],
    [9, 1941, "partial"],
    [10, 1942, "partial"],
    [11, 1946, "complete"],
    [12, 1947, "complete"],
    [13, 1948, "complete"],
    [14, 1949, "complete"],
  ];
  const rest: Array<{ edition: number; year: number; coverage: "complete" | "partial" }> = [];
  for (let edition = 15; edition <= LATEST_EDITION; edition += 1) {
    // Since 79th edition, the official numbering aligns with year + 1943
    // (79=2022, 80=2023, 81=2024, 82=2025).
    rest.push({ edition, year: edition + 1943, coverage: "complete" });
  }
  return [...explicit.map(([edition, year, coverage]) => ({ edition, year, coverage })), ...rest];
}

function ordinal(edition: number): string {
  const mod100 = edition % 100;
  const mod10 = edition % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${edition}th`;
  if (mod10 === 1) return `${edition}st`;
  if (mod10 === 2) return `${edition}nd`;
  if (mod10 === 3) return `${edition}rd`;
  return `${edition}th`;
}

export const veniceParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    return veniceEditions().map(item => ({
      edition: item.edition,
      awardYear: item.year,
      coverage: item.coverage,
      url: `https://www.labiennale.org/en/news/official-awards-${ordinal(item.edition)}-venice-international-film-festival`,
    }));
  },

  recentEditions() {
    return [
      { ceremony: CEREMONY, edition: LATEST_EDITION },
      { ceremony: CEREMONY, edition: LATEST_EDITION - 1 },
    ];
  },

  // Fichas históricas ausentes/bloqueadas observadas durante el backfill;
  // quedan visibles como gaps hasta que exista una captura verificable.
  gapEditions() {
    const noArchive = [1, 2, 3, 4, 5, 6, 7, 34];
    const blocked = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 82];
    return [
      ...noArchive.map(edition => ({ edition, awardYear: edition + 1931, type: "no_archive" as const })),
      ...blocked.map(edition => ({ edition, awardYear: edition + 1931, type: "blocked" as const })),
    ];
  },

  extraSource(edition: number): string | null {
    const spec = veniceEditions().find(item => item.edition === edition);
    return spec ? `https://www.labiennale.org/en/festival/${spec.year}` : null;
  },

  parseEdition(html: string, meta: ParserMeta, extra?: { url: string; html: string }): ParsedEdition {
    const $ = loadHtml(html);
    const realSections = $(".lb-page-content-wrap").toArray().flatMap(wrapper => {
      const section = $(wrapper).find(".lb-page-aside h4").first().text().replace(/\s+/g, " ").trim();
      if (!section) return [];
      const grouped = new Map<string, Array<{ text: string; status: "winner" }>>();
      $(wrapper).find(".lb-page-content p").each((_index, paragraph) => {
        const nodes = $(paragraph).find("strong, em").toArray();
        nodes.forEach((node, index) => {
          if ($(node).prop("tagName")?.toString().toLowerCase() !== "strong" || $(node).parents("em").length > 0) return;
          const award = $(node).text().replace(/\s+/g, " ").trim();
          if (!award || !/(award|lion|coppa|prize|nomination|special|volpi|osella|mastroianni)/i.test(award)) return;
          const workNode = nodes.slice(index + 1).find(candidate => $(candidate).prop("tagName")?.toString().toLowerCase() === "em");
          if (!workNode) return;
          const work = $(workNode).text().replace(/\s+/g, " ").trim();
          if (!work) return;
          const workIndex = nodes.indexOf(workNode);
          const recipient = nodes.slice(index + 1, workIndex)
            .filter(candidate => $(candidate).prop("tagName")?.toString().toLowerCase() === "strong" && $(candidate).parents("em").length === 0)
            .map(candidate => $(candidate).text().replace(/\s+/g, " ").trim())
            .filter(Boolean)
            .join(" y ");
          const items = grouped.get(award) ?? [];
          items.push({ text: recipient ? `${recipient} — ${work}` : work, status: "winner" });
          grouped.set(award, items);
        });
      });
      return [...grouped.entries()].map(([category, items]) => ({ category, items }));
    });
    // Fallback for compact fixtures and legacy templates.
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
