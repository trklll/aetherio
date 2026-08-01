// Parser del archivo oficial de los Premios Goya (premiosgoya.com/{edicion}/nominaciones/por-categoria/).

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "goya";
const LATEST_EDITION = 40; // 40.ª edición, 2026

const DICTIONARY: Record<string, string> = {
  "Mejor película": "Mejor Película",
  "Mejor dirección": "Mejor Dirección",
  "Mejor dirección novel": "Mejor Dirección Novel",
  "Mejor actor protagonista": "Mejor Actor Protagonista",
  "Mejor actriz protagonista": "Mejor Actriz Protagonista",
  "Mejor actor de reparto": "Mejor Actor de Reparto",
  "Mejor actriz de reparto": "Mejor Actriz de Reparto",
  "Mejor actor revelación": "Mejor Actor Revelación",
  "Mejor actriz revelación": "Mejor Actriz Revelación",
  "Mejor guion original": "Mejor Guion Original",
  "Mejor guion adaptado": "Mejor Guion Adaptado",
  "Mejor música original": "Mejor Música Original",
  "Mejor canción original": "Mejor Canción Original",
  "Mejor fotografía": "Mejor Fotografía",
  "Mejor montaje": "Mejor Montaje",
  "Mejor dirección de producción": "Mejor Dirección de Producción",
  "Mejor dirección de arte": "Mejor Dirección de Arte",
  "Mejor diseño de vestuario": "Mejor Diseño de Vestuario",
  "Mejor maquillaje y peluquería": "Mejor Maquillaje y Peluquería",
  "Mejor sonido": "Mejor Sonido",
  "Mejores efectos especiales": "Mejores Efectos Especiales",
  "Mejor película de animación": "Mejor Película de Animación",
  "Mejor película documental": "Mejor Película Documental",
  "Mejor película iberoamericana": "Mejor Película Iberoamericana",
  "Mejor película europea": "Mejor Película Europea",
  "Mejor cortometraje de ficción": "Mejor Cortometraje de Ficción",
  "Mejor cortometraje de animación": "Mejor Cortometraje de Animación",
  "Mejor cortometraje documental": "Mejor Cortometraje Documental",
};

export const goyaParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: edition + 1986,
        coverage: "complete",
        url: `https://www.premiosgoya.com/${edition}-edicion/nominaciones/por-categoria/`,
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

  // Las páginas 1–30 no están disponibles en el CMS actual; se registran
  // como bloqueadas para no confundir ausencia de archivo con fallo de datos.
  gapEditions() {
    return Array.from({ length: 30 }, (_, index) => ({ edition: index + 1, awardYear: index + 1987, type: "blocked" as const }));
  },

  parseEdition(html: string, meta: ParserMeta): ParsedEdition {
    const $ = loadHtml(html);
    const realSections = $("section.categoria-de-peliculas").toArray().flatMap(category => {
      const categoryName = $(category).find(".categoria-de-peliculas__titulo").first().text().trim();
      if (!categoryName) return [];
      const items = $(category).find("li.lista-de-peliculas__pelicula").toArray().flatMap(item => {
        const title = $(item).find(".lista-de-peliculas__titulo").first().text().trim();
        if (!title) return [];
        const marker = $(item).find("img[alt*='Ganadora'], img[title*='Ganadora']").length > 0;
        return [{ text: title, status: marker ? "winner" as const : "nominee" as const }];
      });
      return items.length > 0 ? [{ category: categoryName, items }] : [];
    });
    const sections = realSections.length > 0 ? realSections : walkSections($, "h2, h3, h4", "li");
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
