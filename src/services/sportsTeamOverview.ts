import type { SportsEntity } from "../data/sports/types";
import { normalizeLiveTeamKey } from "../types/liveSports";

interface EspnTeam { id?: string; name?: string; displayName?: string; shortDisplayName?: string; abbreviation?: string }
interface Stat { name?: string; value?: number; displayValue?: string }
interface Athlete { id?: string; displayName?: string; fullName?: string; jersey?: string; age?: number; citizenship?: string; headshot?: { href?: string }; position?: { abbreviation?: string }; statistics?: { splits?: { categories?: { stats?: Stat[] }[] } }; items?: Athlete[] }
interface StandingNode { name?: string; seasonDisplayName?: string; children?: StandingNode[]; standings?: { seasonDisplayName?: string; entries?: { team?: EspnTeam; stats?: Stat[] }[] } }
interface EspnEvent { id?: string; date?: string; name?: string; timeValid?: boolean; competitions?: { status?: { type?: { completed?: boolean; state?: string } }; competitors?: { team?: EspnTeam; homeAway?: string; score?: string | { displayValue?: string } }[] }[] }
interface Summary { rosters?: { team?: EspnTeam; formation?: string; roster?: { starter?: boolean; jersey?: string; position?: { abbreviation?: string }; athlete?: Athlete }[] }[] }
export interface TeamPlayer { id: string; name: string; jersey?: string; position?: string; photo?: string; age?: number; country?: string; goals?: string }
export interface TeamStanding { id: string; name: string; rank?: string; played?: string; wins?: string; draws?: string; losses?: string; goalsFor?: string; goalsAgainst?: string; difference?: string; points?: string }
export interface TeamStandingGroup { name: string; season?: string; rows: TeamStanding[] }
export interface TeamFixture { id: string; date?: string; name: string; home?: string; away?: string; score?: string; completed: boolean; live: boolean; timeValid: boolean }
export interface TeamOverview { supported: boolean; teamId?: string; league?: string; season?: string; standings: TeamStandingGroup[]; squad: TeamPlayer[]; fixtures: TeamFixture[]; lineup?: { formation?: string; players: TeamPlayer[]; match?: TeamFixture }; unavailable: string[]; fetchedAt: number }

const LEAGUES: Record<string, string> = {
  "comp:eng-premier": "eng.1", "comp:eng-championship": "eng.2", "comp:eng-league-one": "eng.3", "comp:eng-league-two": "eng.4",
  "comp:esp-laliga": "esp.1", "comp:esp-segunda": "esp.2", "comp:ita-serie-a": "ita.1", "comp:ger-bundesliga": "ger.1",
  "comp:fra-ligue1": "fra.1", "comp:per-liga1": "per.1",
};
const COUNTRY_LEAGUES: Record<string, string> = { eng: "eng.1", esp: "esp.1", ita: "ita.1", ger: "ger.1", fra: "fra.1", per: "per.1", arg: "arg.1", bra: "bra.1", chi: "chi.1", col: "col.1", ecu: "ecu.1", uru: "uru.1", par: "par.1", bol: "bol.1", ven: "ven.1", por: "por.1", ned: "ned.1", bel: "bel.1", sco: "sco.1", tur: "tur.1", gre: "gre.1", mex: "mex.1", usa: "usa.1", jap: "jpn.1", aus: "aus.1", sau: "ksa.1" };
const SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const cache = new Map<string, { expires: number; promise: Promise<unknown> }>();
// Shared per endpoint: switching clubs reuses the league table and team directory.
async function json<T>(url: string): Promise<T> {
  const existing = cache.get(url);
  if (existing && existing.expires > Date.now()) return existing.promise as Promise<T>;
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`ESPN ${response.status}`);
      return await response.json() as T;
    } finally { clearTimeout(timer); }
  })();
  if (cache.size >= 80) cache.delete(cache.keys().next().value!);
  cache.set(url, { expires: Date.now() + 300_000, promise });
  void promise.catch(() => { if (cache.get(url)?.promise === promise) cache.delete(url); });
  return promise;
}

