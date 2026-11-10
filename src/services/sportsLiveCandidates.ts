import { eventMatchesPreferences } from "../data/sports/board.ts";
import { resolveEvent } from "../data/sports/identity.ts";
import { getSportsPreferences, hasAnyFollow } from "../data/sports/preferences.ts";
import type { LiveEvent } from "../types/liveSports.ts";

/** Filter events that the Sports board cannot show, then put followed fixtures first. */
export function prioritizeLiveCandidates(events: readonly LiveEvent[], providerId: string): LiveEvent[] {
  const preferences = getSportsPreferences();
  const hasFollows = hasAnyFollow(preferences);

  return events
    .map((event, index) => {
      const canonical = resolveEvent(event, providerId);
      return {
        event,
        index,
        canonical,
        followed: Boolean(canonical && eventMatchesPreferences(canonical, preferences)),
      };
    })
    .filter(item => item.canonical && (preferences.scope === "todos" || item.canonical.sport === preferences.scope))
    .filter(item => preferences.view !== "para-ti" || !hasFollows || item.followed)
    .sort((a, b) => Number(b.followed) - Number(a.followed) || a.index - b.index)
    .map(item => item.event);
}
