import { describe, expect, it } from "vitest";
import { resolveEvent } from "../../data/sports/identity.ts";
import { formatSportsMatchCountdown, matchDetailFromCanonicalEvent, matchDetailFromFixtures, readMatchPreview, saveMatchPreview, sportsMatchPath } from "./matchDetail";
import type { FollowedFixture, FollowedOverview } from "./followedFixtures";

const match: FollowedFixture = { id: "fotmob:1", home: { name: "Valencia", providerId: "1" }, away: { name: "Real Madrid", providerId: "2" }, competition: "LaLiga", timeValid: true, sport: "futbol", completed: false, live: false };
const table = { name: "LaLiga", rows: [{ id: "2", name: "Real Madrid", played: "11", wins: "9", draws: "0", losses: "2" }] };
const entries: FollowedOverview[] = [{ entityId: "club:real-madrid", overview: { supported: true, provider: "FotMob", teamId: "2", standings: [table], fixtures: [], squad: [], unavailable: [], fetchedAt: 1 } }];

describe("match detail data", () => {
  it("keeps the match's own competition and actual record", () => {
    const detail = matchDetailFromFixtures([match], entries, match.id);
    expect(detail?.standings).toEqual(table);
    expect(detail?.match.away.record).toBe("9-0-2");
    expect(detail?.match.home.record).toBeUndefined();
  });
  it("never borrows another competition's table", () => {
    expect(matchDetailFromFixtures([{ ...match, competition: "Champions League" }], entries, match.id)?.standings).toBeUndefined();
    expect(matchDetailFromFixtures([match], entries, "missing")).toBeUndefined();
  });
  it("encodes the whole match id as a route segment", () => {
    expect(sportsMatchPath("fotmob:1")).toBe("/big-picture/sports/match/fotmob%3A1");
  });
  it("builds an enfrentamiento directly from a scheduled event without requiring followed teams", () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
    const event = resolveEvent({ id: "scheduled:1", title: "Arsenal vs Chelsea", sport: "Football", league: "Premier League", status: "upcoming",
      startsAt, home: { name: "Arsenal" }, away: { name: "Chelsea" }, sources: [] }, "test", 0)!;
    const detail = matchDetailFromCanonicalEvent(event);
    expect(detail?.match).toMatchObject({ id: event.id, date: event.startsAt, timeValid: true, home: { name: "Arsenal" }, away: { name: "Chelsea" }, competition: "Premier League", live: false, completed: false });
    expect(detail?.match.event).toBe(event);
  });
});

describe("sports match countdown", () => {
  const now = Date.parse("2026-11-07T18:00:00Z");

  it("uses minutes below one hour and never combines units", () => {
    expect(formatSportsMatchCountdown(new Date(now + 59_000).toISOString(), now)).toBe("Comienza en 1 minuto");
    expect(formatSportsMatchCountdown(new Date(now + 59 * 60_000 + 59_000).toISOString(), now)).toBe("Comienza en 59 minutos");
  });

  it("switches to whole hours at one hour", () => {
    expect(formatSportsMatchCountdown(new Date(now + 60 * 60_000).toISOString(), now)).toBe("Comienza en 1 hora");
    expect(formatSportsMatchCountdown(new Date(now + 119 * 60_000).toISOString(), now)).toBe("Comienza en 1 hora");
    expect(formatSportsMatchCountdown(new Date(now + 2 * 60 * 60_000).toISOString(), now)).toBe("Comienza en 2 horas");
  });

  it("switches to days at 24 hours", () => {
    expect(formatSportsMatchCountdown(new Date(now + 24 * 60 * 60_000).toISOString(), now)).toBe("Comienza en un día");
    expect(formatSportsMatchCountdown(new Date(now + 48 * 60 * 60_000).toISOString(), now)).toBe("Comienza en 2 días");
  });

  it("does not show a countdown for invalid, current, or past kickoffs", () => {
    expect(formatSportsMatchCountdown(undefined, now)).toBeUndefined();
    expect(formatSportsMatchCountdown("not-a-date", now)).toBeUndefined();
    expect(formatSportsMatchCountdown(new Date(now).toISOString(), now)).toBeUndefined();
    expect(formatSportsMatchCountdown(new Date(now - 1).toISOString(), now)).toBeUndefined();
  });
});

describe("ephemeral match preview seed", () => {
  it("is isolated by profile, expires, and tolerates bad storage", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const detail = { match, standings: table };
    saveMatchPreview("profile-a", detail, storage, 1000);
    expect(readMatchPreview("profile-a", match.id, storage, 1001)?.detail).toEqual(detail);
    expect(readMatchPreview("profile-b", match.id, storage, 1001)).toBeUndefined();
    expect(readMatchPreview("profile-a", "missing", storage, 1001)).toBeUndefined();
    expect(readMatchPreview("profile-a", match.id, storage, 302_000)).toBeUndefined();
    for (const key of values.keys()) values.set(key, "broken json");
    expect(readMatchPreview("profile-a", match.id, storage, 1001)).toBeUndefined();
  });
  it("does not make opening a match depend on session storage being writable", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(() => saveMatchPreview("a", { match }, storage)).not.toThrow();
    expect(readMatchPreview("a", match.id, storage)).toBeUndefined();
  });
});
