// Parser del archivo oficial de los Premios Oscar (oscars.org/oscars/ceremonies/).

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "oscar";
const LATEST_EDITION = 98; // 98.ª ceremonia, marzo 2026

const DICTIONARY: Record<string, string> = {
  "Best Picture": "Mejor Película",
  "Best Director": "Mejor Director",
  "Best Actor in a Leading Role": "Mejor Actor Protagónico",
  "Best Actress in a Leading Role": "Mejor Actriz Protagónica",
  "Best Actor in a Supporting Role": "Mejor Actor de Reparto",
  "Best Actress in a Supporting Role": "Mejor Actriz de Reparto",
  "Best Original Screenplay": "Mejor Guion Original",
  "Best Adapted Screenplay": "Mejor Guion Adaptado",
  "Best International Feature Film": "Mejor Película Internacional",
  "Best Animated Feature Film": "Mejor Película de Animación",
  "Best Documentary Feature Film": "Mejor Documental",
  "Best Original Score": "Mejor Banda Sonora Original",
  "Best Original Song": "Mejor Canción Original",
  "Best Cinematography": "Mejor Fotografía",
  "Best Film Editing": "Mejor Montaje",
  "Best Production Design": "Mejor Diseño de Producción",
  "Best Costume Design": "Mejor Diseño de Vestuario",
  "Best Makeup and Hairstyling": "Mejor Maquillaje y Peinado",
  "Best Sound": "Mejor Sonido",
  "Best Visual Effects": "Mejores Efectos Visuales",
  "Best Live Action Short Film": "Mejor Cortometraje de Ficción",
  "Best Documentary Short Subject": "Mejor Cortometraje Documental",
  "Best Animated Short Film": "Mejor Cortometraje Animado",
};

export const oscarParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: edition + 1928,
        coverage: "complete",
        url: `https://www.oscars.org/oscars/ceremonies/${edition + 1928}`,
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

  // El archivo oficial no publica fichas utilizables para las ceremonias 3 y
  // 4; se declaran como huecos explícitos para no reintentarlas eternamente.
  gapEditions() {
    return [
      { edition: 3, awardYear: 1931, type: "no_archive" as const },
      { edition: 4, awardYear: 1932, type: "no_archive" as const },
    ];
  },

  parseEdition(html: string, meta: ParserMeta): ParsedEdition {
    const $ = loadHtml(html);
    const realSections = $(".paragraph--type--award-category").toArray().flatMap(category => {
      const categoryName = $(category).find(".field--name-field-award-category-oscars").first().text().trim();
      if (!categoryName) return [];
      const items = $(category).find(".paragraph--type--award-honoree").toArray().flatMap(honoree => {
        const entity = $(honoree).find(".field--name-field-award-entities").first().text().trim();
        const film = $(honoree).find(".field--name-field-award-film").first().text().trim();
        const text = entity && film ? `${entity} — ${film}` : film || entity;
        if (!text) return [];
        const marker = $(honoree).find(".field--name-field-honoree-type").first().text().toLowerCase();
        return [{ text, status: marker.includes("winner") ? "winner" as const : "nominee" as const }];
      });
      return items.length > 0 ? [{ category: categoryName, items }] : [];
    });
    // Keep the compact fallback used by fixtures and by old archive templates.
    const sections = realSections.length > 0 ? realSections : walkSections($, "h2, h3", "li");
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
