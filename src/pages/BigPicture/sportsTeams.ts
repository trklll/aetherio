import { SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog.ts";
import { canonicalEventIsPlayable } from "../../data/sports/identity.ts";
import type { CanonicalEvent, SportsEntity, SportsPreferences } from "../../data/sports/types.ts";

export interface SportsTeamCard {
  entity: SportsEntity;
  events: CanonicalEvent[];
}

/** Saved teams remain visible even when their provider has no schedule. */
export function buildSportsTeams(events: readonly CanonicalEvent[], prefs: SportsPreferences, now = Date.now()): SportsTeamCard[] {
  const ids = [...new Set([...prefs.followedClubs, ...prefs.followedNationalTeams])];
  return ids.flatMap(id => {
    const entity = SPORTS_ENTITY_BY_ID.get(id);
    if (!entity || (entity.kind !== "club" && entity.kind !== "national-team")) return [];
    const matches = events.filter(event => event.sport === entity.sport
      && (event.home?.entityId === id || event.away?.entityId === id || event.participants.some(participant => participant.entityId === id))
      && ((event.status === "live" && canonicalEventIsPlayable(event))
        || (event.status === "upcoming" && (!event.startsAt || Date.parse(event.startsAt) > now))))
      .sort((a, b) => Number(b.status === "live") - Number(a.status === "live")
        || (Date.parse(a.startsAt ?? "") || Infinity) - (Date.parse(b.startsAt ?? "") || Infinity));
    return [{ entity, events: matches }];
  });
}
