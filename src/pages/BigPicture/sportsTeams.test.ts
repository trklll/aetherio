import { describe, expect, it } from "vitest";
import { defaultSportsPreferences } from "../../data/sports/preferences.ts";
import { resolveEvent } from "../../data/sports/identity.ts";
import { buildSportsTeams } from "./sportsTeams.ts";

const NOW = Date.parse("2026-11-06T18:00:00Z");
const prefs = { ...defaultSportsPreferences(), followedClubs: ["club:liverpool", "club:ajax", "club:real-madrid"] };
function match(id: string, status: "live" | "upcoming" | "ended", startsAt: number, home = "Real Madrid", away = "Barcelona") {
  return resolveEvent({ id, title: `${home} vs ${away}`, sport: "Football", league: "LaLiga", status,
    startsAt: new Date(startsAt).toISOString(), home: { name: home }, away: { name: away },
    sources: status === "live" ? [{ id: "source", label: "Local", url: "https://sports.test/live.m3u8" }] : [],
  }, "test", NOW)!;
}

describe("Mis equipos", () => {
  it("shows only the profile's selected clubs in saved order, even without events", () => {
    expect(buildSportsTeams([], prefs, NOW).map(card => card.entity.name)).toEqual(["Liverpool", "Ajax", "Real Madrid"]);
  });
  it("does not seed teams from competitions, organizations or the reference", () => {
    expect(buildSportsTeams([], { ...defaultSportsPreferences(), followedCompetitions: ["comp:esp-laliga"], followedOrganizations: ["org:ufc"] }, NOW)).toEqual([]);
  });
  it("includes selected national teams and rejects invalid or wrong-kind ids", () => {
    const cards = buildSportsTeams([], { ...prefs, followedClubs: ["missing", "comp:esp-laliga", "club:ajax", "club:ajax"], followedNationalTeams: ["nt:espana"] }, NOW);
    expect(cards.map(card => card.entity.id)).toEqual(["club:ajax", "nt:espana"]);
  });
  it("matches canonical identity, including away games, without substring false positives", () => {
    const away = match("away", "upcoming", NOW + 3600_000, "Sevilla", "Real Madrid");
    const other = match("other", "upcoming", NOW + 1800_000, "Atlético de Madrid", "Barcelona");
    const cards = buildSportsTeams([away, other], prefs, NOW);
    expect(cards[2].events.map(event => event.id)).toEqual([away.id]);
    expect(cards[0].events).toEqual([]);
  });
  it("puts playable live events first, then future events in schedule order", () => {
    const later = match("later", "upcoming", NOW + 7200_000);
    const next = match("next", "upcoming", NOW + 3600_000);
    const live = match("live", "live", NOW - 600_000);
    const ended = match("ended", "ended", NOW - 3600_000);
    const past = match("past", "upcoming", NOW - 60_000);
    expect(buildSportsTeams([later, ended, next, past, live], prefs, NOW)[2].events.map(event => event.id)).toEqual([live.id, next.id, later.id]);
  });
  it("does not mutate saved preferences", () => {
    const saved = structuredClone(prefs);
    buildSportsTeams([], prefs, NOW);
    expect(prefs).toEqual(saved);
  });
});
