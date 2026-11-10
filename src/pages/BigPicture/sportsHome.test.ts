import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSportsPreferences } from "../../data/sports/preferences.ts";
import { resolveEvent } from "../../data/sports/identity.ts";
import type { LiveEvent } from "../../types/liveSports.ts";
import type { SportsPreferences } from "../../data/sports/types.ts";
import { buildSportsHome } from "./sportsHome.ts";
import { normalizeSportsPreferences } from "../../data/sports/preferences.ts";

afterEach(() => vi.useRealTimers());

const NOW = Date.parse("2026-10-29T18:00:00Z");
function prefs(patch: Partial<SportsPreferences> = {}): SportsPreferences {
  return { ...defaultSportsPreferences(), ...patch };
}
function event(patch: Partial<LiveEvent> = {}) {
  return resolveEvent({ id: "live-1", title: "Real Madrid vs Barcelona", sport: "Football", league: "LaLiga", status: "live",
    startsAt: new Date(NOW - 600_000).toISOString(), home: { name: "Real Madrid" }, away: { name: "FC Barcelona" },
    sources: [{ id: "s1", label: "Test", url: "https://sports.test/live.m3u8" }], ...patch }, "test", NOW)!;
}

describe("home de Sports", () => {
  it("passes composed match artwork to the TV cards without replacing the hero backdrop", () => {
    const live = event({ poster: "https://sports.test/addon-poster.jpg" });
    const item = buildSportsHome([live], prefs(), NOW).rows[0].items[0];
    expect(item.sportsMatch?.home?.crest).toMatch(/^\/assets\/football-logos\/clubs\//);
    expect(item.sportsMatch?.away?.crest).toMatch(/^\/assets\/football-logos\/clubs\//);
    expect(item.background).toBe(live.poster);
  });

  it("preserves provider team logos and colors for clubs outside the local registry", () => {
    const live = event({ title: "Aurora Norte vs Deportivo Sur", home: { name: "Aurora Norte", logo: "https://teams.test/aurora.png", color: "#123456" }, away: { name: "Deportivo Sur", logo: "https://teams.test/sur.png" } });
    const item = buildSportsHome([live], prefs(), NOW).rows[0].items[0];
    expect(item.sportsMatch?.home).toMatchObject({ name: "Aurora Norte", crest: "https://teams.test/aurora.png", color: "#123456" });
    expect(item.sportsMatch?.away?.crest).toBe("https://teams.test/sur.png");
  });

  it("includes Highfly basketball in Sports and formats its schedule in Peru's timezone without showing the country", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-30T23:00:00Z"));
    const basketball = event({ id: "sportsstreams:nba", title: "Lakers vs Celtics", sport: "Basketball", league: "NBA", status: "upcoming", startsAt: "2026-10-31T02:30:00Z", home: { name: "Lakers" }, away: { name: "Celtics" }, sources: [] });
    expect(basketball?.sport).toBe("baloncesto");
    const preferences = normalizeSportsPreferences({ sports: ["baloncesto"], onboarding: "completed" });
    expect(preferences.sports).toEqual(["baloncesto"]);
    const home = buildSportsHome([basketball], preferences, Date.now());
    expect(home.rows[0].items[0].runtime).toBe("Hoy 21:30");
    expect(home.rows[0].items[0].runtime).not.toContain("Perú");
    expect(home.rows[0].items[0].genres).toContain("NBA");
    expect(basketball.home?.crest).toBeUndefined();
  });

  it("orders Ahora mismo by kickoff instead of source language", () => {
    const english = event({ id: "en", title: "Arsenal vs Chelsea", startsAt: new Date(NOW - 20 * 60_000).toISOString(), home: { name: "Arsenal" }, away: { name: "Chelsea" }, sources: [{ id: "en", label: "English", language: "en", url: "https://cdn.test/en" }] });
    const spanish = event({ startsAt: new Date(NOW - 10 * 60_000).toISOString(), sources: [{ id: "es", label: "Español", language: "es", url: "https://cdn.test/es" }] });
    expect(buildSportsHome([spanish, english], prefs(), NOW).heroItems.map(item => item.id)).toEqual([english.id, spanish.id]);
  });

  it("does not mark a Highfly kickoff recovered from meta as synthesized just because it is starting now", () => {
    const live = event({ id: "sportsstreams:real-time", startsAt: new Date(NOW).toISOString(), startsAtPrecision: "exact" });
    expect(live.timePrecision).toBe("exact");
  });
  it("tiene una única fila de directo, Ahora mismo, justo antes de la agenda", () => {
    const personalization = prefs({ followedCompetitions: ["comp:esp-laliga", "comp:arg-primera"], followedOrganizations: ["org:ufc"] });
    const live = event();
    const mma = event({ id: "mma", title: "UFC Main Card", sport: "MMA", league: "UFC", home: undefined, away: undefined });
    const upcoming = event({ id: "next", title: "River vs Boca", status: "upcoming", startsAt: new Date(NOW + 3_600_000).toISOString(), sources: [], home: { name: "River Plate" }, away: { name: "Boca Juniors" } });
    const home = buildSportsHome([upcoming, mma, live], personalization, NOW);
    expect(home.rows.map(row => row.name)).toEqual(["Ahora mismo", "Próximamente"]);
    expect(home.rows.find(row => row.catalogId === "sports-now")?.items.map(item => item.id)).toEqual([mma.id, live.id]);
    expect(home.rows.find(row => row.catalogId === "sports-upcoming")?.items.map(item => item.id)).toEqual([upcoming.id]);
    expect(home.heroItems.map(item => item.id)).toEqual([mma.id, live.id, upcoming.id]);
    expect(home.rows.every(row => row.type === "live")).toBe(true);
  });

  it("filtra por los deportes elegidos y, si hay seguidos, solo muestra lo de ellos", () => {
    const personalization = prefs({ sports: ["futbol"], followedCompetitions: ["comp:esp-laliga"] });
    const laliga = event();
    const premier = event({ id: "premier", title: "Arsenal vs Chelsea", league: "Premier League", home: { name: "Arsenal" }, away: { name: "Chelsea" } });
    const serieUpcoming = event({ id: "serie", status: "upcoming", title: "Juventus vs Milan", league: "Serie A", startsAt: new Date(NOW + 3_600_000).toISOString(), sources: [], home: { name: "Juventus" }, away: { name: "Milan" } });
    const mma = event({ id: "ufc", title: "UFC Main Card", sport: "MMA", league: "UFC", home: undefined, away: undefined });
    const home = buildSportsHome([premier, mma, serieUpcoming, laliga], personalization, NOW);

    expect(home.rows.map(row => row.catalogId)).toEqual(["sports-now"]);
    expect(home.rows[0].items.map(item => item.id)).toEqual([laliga.id]);
    expect(home.heroItems.map(item => item.id)).toEqual([laliga.id]);
  });

  it("con deportes elegidos pero nada seguido muestra todo el deporte elegido", () => {
    const personalization = prefs({ sports: ["futbol"] });
    const laliga = event();
    const premier = event({ id: "premier", title: "Arsenal vs Chelsea", league: "Premier League", home: { name: "Arsenal" }, away: { name: "Chelsea" } });
    const mma = event({ id: "ufc", title: "UFC Main Card", sport: "MMA", league: "UFC", home: undefined, away: undefined });
    const home = buildSportsHome([premier, mma, laliga], personalization, NOW);
    expect(home.rows.map(row => row.catalogId)).toEqual(["sports-now"]);
    expect(home.rows[0].items.map(item => item.id)).toEqual([premier.id, laliga.id]);
  });

  it("Ahora mismo agrupa partidos por horario aunque aún no tengan fuentes", () => {
    const football = event();
    const mma = event({ id: "mma", title: "UFC Main Card", sport: "MMA", league: "UFC", home: undefined, away: undefined });
    const noSources = event({ id: "no-source", title: "Liverpool vs Chelsea", home: { name: "Liverpool" }, away: { name: "Chelsea" }, sources: [] });
    const startedBySchedule = event({ id: "scheduled-now", title: "PSG vs Lyon", home: { name: "PSG" }, away: { name: "Lyon" }, status: "upcoming", startsAt: new Date(NOW - 10 * 60_000).toISOString(), sources: [] });
    const ended = event({ id: "finished", title: "Partido terminado", home: undefined, away: undefined, status: "ended" });
    const upcoming = event({ id: "upcoming", title: "Partido futuro", home: undefined, away: undefined, status: "upcoming", startsAt: new Date(NOW + 3_600_000).toISOString() });
    const home = buildSportsHome([football, mma, football, noSources, startedBySchedule, ended, upcoming], prefs(), NOW);

    const row = home.rows.find(row => row.catalogId === "sports-now");

    expect(row?.items.map(item => item.id)).toEqual([football.id, mma.id, noSources.id, startedBySchedule.id]);
    expect(row?.items.every(item => item.genres?.[0] === "En directo")).toBe(true);
  });

  it("mantiene en Ahora mismo un partido que acaba de empezar según horario", () => {
    const scheduled = event({ id: "scheduled", title: "Arsenal vs Chelsea", home: { name: "Arsenal" }, away: { name: "Chelsea" }, status: "upcoming", startsAt: new Date(NOW - 60_000).toISOString(), sources: [] });
    const tooOld = event({ id: "stale", title: "Juventus vs Milan", home: { name: "Juventus" }, away: { name: "Milan" }, status: "upcoming", startsAt: new Date(NOW - 6 * 60 * 60_000).toISOString(), sources: [] });
    const ended = event({ id: "ended", status: "ended" });
    const home = buildSportsHome([scheduled, tooOld, ended], prefs(), NOW);
    expect(home.rows.find(row => row.catalogId === "sports-now")?.items.map(item => item.id)).toEqual([scheduled.id]);
    expect(home.heroItems.map(item => item.id)).toEqual([scheduled.id]);
  });

  it("un próximo con fuentes publicadas sigue siendo agenda, no directo", () => {
    const home = buildSportsHome([event({ status: "upcoming", startsAt: new Date(NOW + 3_600_000).toISOString() })], prefs(), NOW);
    expect(home.rows.map(row => row.name)).toEqual(["Próximamente"]);
  });

  it("no mete en Ahora mismo un partido marcado live cuyo kickoff exacto es futuro", () => {
    const scheduledLive = event({ status: "live", startsAt: new Date(NOW + 90 * 60_000).toISOString() });
    const home = buildSportsHome([scheduledLive], prefs(), NOW);

    expect(home.rows.map(row => row.catalogId)).toEqual(["sports-upcoming"]);
    expect(home.heroItems[0].genres?.[0]).toBe("Próximamente");
  });

  it("usa artwork deportivo sin inventar ratings, películas ni logos del canal", () => {
    const live = event({ poster: "https://sports.test/event.jpg", logo: "https://sports.test/channel.png" });
    const item = buildSportsHome([live], prefs(), NOW).heroItems[0];
    expect(item.background).toBe(live.poster);
    expect(item.type).toBe("live");
    expect(item.logo).toBeUndefined();
    expect(item.rating).toBeUndefined();
    expect(item.genres).toContain("LaLiga");
  });

  it("always provides network-independent artwork for a missing or failed provider image", () => {
    const items = [event(), event({ id: "remote", poster: "http://127.0.0.1:7310/img/match?title=test" })];
    for (const live of items) {
      const item = buildSportsHome([live], prefs(), NOW).heroItems[0];
      expect(item.originalPoster).toMatch(/^data:image\/svg\+xml,/);
      const svg = decodeURIComponent(item.originalPoster!.split(",")[1]);
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain('href="http');
      expect(item.background).toBe(live.poster ?? item.originalPoster);
    }
  });
});
