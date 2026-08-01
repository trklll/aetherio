// Parser del archivo oficial de los Globos de Oro (goldenglobes.com/winners-nominees/).

import type { AwardCeremony, ParsedEdition } from "../types";
import type { CeremonyParser, EditionSpec, ParserMeta } from "../parser";
import { recordsFromSections } from "../parser";
import { loadHtml, walkSections } from "../sections";

const CEREMONY: AwardCeremony = "golden_globes";
const LATEST_EDITION = 83; // 83.ª ceremonia, enero 2026

const DICTIONARY: Record<string, string> = {
  "Best Motion Picture – Drama": "Mejor Película Dramática",
  "Best Motion Picture – Musical or Comedy": "Mejor Película de Comedia o Musical",
  "Best Director": "Mejor Director",
  "Best Actor in a Motion Picture – Drama": "Mejor Actor de Película Dramática",
  "Best Actor in a Motion Picture – Musical or Comedy": "Mejor Actor de Comedia o Musical",
  "Best Actress in a Motion Picture – Drama": "Mejor Actriz de Película Dramática",
  "Best Actress in a Motion Picture – Musical or Comedy": "Mejor Actriz de Comedia o Musical",
  "Best Supporting Actor in a Motion Picture": "Mejor Actor de Reparto",
  "Best Supporting Actress in a Motion Picture": "Mejor Actriz de Reparto",
  "Best Screenplay": "Mejor Guion",
  "Best Original Score": "Mejor Banda Sonora Original",
  "Best Original Song": "Mejor Canción Original",
  "Best Animated Feature Film": "Mejor Película de Animación",
  "Best Motion Picture – Non-English Language": "Mejor Película en Lengua No Inglesa",
  "Best Television Series – Drama": "Mejor Serie de Televisión Dramática",
  "Best Television Series – Musical or Comedy": "Mejor Serie de Comedia o Musical",
  "Best Limited Series, Anthology Series or Television Film": "Mejor Miniserie, Antología o Película para TV",
  "Best Actor in a Television Series – Drama": "Mejor Actor de Serie Dramática",
  "Best Actor in a Television Series – Musical or Comedy": "Mejor Actor de Serie de Comedia o Musical",
  "Best Actress in a Television Series – Drama": "Mejor Actriz de Serie Dramática",
  "Best Actress in a Television Series – Musical or Comedy": "Mejor Actriz de Serie de Comedia o Musical",
  "Best Supporting Actor in a Television Series": "Mejor Actor de Reparto en TV",
  "Best Supporting Actress in a Television Series": "Mejor Actriz de Reparto en TV",
  "Best Performance in Stand-Up Comedy on Television": "Mejor Actuación de Stand-Up en TV",
  "Cinematic and Box Office Achievement": "Logro Cinematográfico y de Taquilla",
};

export const goldenGlobesParser: CeremonyParser = {
  ceremony: CEREMONY,

  archiveEditions(): EditionSpec[] {
    const editions: EditionSpec[] = [];
    for (let edition = 1; edition <= LATEST_EDITION; edition += 1) {
      editions.push({
        edition,
        awardYear: edition + 1943,
        coverage: "complete",
        // The public page is a React shell; the official WordPress endpoint
        // contains the complete, structured winners/nominees dataset.
        url: `https://goldenglobes.com/wp-json/awdb/v1/winners-and-nominees/?year=${edition + 1943}`,
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
    const apiRecords = parseAwardsDatabase(html, meta);
    if (apiRecords.length > 0) {
      return {
        ceremony: CEREMONY,
        edition: meta.edition,
        awardYear: meta.awardYear,
        coverage: meta.coverage,
        records: apiRecords,
      };
    }
    const sections = walkSections(loadHtml(html), "h2, h3, h4", "li");
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

interface AwardsDatabaseCategory {
  award?: unknown;
  nominations?: unknown;
}

interface AwardsDatabaseNomination {
  winner?: unknown;
  nominee_type?: unknown;
  show?: { title?: unknown };
  nominees?: Array<{ title?: unknown }>;
}

/** Convierte la respuesta JSON oficial de /awdb/v1 en registros normalizados. */
function parseAwardsDatabase(html: string, meta: ParserMeta): ParsedEdition["records"] {
  let categories: AwardsDatabaseCategory[];
  try {
    const parsed: unknown = JSON.parse(html);
    if (!Array.isArray(parsed)) return [];
    categories = parsed as AwardsDatabaseCategory[];
  } catch {
    return [];
  }

  const records: ParsedEdition["records"] = [];
  for (const category of categories) {
    const categoryOriginal = typeof category.award === "string" ? category.award.trim() : "";
    if (!categoryOriginal || !Array.isArray(category.nominations)) continue;
    for (const rawNomination of category.nominations as unknown[]) {
      const nomination = rawNomination as AwardsDatabaseNomination;
      const nominees = Array.isArray(nomination.nominees) ? nomination.nominees : [];
      if (nominees.length === 0) continue;
      const status = nomination.winner === true ? "winner" as const : "nominee" as const;
      const nomineeType = typeof nomination.nominee_type === "string" ? nomination.nominee_type : "";
      const showTitle = typeof nomination.show?.title === "string" ? nomination.show.title.trim() : "";
      const firstNominee = nominees[0];
      const nomineeTitle = typeof firstNominee?.title === "string" ? firstNominee.title.trim() : "";
      if (!nomineeTitle) continue;

      const isPerson = nomineeType === "people";
      const isSong = nomineeType === "song" || /song/i.test(categoryOriginal);
      const subject = isSong ? "song" as const : isPerson ? "person" as const : "work" as const;
      const workTitle = isPerson && showTitle ? showTitle : nomineeTitle;
      const recipients = isPerson ? nominees.map(item => typeof item?.title === "string" ? item.title.trim() : "").filter(Boolean) : [];
      records.push({
        categoryOriginal,
        categoryEs: DICTIONARY[categoryOriginal] ?? categoryOriginal,
        status,
        subject,
        recipients,
        workTitle,
        // Los Globos de Oro se celebran al inicio del año siguiente al de
        // las películas/series reconocidas. Este año permite desambiguar
        // títulos repetidos en TMDB (p. ej. "The Godfather" 1972/2023).
        workYear: meta.awardYear - 1,
        sourceUrl: meta.url,
      });
    }
  }
  return records;
}
