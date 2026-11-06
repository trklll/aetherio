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
});
