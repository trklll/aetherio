import { SPORTS_ENTITY_BY_ID } from "../../data/sports/catalog.ts";
import type { CanonicalEvent } from "../../data/sports/types.ts";
import type { TeamStandingGroup } from "../../services/sportsTeamOverview";
import { normalizeLiveTeamKey } from "../../types/liveSports";
import type { FollowedFixture, FollowedOverview } from "./followedFixtures";

export interface SportsMatchDetail { match: FollowedFixture; standings?: TeamStandingGroup }
interface PreviewSeed { profileKey: string; savedAt: number; detail: SportsMatchDetail }
type PreviewStorage = Pick<Storage, "getItem" | "setItem">;
const STORAGE_KEY = "aetherio-sports-match-preview-v1";
const MAX_AGE = 300_000;

export const sportsMatchPath = (id: string) => `/big-picture/sports/match/${encodeURIComponent(id)}`;
export const sportsMatchTitle = (match: FollowedFixture) => `${match.home.name} — ${match.away.name}`;

/** A live or scheduled provider event can open without either team being followed. */
export function matchDetailFromCanonicalEvent(event: CanonicalEvent): SportsMatchDetail | undefined {
  if (!event.home?.name || !event.away?.name) return undefined;
  const startsAt = Date.parse(event.startsAt ?? "");
  const scheduledNow = event.status === "upcoming" && Number.isFinite(startsAt)
    && startsAt <= Date.now() && Date.now() - startsAt <= 5 * 60 * 60_000;
  const score = event.home.score && event.away.score ? `${event.home.score} — ${event.away.score}` : undefined;
  return {
    match: {
      id: event.id,
      date: event.startsAt,
      timeValid: event.timePrecision === "exact",
      home: event.home,
      away: event.away,
      competition: SPORTS_ENTITY_BY_ID.get(event.competitionId ?? event.organizationId ?? "")?.name ?? event.raw.league,
      sport: event.sport,
      completed: event.status === "ended",
      live: event.status === "live" || scheduledNow,
      score,
      event,
    },
  };
}

/** Whole-unit, short countdown: minutes until one hour, then hours only. */
export function formatSportsMatchCountdown(date: string | undefined, now = Date.now()): string | undefined {
  if (!date) return undefined;
  const startsAt = Date.parse(date);
  const remaining = startsAt - now;
  if (!Number.isFinite(startsAt) || remaining <= 0) return undefined;

  if (remaining >= 24 * 60 * 60_000) {
    const days = Math.floor(remaining / (24 * 60 * 60_000));
    return days === 1 ? "Comienza en un día" : `Comienza en ${days} días`;
  }

  if (remaining < 60 * 60_000) {
    const minutes = Math.max(1, Math.floor(remaining / 60_000));
    return `Comienza en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
  }

  const hours = Math.floor(remaining / (60 * 60_000));
  return `Comienza en ${hours} ${hours === 1 ? "hora" : "horas"}`;
}

export function matchDetailFromFixtures(matches: readonly FollowedFixture[], entries: readonly FollowedOverview[], id: string): SportsMatchDetail | undefined {
  const match = matches.find(candidate => candidate.id === id);
  if (!match) return undefined;
  const competitionKey = normalizeLiveTeamKey(match.competition ?? "");
  const standings = competitionKey ? entries.flatMap(entry => entry.overview.standings)
    .filter(table => normalizeLiveTeamKey(table.name.replace(/^acumulada\s*[·-]\s*/i, "")) === competitionKey)
    .sort((a, b) => b.rows.length - a.rows.length)[0] : undefined;
  const sideWithRecord = (side: FollowedFixture["home"]) => {
    const row = standings?.rows.find(row => row.id === side.providerId || normalizeLiveTeamKey(row.name) === normalizeLiveTeamKey(side.name));
    return row && [row.wins, row.draws, row.losses].every(value => value !== undefined)
      ? { ...side, record: `${row.wins}-${row.draws}-${row.losses}` } : side;
  };
  return { match: { ...match, home: sideWithRecord(match.home), away: sideWithRecord(match.away) }, standings };
}

/** One ephemeral handoff, not a second persistent sports database. */
export function saveMatchPreview(profileKey: string, detail: SportsMatchDetail | readonly SportsMatchDetail[], storage?: PreviewStorage, now = Date.now()) {
  try { (storage ?? window.sessionStorage).setItem(STORAGE_KEY, JSON.stringify({ profileKey, savedAt: now, details: Array.isArray(detail) ? detail.slice(0, 128) : [detail] })); }
  catch { /* A full/disabled session store must not block the existing carousel. */ }
}

export function readMatchPreview(profileKey: string, matchId: string, storage?: PreviewStorage, now = Date.now()): PreviewSeed | undefined {
  try {
    const stored = JSON.parse((storage ?? window.sessionStorage).getItem(STORAGE_KEY) ?? "null");
    const detail = Array.isArray(stored?.details) ? stored.details.find((value: SportsMatchDetail) => value?.match?.id === matchId) : undefined;
    const seed = stored && detail ? { profileKey: stored.profileKey, savedAt: stored.savedAt, detail } as PreviewSeed : undefined;
    if (!seed || seed.profileKey !== profileKey || !Number.isFinite(seed.savedAt) || now < seed.savedAt || now - seed.savedAt > MAX_AGE
      || seed.detail?.match?.id !== matchId || typeof seed.detail.match.home?.name !== "string" || typeof seed.detail.match.away?.name !== "string"
      || (seed.detail.standings && !Array.isArray(seed.detail.standings.rows))) return undefined;
    return seed;
  } catch { return undefined; }
}
