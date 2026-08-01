// Registro de parsers por organización.

import type { AwardCeremony } from "../types";
import type { CeremonyParser } from "../parser";
import { oscarParser } from "./oscar";
import { baftaParser } from "./bafta";
import { goldenGlobesParser } from "./goldenGlobes";
import { emmyParser } from "./emmy";
import { goyaParser } from "./goya";
import { japanAcademyParser } from "./japanAcademy";
import { crunchyrollParser } from "./crunchyroll";
import { cannesParser } from "./cannes";
import { veniceParser } from "./venice";
import { marDelPlataParser } from "./marDelPlata";

export const PARSERS: Record<AwardCeremony, CeremonyParser> = {
  oscar: oscarParser,
  bafta: baftaParser,
  golden_globes: goldenGlobesParser,
  emmy: emmyParser,
  goya: goyaParser,
  japan_academy: japanAcademyParser,
  crunchyroll: crunchyrollParser,
  cannes: cannesParser,
  venice: veniceParser,
  mar_del_plata: marDelPlataParser,
};

export function parserFor(ceremony: AwardCeremony): CeremonyParser {
  return PARSERS[ceremony];
}
