import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamOverview } from "../../services/sportsTeamOverview";
import * as teamService from "../../services/sportsTeamOverview";
import type { CanonicalEvent } from "../../data/sports/types";
import { buildFollowedFixtures, groupFollowedFixtures, loadFollowedOverviews, sportsDateKey } from "./followedFixtures";

afterEach(() => vi.restoreAllMocks());

const overview = (teamId = "6398"): TeamOverview => ({
  supported: true, provider: "FotMob", teamId, league: "Liga 1", standings: [], squad: [], unavailable: [], fetchedAt: 0,
  fixtures: [
    { id: "1", home: "Alianza Lima", away: "Rival", name: "Alianza Lima — Rival", date: "2026-11-07T00:30:00Z", completed: true, live: false, timeValid: true, score: "2 – 0" },
    { id: "2", home: "Alianza Lima", away: "Otro", name: "Alianza Lima — Otro", date: "2026-11-07T20:00:00Z", completed: false, live: false, timeValid: true },
    { id: "3", home: "Tercero", away: "Alianza Lima", name: "Tercero — Alianza Lima", date: "2026-11-08T18:00:00Z", completed: false, live: false, timeValid: true },
    { id: "4", home: "Alianza Lima", away: "Sin fecha", name: "Alianza Lima — Sin fecha", completed: false, live: false, timeValid: false },
  ],
});
const entries = [{ entityId: "club:fl-alianza-lima", overview: overview() }];
const now = Date.parse("2026-11-07T18:00:00Z");

describe("followed teams match schedule", () => {
  it("uses Peru calendar dates rather than UTC or the machine timezone", () => {
    expect(sportsDateKey("2026-11-07T00:30:00Z")).toBe("2026-11-06");
    expect(sportsDateKey("invalid")).toBeUndefined();
    expect(sportsDateKey(undefined)).toBeUndefined();
  });
  it("separates yesterday, today, future dates and undated fixtures", () => {
    const fixtures = buildFollowedFixtures(entries, [], ["club:fl-alianza-lima"]);
    expect(groupFollowedFixtures(fixtures, "yesterday", now).flatMap(group => group.matches.map(match => match.id))).toEqual(["fotmob:1"]);
    expect(groupFollowedFixtures(fixtures, "today", now).flatMap(group => group.matches.map(match => match.id))).toEqual(["fotmob:2"]);
    expect(groupFollowedFixtures(fixtures, "upcoming", now).map(group => group.key)).toEqual(["2026-11-08", "undated"]);
  });
  it("deduplicates a match reported by two followed teams without inventing its competition", () => {
    const matches = buildFollowedFixtures([...entries, { entityId: "club:fl-atletico-grau", overview: overview("920789") }], [], ["club:fl-alianza-lima", "club:fl-atletico-grau"]);
    expect(matches).toHaveLength(4);
    expect(matches[0].competition).toBeUndefined();
    expect(matches[0].home.entityId).toBe("club:fl-alianza-lima");
  });
  it("does not reuse results after the followed team is removed", () => {
    expect(buildFollowedFixtures(entries, [], [])).toEqual([]);
  });
  it("does not assign completed undated matches to the future", () => {
    const matches = buildFollowedFixtures([{ ...entries[0], overview: { ...overview(), fixtures: [{ ...overview().fixtures[3], completed: true }] } }], [], ["club:fl-alianza-lima"]);
    expect(groupFollowedFixtures(matches, "upcoming", now)).toEqual([]);
  });
  it("merges canonical aliases with the same published fixture", () => {
    const data = { ...overview(), fixtures: [{ ...overview().fixtures[1], away: "FC Barcelona" }] };
    const home = { name: "Alianza", entityId: "club:fl-alianza-lima" };
    const away = { name: "Barcelona", entityId: "club:barcelona" };
    const event = { id: "live:1", sport: "futbol", home, away, participants: [home, away], startsAt: "2026-11-07T20:00:00Z", timePrecision: "exact", status: "live" } as CanonicalEvent;
    const result = buildFollowedFixtures([{ entityId: entries[0].entityId, overview: data }], [event], [entries[0].entityId]);
    expect(result).toHaveLength(1);
    expect(result[0].live).toBe(true);
  });
  it("only adds records from a matching competition and preserves unknown statistics", () => {
    const data = { ...overview(), standings: [{ name: "Copa", rows: [{ id: "6398", name: "Alianza Lima", wins: "0", draws: "2", losses: "3" }] }],
      fixtures: [{ ...overview().fixtures[0], homeId: "6398", competition: "Copa" }] };
    const build = () => buildFollowedFixtures([{ entityId: entries[0].entityId, overview: data }], [], [entries[0].entityId]);
    expect(build()[0].home.record).toBe("0-2-3");
    data.fixtures[0].competition = "Liga 1";
    expect(build()[0].home.record).toBeUndefined();
  });
  it("includes canonical-only basketball matches of a followed team, not unrelated events", () => {
    const home = { name: "Mi equipo", entityId: "basket:test" };
    const away = { name: "Otro equipo" };
    const event = { id: "live:basket", sport: "baloncesto", home, away, participants: [home, away], timePrecision: "unknown", status: "upcoming" } as CanonicalEvent;
    expect(buildFollowedFixtures([], [event], [home.entityId])).toHaveLength(1);
    expect(buildFollowedFixtures([], [event], [])).toEqual([]);
  });
});

describe("bounded followed-team data loading", () => {
  it("limits concurrency to four and shares the existing loader", async () => {
    let active = 0; let peak = 0;
    const load = vi.spyOn(teamService, "loadTeamOverview").mockImplementation(async entity => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return overview(entity.id);
    });
    const ids = ["club:man-city", "club:man-utd", "club:real-madrid", "club:barcelona", "club:fl-alianza-lima", "club:fl-atletico-grau"];
    const result = await loadFollowedOverviews(ids);
    expect(result.entries).toHaveLength(6);
    expect(load).toHaveBeenCalledTimes(6);
    expect(peak).toBe(4);
  });
  it("keeps successful teams and returns failed teams for silent background retry", async () => {
    vi.spyOn(teamService, "loadTeamOverview").mockImplementation(async entity => {
      if (entity.id === "club:man-utd") throw new Error("offline");
      return overview();
    });
    const result = await loadFollowedOverviews(["club:man-city", "club:man-utd"]);
    expect(result.entries).toHaveLength(1);
    expect(result.failed).toEqual(["Manchester United"]);
  });
  it("returns total failures as retryable state without throwing", async () => {
    vi.spyOn(teamService, "loadTeamOverview").mockRejectedValue(new Error("offline"));
    await expect(loadFollowedOverviews(["club:man-utd"])).resolves.toMatchObject({ entries: [], failed: ["Manchester United"] });
  });
  it("reports unsupported teams and ignores ids outside the catalog", async () => {
    const load = vi.spyOn(teamService, "loadTeamOverview").mockResolvedValue({ ...overview(), supported: false });
    const result = await loadFollowedOverviews(["club:man-utd", "not-known"]);
    expect(result.unsupported).toContain("Manchester United");
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not start requests after its profile query has been cancelled", async () => {
    const load = vi.spyOn(teamService, "loadTeamOverview");
    const controller = new AbortController(); controller.abort();
    expect((await loadFollowedOverviews(["club:man-utd"], controller.signal)).entries).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });
});
