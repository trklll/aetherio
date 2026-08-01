// Parser del archivo oficial de los Premios Emmy
// (televisionacademy.com/awards/nominees-winners). Soporta tablas y secciones.

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections, walkTable } from "../sections";

const CEREMONY: AwardCeremony = "emmy";
const LATEST_EDITION = 78; // 78.ª ceremonia, 2026

const DICTIONARY: Record<string, string> = {
  "Outstanding Drama Series": "Mejor Serie Dramática",
  "Outstanding Comedy Series": "Mejor Serie de Comedia",
  "Outstanding Limited or Anthology Series": "Mejor Miniserie o Serie Limitada",
  "Outstanding Lead Actor in a Drama Series": "Mejor Actor Principal en Serie Dramática",
  "Outstanding Lead Actress in a Drama Series": "Mejor Actriz Principal en Serie Dramática",
  "Outstanding Lead Actor in a Comedy Series": "Mejor Actor Principal en Serie de Comedia",
  "Outstanding Lead Actress in a Comedy Series": "Mejor Actriz Principal en Serie de Comedia",
  "Outstanding Lead Actor in a Limited or Anthology Series or Movie": "Mejor Actor Principal en Miniserie o Película",
  "Outstanding Lead Actress in a Limited or Anthology Series or Movie": "Mejor Actriz Principal en Miniserie o Película",
  "Outstanding Supporting Actor in a Drama Series": "Mejor Actor de Reparto en Serie Dramática",
  "Outstanding Supporting Actress in a Drama Series": "Mejor Actriz de Reparto en Serie Dramática",
  "Outstanding Supporting Actor in a Comedy Series": "Mejor Actor de Reparto en Serie de Comedia",
  "Outstanding Supporting Actress in a Comedy Series": "Mejor Actriz de Reparto en Serie de Comedia",
  "Outstanding Supporting Actor in a Limited or Anthology Series or Movie": "Mejor Actor de Reparto en Miniserie o Película",
  "Outstanding Supporting Actress in a Limited or Anthology Series or Movie": "Mejor Actriz de Reparto en Miniserie o Película",
  "Outstanding Directing for a Drama Series": "Mejor Dirección en Serie Dramática",
  "Outstanding Directing for a Comedy Series": "Mejor Dirección en Serie de Comedia",
  "Outstanding Writing for a Drama Series": "Mejor Guion en Serie Dramática",
  "Outstanding Writing for a Comedy Series": "Mejor Guion en Serie de Comedia",
  "Outstanding Reality Competition Program": "Mejor Programa de Reality y Competencia",
  "Outstanding Talk Series": "Mejor Programa de Entrevistas",
  "Outstanding Variety Special": "Mejor Especial de Variedades",
  "Outstanding Animated Program": "Mejor Programa Animado",
  "Outstanding Guest Actor in a Drama Series": "Mejor Actor Invitado en Serie Dramática",
  "Outstanding Guest Actress in a Drama Series": "Mejor Actriz Invitada en Serie Dramática",
  "Outstanding Casting for a Drama Series": "Mejor Casting en Serie Dramática",
  "Outstanding Cinematography for a Single-Camera Series": "Mejor Fotografía en Serie",
  "Outstanding Production Design for a Narrative Contemporary Program": "Mejor Diseño de Producción",
  "Outstanding Costumes for a Series": "Mejor Diseño de Vestuario",
  "Outstanding Makeup for a Series": "Mejor Maquillaje",
  "Outstanding Sound Mixing for a Comedy or Drama Series": "Mejor Mezcla de Sonido",
  "Outstanding Music Composition for a Series": "Mejor Composición Musical",
  "Outstanding Original Music and Lyrics": "Mejor Música y Letras Originales",
};

export const emmyParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: edition + 1948,
        coverage: "complete",
        url: `https://www.televisionacademy.com/awards/nominees-winners/${edition + 1948}`,
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

  parseEdition(html: string, meta: ParserMeta): ParsedEdition {
    const $ = loadHtml(html);
    const tables = walkTable($, "table");
    const sections = tables.length > 0 ? tables : walkSections($, "h2, h3, h4", "li");
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
