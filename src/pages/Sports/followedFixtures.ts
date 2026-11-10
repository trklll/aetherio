import { SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog";
import type { CanonicalEvent, SportsDiscipline } from "../../data/sports/types";
import { normalizeLiveTeamKey } from "../../types/liveSports";
import { SPORTS_TIME_ZONE } from "../../utils/sportsTime";
import { loadTeamOverview, type TeamOverview } from "../../services/sportsTeamOverview";

export type MatchPeriod = "yesterday" | "today" | "upcoming";
export interface FollowedOverview { entityId: string; overview: TeamOverview }
export interface FixtureSide { name: string; entityId?: string; providerId?: string; crest?: string; record?: string }
export interface FollowedFixture {
  id: string; date?: string; timeValid: boolean; home: FixtureSide; away: FixtureSide;
  competition?: string; sport: SportsDiscipline; completed: boolean; live: boolean; cancelled?: boolean; score?: string;
  event?: CanonicalEvent;
}
export interface FixtureGroup { key: string; label: string; matches: FollowedFixture[] }

export const FOLLOWED_OVERVIEW_RETRY_MS = 2_000;
export const FOLLOWED_OVERVIEW_TIMEOUT_MS = 30_000;

const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: SPORTS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("es-PE", { timeZone: SPORTS_TIME_ZONE, weekday: "long", day: "numeric", month: "long" });

export function sportsDateKey(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = calendar.formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}

const knownTeams = new Map<string, string | null>();
for (const entity of SPORTS_ENTITY_BY_ID.values()) {
  if (entity.kind !== "club" && entity.kind !== "national-team") continue;
  for (const name of [entity.name, ...(entity.aliases ?? [])]) {
    const key = `${entity.sport}:${normalizeLiveTeamKey(name)}`;
    const existing = knownTeams.get(key);
    knownTeams.set(key, existing === undefined || existing === entity.id ? entity.id : null);
  }
}
const knownTeam = (name: string, sport: SportsDiscipline) => knownTeams.get(`${sport}:${normalizeLiveTeamKey(name)}`) ?? undefined;

function matchKey(match: FollowedFixture): string | undefined {
  const day = sportsDateKey(match.date);
  return day ? `${match.sport}:${match.home.entityId ?? normalizeLiveTeamKey(match.home.name)}:${match.away.entityId ?? normalizeLiveTeamKey(match.away.name)}:${day}` : undefined;
}

export function buildFollowedFixtures(entries: readonly FollowedOverview[], events: readonly CanonicalEvent[], followedIds: readonly string[]): FollowedFixture[] {
  const followed = new Set(followedIds);
  const selected = entries.filter(entry => followed.has(entry.entityId));
  const providerIds = new Map(selected.flatMap(entry => entry.overview.teamId ? [[entry.overview.teamId, entry.entityId] as const] : []));
  const matches = new Map<string, FollowedFixture>();
  for (const { overview } of selected) for (const match of overview.fixtures) {
    if (matches.has(`fotmob:${match.id}`)) continue;
    const side = (name: string | undefined, providerId: string | undefined): FixtureSide => {
      const entityId = (providerId ? providerIds.get(providerId) : undefined) ?? (name ? knownTeam(name, "futbol") : undefined);
      // Only show a record from the fixture's own competition, never its club's unrelated league table.
      const table = match.competition ? overview.standings.find(group => normalizeLiveTeamKey(group.name) === normalizeLiveTeamKey(match.competition)) : undefined;
      const standing = providerId ? table?.rows.find(row => row.id === providerId) : undefined;
      const record = standing && [standing.wins, standing.draws, standing.losses].every(value => value !== undefined)
        ? `${standing.wins}-${standing.draws}-${standing.losses}` : undefined;
      return { name: name ?? "Por confirmar", entityId, providerId, record,
        crest: providerId ? `https://images.fotmob.com/image_resources/logo/teamlogo/${providerId}.png` : undefined };
    };
    matches.set(`fotmob:${match.id}`, { ...match, id: `fotmob:${match.id}`, sport: "futbol", home: side(match.home, match.homeId), away: side(match.away, match.awayId) });
  }
  const byMatch = new Map([...matches.values()].flatMap(match => { const key = matchKey(match); return key ? [[key, match] as const] : []; }));
  for (const event of events) {
    if (!event.home || !event.away || !event.participants.some(side => side.entityId && followed.has(side.entityId))) continue;
    const match: FollowedFixture = { id: event.id, date: event.startsAt, timeValid: event.timePrecision === "exact", sport: event.sport,
      home: event.home, away: event.away, competition: event.competitionId ? SPORTS_ENTITY_BY_ID.get(event.competitionId)?.name : undefined,
      completed: event.status === "ended", live: event.status === "live", event };
    const key = matchKey(match);
    const existing = key ? byMatch.get(key) : undefined;
    if (existing) {
      matches.set(existing.id, { ...existing, event, live: match.live || existing.live, competition: existing.competition ?? match.competition });
    } else {
      matches.set(match.id, match);
      if (key) byMatch.set(key, match);
    }
  }
  return [...matches.values()].sort((a, b) => (Date.parse(a.date ?? "") || Infinity) - (Date.parse(b.date ?? "") || Infinity) || a.id.localeCompare(b.id));
}

export function groupFollowedFixtures(matches: readonly FollowedFixture[], period: MatchPeriod, now = Date.now()): FixtureGroup[] {
  const today = sportsDateKey(now)!;
  // Peru has no DST: subtracting 24h preserves the previous calendar day.
  const yesterday = sportsDateKey(now - 86_400_000)!;
  const groups = new Map<string, FixtureGroup>();
  for (const match of matches) {
    const key = sportsDateKey(match.date);
    const include = period === "yesterday" ? key === yesterday : period === "today" ? key === today
      : key ? key > today : !match.completed && !match.live;
    if (!include) continue;
    const groupKey = key ?? "undated";
    const group = groups.get(groupKey) ?? { key: groupKey, label: key ? dayLabel.format(new Date(`${key}T12:00:00-05:00`)) : "Fecha por confirmar", matches: [] };
    group.matches.push(match);
    groups.set(groupKey, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Share the existing five-minute overview cache; never start one request per team at once. */
export async function loadFollowedOverviews(ids: readonly string[], signal?: AbortSignal, refresh = false) {
  const entries: FollowedOverview[] = [];
  const failed: string[] = [];
  const unsupported: string[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (cursor < ids.length && !signal?.aborted) {
      const entityId = ids[cursor++];
      const entity = SPORTS_ENTITY_BY_ID.get(entityId);
      if (!entity || !["club", "national-team"].includes(entity.kind)) continue;
      if (entity.sport !== "futbol") { unsupported.push(entity.name); continue; }
      try {
        const overview = await loadTeamOverview(entity, { refresh });
        if (overview.supported) entries.push({ entityId, overview });
        else unsupported.push(entity.name);
      } catch { failed.push(entity.name); }
    }
  }));
  return { entries, failed, unsupported };
}
