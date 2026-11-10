import { SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog.ts";
import type { SportsEntity, SportsPreferences } from "../../data/sports/types.ts";

export interface SportsCompetitionCard {
  entity: SportsEntity;
}

/** Followed competitions stay visible even when their schedule has no events. */
export function buildSportsCompetitions(prefs: Pick<SportsPreferences, "followedCompetitions">): SportsCompetitionCard[] {
  return [...new Set(prefs.followedCompetitions)].flatMap(id => {
    const entity = SPORTS_ENTITY_BY_ID.get(id);
    return entity?.kind === "competition" ? [{ entity }] : [];
  });
}