export function findEspnTeam(teams: EspnTeam[], entity: Pick<SportsEntity, "name" | "aliases">) {
  const names = new Set([entity.name, ...(entity.aliases ?? [])].map(normalizeLiveTeamKey));
  const matches = teams.filter(team => [team.displayName, team.name, team.shortDisplayName].some(name => !!name && names.has(normalizeLiveTeamKey(name))));
  return matches.length === 1 ? matches[0] : undefined;
}
function stat(stats: Stat[] | undefined, name: string) {
  const item = stats?.find(value => value.name === name);
  return item?.displayValue || (typeof item?.value === "number" ? String(item.value) : undefined);
}
export function parseStandings(node: StandingNode): TeamStandingGroup[] {
  const rows = node.standings?.entries?.filter(entry => entry.team?.id).map(entry => ({
    id: entry.team!.id!, name: entry.team!.displayName ?? entry.team!.name ?? "Equipo",
    rank: stat(entry.stats, "rank"), played: stat(entry.stats, "gamesPlayed"), wins: stat(entry.stats, "wins"), draws: stat(entry.stats, "ties"), losses: stat(entry.stats, "losses"),
    goalsFor: stat(entry.stats, "pointsFor"), goalsAgainst: stat(entry.stats, "pointsAgainst"), difference: stat(entry.stats, "pointDifferential"), points: stat(entry.stats, "points"),
  })) ?? [];
  return [...(rows.length ? [{ name: node.name ?? "Clasificación", season: node.standings?.seasonDisplayName, rows }] : []), ...(node.children ?? []).flatMap(parseStandings)];
}
function player(athlete: Athlete): TeamPlayer {
  const stats = athlete.statistics?.splits?.categories?.flatMap(category => category.stats ?? []);
  return { id: athlete.id!, name: athlete.displayName ?? athlete.fullName ?? "Jugador", jersey: athlete.jersey, position: athlete.position?.abbreviation, photo: athlete.headshot?.href?.startsWith("https://") ? athlete.headshot.href : undefined, age: athlete.age, country: athlete.citizenship, goals: stat(stats, "totalGoals") };
}
export function parseRoster(data: { athletes?: Athlete[] }): TeamPlayer[] {
  return (data.athletes ?? []).flatMap(athlete => athlete.items ?? [athlete]).filter(athlete => athlete.id).map(player);
}
export function parseFixtures(data: { events?: EspnEvent[] }): TeamFixture[] {
  return (data.events ?? []).filter(event => event.id).map(event => {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find(team => team.homeAway === "home");
    const away = competition?.competitors?.find(team => team.homeAway === "away");
    const score = (value: typeof home) => typeof value?.score === "string" ? value.score : value?.score?.displayValue;
    const completed = competition?.status?.type?.completed === true;
    const live = competition?.status?.type?.state === "in";
    return { id: event.id!, date: event.date, name: event.name ?? `${home?.team?.displayName ?? "Local"} – ${away?.team?.displayName ?? "Visitante"}`, home: home?.team?.displayName, away: away?.team?.displayName,
      score: (completed || live) && score(home) !== undefined && score(away) !== undefined ? `${score(home)} – ${score(away)}` : undefined, completed, live, timeValid: event.timeValid === true };
  }).sort((a, b) => (Date.parse(a.date ?? "") || 0) - (Date.parse(b.date ?? "") || 0));
}
export function parseLineup(data: Summary, teamId: string) {
  const roster = data.rosters?.find(roster => roster.team?.id === teamId);
  const players = roster?.roster?.filter(entry => entry.starter && entry.athlete?.id).map(entry => player({ ...entry.athlete!, jersey: entry.jersey, position: entry.position })) ?? [];
  return players.length ? { formation: roster?.formation, players } : undefined;
}

export async function loadTeamOverview(entity: SportsEntity): Promise<TeamOverview> {
  const empty: TeamOverview = { supported: false, standings: [], squad: [], fixtures: [], unavailable: [], fetchedAt: Date.now() };
  const league = entity.kind === "national-team" ? "fifa.world" : LEAGUES[entity.competitionId ?? ""] ?? COUNTRY_LEAGUES[entity.countryId ?? ""];
  if (entity.sport !== "futbol" || !league) return empty;
  const directory = await json<{ sports?: { leagues?: { teams?: { team: EspnTeam }[] }[] }[] }>(`${SITE}${league}/teams?limit=1000`);
  const team = findEspnTeam(directory.sports?.flatMap(sport => sport.leagues?.flatMap(league => league.teams?.map(item => item.team) ?? []) ?? []) ?? [], entity);
  if (!team?.id) return empty;
  const result: TeamOverview = { ...empty, supported: true, teamId: team.id, league };
  const [standings, roster, schedule, details] = await Promise.allSettled([
    json<StandingNode>(`https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings`),
    json<{ athletes?: Athlete[]; season?: { displayName?: string } }>(`${SITE}${league}/teams/${team.id}/roster`),
    json<{ events?: EspnEvent[] }>(`${SITE}${league}/teams/${team.id}/schedule`),
    json<{ team?: { nextEvent?: EspnEvent[] } }>(`${SITE}${league}/teams/${team.id}`),
  ]);
  if (standings.status === "fulfilled") result.standings = parseStandings(standings.value); else result.unavailable.push("clasificación");
  if (roster.status === "fulfilled") { result.squad = parseRoster(roster.value); result.season = roster.value.season?.displayName; } else result.unavailable.push("plantilla");
  const fixtures = [...(schedule.status === "fulfilled" ? parseFixtures(schedule.value) : []), ...(details.status === "fulfilled" ? parseFixtures({ events: details.value.team?.nextEvent }) : [])];
  result.fixtures = [...new Map(fixtures.map(event => [event.id, event])).values()].sort((a, b) => (Date.parse(a.date ?? "") || 0) - (Date.parse(b.date ?? "") || 0));
  if (schedule.status === "rejected") result.unavailable.push("partidos");
  // A future fixture is never presented as a confirmed lineup. Prefer a live
  // match; otherwise fetch the most recent completed match, not array order.
  const completed = result.fixtures.filter(event => event.completed);
  const match = result.fixtures.find(event => event.live) ?? completed[completed.length - 1];
  if (match) {
    try {
      const lineup = parseLineup(await json<Summary>(`${SITE}${league}/summary?event=${match.id}`), team.id);
      if (lineup) result.lineup = { ...lineup, match };
    } catch { result.unavailable.push("alineación"); }
  }
  result.fetchedAt = Date.now();
  return result;
}
