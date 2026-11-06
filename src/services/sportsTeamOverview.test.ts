import { describe, expect, it, vi, afterEach } from "vitest";
import { findEspnTeam, parseStandings, parseRoster, parseFixtures, parseLineup, loadTeamOverview } from "./sportsTeamOverview";

afterEach(() => vi.unstubAllGlobals());
describe("team data adapters", () => {
  it("matches exact aliases only and refuses ambiguous clubs", () => {
    const entity = { name: "Alianza Lima", aliases: ["Alianza"] };
    expect(findEspnTeam([{ id: "1", displayName: "Alianza Lima" }, { id: "2", displayName: "Alianza Atlético" }], entity)?.id).toBe("1");
    expect(findEspnTeam([{ id: "1", displayName: "Manchester City Women" }], { name: "Manchester City" })).toBeUndefined();
    expect(findEspnTeam([{ id: "1", name: "Alianza" }, { id: "2", name: "Alianza" }], entity)).toBeUndefined();
  });
  it("keeps standings groups, real rank, zero points and missing values distinct", () => {
    const groups = parseStandings({ children: [{ name: "Apertura", standings: { entries: [{ team: { id: "1", displayName: "Alianza" }, stats: [{ name: "rank", value: 3 }, { name: "points", value: 0 }] }] } }] });
    expect(groups[0].name).toBe("Apertura");
    expect(groups[0].rows[0]).toMatchObject({ rank: "3", points: "0", played: undefined });
    expect(parseStandings({})).toEqual([]);
  });
  it("reads flat and grouped squads without inventing photos or goals", () => {
    expect(parseRoster({ athletes: [{ items: [{ id: "1", displayName: "Jugador", jersey: "9", position: { abbreviation: "F" } }] }] })[0]).toMatchObject({ name: "Jugador", jersey: "9", photo: undefined, goals: undefined });
    expect(parseRoster({ athletes: [{ id: "2", displayName: "Otro", headshot: { href: "https://a.espncdn.com/photo.png" } }] })[0].photo).toContain("https:");
  });
  it("sorts results and handles both score representations", () => {
    const fixtures = parseFixtures({ events: [{ id: "2", date: "2026-10-02", competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: "home", team: { displayName: "A" }, score: { displayValue: "0" } }, { homeAway: "away", team: { displayName: "B" }, score: "2" }] }] }, { id: "1", date: "2026-10-01" }] });
    expect(fixtures[1]).toMatchObject({ home: "A", away: "B", score: "0 – 2", completed: true });
  });
  it("only takes the requested team's published starters", () => {
    const lineup = parseLineup({ rosters: [{ team: { id: "9" }, formation: "4-3-3", roster: [{ starter: true, athlete: { id: "1", displayName: "Titular" } }, { starter: false, athlete: { id: "2", displayName: "Suplente" } }] }] }, "9");
    expect(lineup?.players.map(player => player.name)).toEqual(["Titular"]);
    expect(parseLineup({ rosters: [] }, "9")).toBeUndefined();
  });
  it("does not request football data for basketball or unsupported teams", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await loadTeamOverview({ id: "club:test", kind: "club", sport: "baloncesto", name: "Test" });
    expect(result.supported).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("loads partial sections, merges next fixtures and chooses the newest result for lineup", async () => {
    const fetched: string[] = [];
    const event = (id: string, date: string) => ({ id, date, competitions: [{ status: { type: { completed: true } } }] });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      fetched.push(url);
      let data: unknown = {};
      if (url.includes("teams?")) data = { sports: [{ leagues: [{ teams: [{ team: { id: "9", displayName: "Club Test" } }] }] }] };
      else if (url.endsWith("standings")) return new Response("", { status: 503 });
      else if (url.endsWith("/roster")) data = { athletes: [{ id: "1", displayName: "Titular", statistics: { splits: { categories: [{ stats: [{ name: "totalGoals", value: 0 }] }] } } }], season: { displayName: "2026" } };
      else if (url.endsWith("/schedule")) data = { events: [event("new", "2026-11-01"), event("old", "2026-10-01")] };
      else if (url.includes("summary?")) data = { rosters: [{ team: { id: "9" }, roster: [{ starter: true, athlete: { id: "1", displayName: "Titular" } }] }] };
      else data = { team: { nextEvent: [{ id: "next", date: "2026-12-01" }] } };
      return new Response(JSON.stringify(data));
    }));
    const entity = { id: "club:test", kind: "club", sport: "futbol", name: "Club Test", countryId: "per" } as const;
    const result = await loadTeamOverview(entity);
    expect(result).toMatchObject({ supported: true, teamId: "9", season: "2026", unavailable: ["clasificación"] });
    expect(result.squad[0].goals).toBe("0");
    expect(result.fixtures.map(event => event.id)).toEqual(["old", "new", "next"]);
    expect(result.lineup?.match?.id).toBe("new");
    expect(fetched.some(url => url.endsWith("summary?event=new"))).toBe(true);
    fetched.length = 0;
    await loadTeamOverview(entity);
    expect(fetched).toHaveLength(1); // only the failed table is retried
  });
  it("does not silently match a different club in a supported country", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sports: [{ leagues: [{ teams: [{ team: { id: "1", name: "Other" } }] }] }] }))));
    expect((await loadTeamOverview({ id: "club:none", kind: "club", sport: "futbol", name: "Unknown", countryId: "arg" })).supported).toBe(false);
  });
});
