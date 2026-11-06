import { afterEach, describe, expect, it, vi } from "vitest";
import { findFotmobTeam, parseStandings, parseRoster, parseFixtures, parseLineup, parseHonours } from "./sportsTeamOverview";
import { fotmobTeamFixture } from "./__fixtures__/fotmobTeam";

vi.mock("../runtime/platform", () => ({ isTauriRuntime: () => false, invokeCommand: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const alianza = { id: "club:alianza-lima", kind: "club", sport: "futbol", name: "Alianza Lima", countryId: "per" } as const;

describe("FotMob team adapters", () => {
  it("resolves exact unique team aliases, not players, women or ambiguous names", () => {
    const entity = { name: "Alianza Lima", aliases: ["Alianza"] };
    expect(findFotmobTeam([{ suggestions: [{ type: "team", id: "6398", name: "Alianza Lima" }, { type: "team", id: "6", name: "Alianza Atlético" }] }], entity)).toBe("6398");
    expect(findFotmobTeam([{ suggestions: [{ type: "player", id: "1", name: "Alianza" }, { type: "team", id: "2", name: "Alianza Women" }] }], entity)).toBeUndefined();
    expect(findFotmobTeam([{ suggestions: [{ type: "team", id: "1", name: "Alianza" }, { type: "team", id: "2", name: "Alianza" }] }], entity)).toBeUndefined();
    expect(findFotmobTeam(null, entity)).toBeUndefined();
  });
  it("keeps annual, Apertura and Clausura as separate tables, annual first", () => {
    const d = fotmobTeamFixture();
    const groups = parseStandings(d);
    expect(groups.map(group => group.name)).toEqual(["Acumulada · Liga 1", "Clausura", "Apertura"]);
    expect(groups[0].rows[0]).toMatchObject({ rank: "1", points: "68", played: "32", goalsFor: "53", goalsAgainst: "23" });
    expect(parseStandings({})).toEqual([]);
  });
  it("does not synthesize rank or turn a missing statistic into zero", () => {
    const groups = parseStandings({ table: [{ data: { table: { all: [{ id: 1, name: "Club", pts: 0 }] } } }] });
    expect(groups[0].rows[0]).toMatchObject({ rank: undefined, points: "0", played: undefined });
  });
  it("excludes coaches and does not mistake placeholder roster goals for real statistics", () => {
    const players = parseRoster(fotmobTeamFixture());
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({ name: "Jugador de prueba", jersey: "9", goals: undefined, position: "Delantero" });
    expect(players[0].photo).toBe("https://images.fotmob.com/image_resources/playerimages/1.png");
    expect(parseRoster(null)).toEqual([]);
  });
  it("uses the published match score and keeps future scores empty", () => {
    const fixtures = parseFixtures(fotmobTeamFixture());
    expect(fixtures[0]).toMatchObject({ home: "Alianza Lima", away: "Rival", score: "2 – 0", completed: true });
    expect(fixtures[1].score).toBeUndefined();
    expect(parseFixtures({})).toEqual([]);
  });
  it("only associates a published lineup with its own team and exact match", () => {
    const d = fotmobTeamFixture();
    expect(parseLineup(d, "6398")?.match?.id).toBe("100");
    expect(parseLineup(d, "other")).toBeUndefined();
    d.overview.lastLineupStats.lastMatch.matchId = 999;
    expect(parseLineup(d, "6398")?.match).toBeUndefined();
  });
  it("marks provider honours as partial and excludes runner-up-only competitions", () => {
    const honours = parseHonours(fotmobTeamFixture());
    expect(honours?.partial).toBe(true);
    expect(honours?.competitions).toEqual([{ name: "Copa de prueba", count: 1, seasons: "2020" }]);
    expect(parseHonours({ history: { trophyList: [] } })).toBeUndefined();
  });
});

describe("FotMob loader without ESPN", () => {
  async function loader() { vi.resetModules(); return (await import("./sportsTeamOverview")).loadTeamOverview; }
  it("loads real-shaped team data, full scorer stats and keeps cache timestamps truthful", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).not.toMatch(/espn/i);
      if (url.includes("/goals.json")) return new Response(JSON.stringify({ TopLists: [{ StatList: [{ ParticiantId: 1, TeamId: 6398, StatValue: 12 }, { ParticiantId: 2, TeamId: 6398, StatValue: 0 }, { ParticiantId: 1, TeamId: 200, StatValue: 99 }] }] }));
      return new Response(JSON.stringify(fotmobTeamFixture()));
    });
    vi.stubGlobal("fetch", fetch);
    const load = await loader();
    const result = await load(alianza);
    expect(result).toMatchObject({ supported: true, provider: "FotMob", teamId: "6398", season: "2026" });
    expect(result.squad.map(player => player.goals)).toEqual(["12", "0"]);
    const cached = await load(alianza);
    expect(cached.fetchedAt).toBe(result.fetchedAt);
    expect(fetch).toHaveBeenCalledTimes(2);
    await load(alianza, { refresh: true });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("keeps tables and lineup when detailed statistics are offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("goals.json") ? new Response("", { status: 503 }) : new Response(JSON.stringify(fotmobTeamFixture()))));
    const result = await (await loader())(alianza);
    expect(result.standings).toHaveLength(3);
    expect(result.squad[0].goals).toBe("7"); // explicitly published top-three value
    expect(result.squad[1].goals).toBeUndefined();
    expect(result.unavailable).toContain("estadísticas completas");
  });
  it("does not silently load a different club or send basketball to football", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(fotmobTeamFixture(1, "Otro club"))));
    vi.stubGlobal("fetch", fetch);
    const load = await loader();
    await expect(load(alianza)).rejects.toThrow(/identidad/i);
    fetch.mockClear();
    expect((await load({ ...alianza, sport: "baloncesto" })).supported).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses exact search for teams outside the verified MVP IDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("search/suggest")) return new Response(JSON.stringify([{ suggestions: [{ type: "team", id: 777, name: "Otro equipo" }] }]));
      return new Response(JSON.stringify(fotmobTeamFixture(777, "Otro equipo")));
    }));
    expect((await (await loader())({ ...alianza, id: "club:other", name: "Otro equipo" })).teamId).toBe("777");
  });
  it("does not follow provider-supplied statistics URLs to arbitrary hosts", async () => {
    const d = fotmobTeamFixture(); d.stats.players[0].fetchAllUrl = "https://evil.test/private";
    const fetch = vi.fn(async () => new Response(JSON.stringify(d))); vi.stubGlobal("fetch", fetch);
    const result = await (await loader())(alianza);
    expect(result.standings).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
