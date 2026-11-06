import type { SportsEntity } from "../data/sports/types";
import type { TeamHonours } from "../data/sports/teamHonours";
import { normalizeLiveTeamKey } from "../types/liveSports";
import { sportsDataJson } from "./sportsDataHttp";
import { array, identifier, numeric, object, text } from "./sportsDataValues";

export interface TeamPlayer { id: string; name: string; jersey?: string; position?: string; photo?: string; age?: number; country?: string; goals?: string }
export interface TeamStanding { id: string; name: string; rank?: string; played?: string; wins?: string; draws?: string; losses?: string; goalsFor?: string; goalsAgainst?: string; difference?: string; points?: string }
export interface TeamStandingGroup { name: string; season?: string; rows: TeamStanding[] }
export interface TeamFixture { id: string; date?: string; name: string; home?: string; away?: string; score?: string; completed: boolean; live: boolean; timeValid: boolean; cancelled?: boolean }
export interface TeamOverview {
  supported: boolean; provider: "FotMob"; teamId?: string; league?: string; season?: string; venue?: string; city?: string;
  standings: TeamStandingGroup[]; squad: TeamPlayer[]; fixtures: TeamFixture[];
  lineup?: { formation?: string; players: TeamPlayer[]; match?: TeamFixture };
  honours?: TeamHonours; unavailable: string[]; fetchedAt: number;
}

const BASE = "https://www.fotmob.com/api/data";
// IDs checked against actual responses for the user's four MVP teams.
const VERIFIED_IDS: Record<string, string> = { "club:man-city": "8456", "club:man-utd": "10260", "club:fl-alianza-lima": "6398", "club:fl-atletico-grau": "920789" };
const COUNTRY_CODES: Record<string, string> = { eng: "ENG", esp: "ESP", per: "PER", ita: "ITA", ger: "GER", fra: "FRA", por: "POR", ned: "NED", arg: "ARG", bra: "BRA", chi: "CHI", col: "COL", uru: "URU", ecu: "ECU", par: "PAR", bol: "BOL", ven: "VEN", mex: "MEX", usa: "USA", sco: "SCO" };
const overviewCache = new Map<string, { promise: Promise<TeamOverview>; expires: number; pending: boolean }>();
const positionNames = ["Portero", "Defensa", "Centrocampista", "Delantero"];

function entityNames(entity: Pick<SportsEntity, "name" | "aliases">) {
  return new Set([entity.name, ...(entity.aliases ?? [])].map(normalizeLiveTeamKey));
}
export function findFotmobTeam(payload: unknown, entity: Pick<SportsEntity, "name" | "aliases">): string | undefined {
  const names = entityNames(entity);
  const matches = new Set<string>();
  for (const group of array(payload)) for (const value of array(object(group).suggestions)) {
    const suggestion = object(value);
    const id = identifier(suggestion.id);
    if (id && suggestion.type === "team" && names.has(normalizeLiveTeamKey(text(suggestion.name)))) matches.add(id);
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

function standingRows(value: unknown): TeamStanding[] {
  return array(value).flatMap(value => {
    const row = object(value); const id = identifier(row.id); const name = text(row.name);
    if (!id || !name) return [];
    const score = text(row.scoresStr)?.match(/^(\d+)\s*-\s*(\d+)$/);
    return [{ id, name, rank: numeric(row.idx), played: numeric(row.played), wins: numeric(row.wins), draws: numeric(row.draws), losses: numeric(row.losses),
      goalsFor: score?.[1], goalsAgainst: score?.[2], difference: numeric(row.goalConDiff), points: numeric(row.pts) }];
  });
}
export function parseStandings(payload: unknown): TeamStandingGroup[] {
  const root = object(payload); const season = text(object(root.details).latestSeason);
  function groups(value: unknown): TeamStandingGroup[] {
    const table = object(value); const name = text(table.leagueName) ?? "Clasificación";
    const rows = standingRows(object(table.table).all);
    const annual = standingRows(object(table.annualTable).table);
    return [
      ...(annual.length ? [{ name: `Acumulada · ${name}`, season, rows: annual }] : []),
      ...(rows.length ? [{ name, season, rows }] : []),
      ...array(table.tables).flatMap(groups),
    ];
  }
  return array(root.table).flatMap(value => groups(object(value).data));
}

function player(value: unknown): TeamPlayer | undefined {
  const item = object(value); const id = identifier(item.id); const name = text(item.name);
  if (!id || !name) return undefined;
  const position = numeric(item.usualPlayingPositionId ?? item.positionId);
  return { id, name, jersey: numeric(item.shirtNumber), position: position === undefined ? undefined : positionNames[Number(position)],
    photo: `https://images.fotmob.com/image_resources/playerimages/${id}.png`, age: typeof item.age === "number" ? item.age : undefined,
    country: text(item.cname) ?? text(item.countryName) };
}
export function parseRoster(payload: unknown): TeamPlayer[] {
  const players = array(object(object(payload).squad).squad).flatMap(value => {
    const group = object(value);
    return group.title === "coach" ? [] : array(group.members).flatMap(value => { const member = player(value); return member ? [member] : []; });
  });
  return [...new Map(players.map(member => [member.id, member])).values()];
}

function fixture(value: unknown): TeamFixture | undefined {
  const item = object(value); const id = identifier(item.id); if (!id) return undefined;
  const status = object(item.status); const home = text(object(item.home).name); const away = text(object(item.away).name);
  const completed = status.finished === true; const cancelled = status.cancelled === true;
  const live = status.started === true && !completed && !cancelled;
  return { id, date: text(status.utcTime), name: `${home ?? "Local"} — ${away ?? "Visitante"}`, home, away, completed, live, cancelled,
    score: completed || live ? text(status.scoreStr)?.replace(/\s*-\s*/g, " – ") : undefined,
    timeValid: !!text(status.utcTime) && !cancelled };
}
export function parseFixtures(payload: unknown): TeamFixture[] {
  const fixtures = array(object(object(object(payload).fixtures).allFixtures).fixtures).flatMap(value => { const match = fixture(value); return match ? [match] : []; });
  return [...new Map(fixtures.map(match => [match.id, match])).values()].sort((a, b) => (Date.parse(a.date ?? "") || 0) - (Date.parse(b.date ?? "") || 0));
}
export function parseLineup(payload: unknown, teamId: string): TeamOverview["lineup"] {
  const overview = object(object(payload).overview); const lineup = object(overview.lastLineupStats);
  if (identifier(lineup.id) !== teamId) return undefined;
  const players = array(lineup.starters).flatMap(value => { const member = player(value); return member ? [member] : []; });
  if (!players.length) return undefined;
  const matchId = identifier(object(lineup.lastMatch).matchId);
  const match = parseFixtures(payload).find(match => match.id === matchId && (match.completed || match.live))
    ?? (identifier(object(overview.lastMatch).id) === matchId ? fixture(overview.lastMatch) : undefined);
  return { formation: text(lineup.formation), players, match };
}
export function parseHonours(payload: unknown): TeamHonours | undefined {
  const root = object(payload);
  const competitions = array(object(root.history).trophyList).flatMap(value => {
    const entry = object(value); const count = Number(numeric(entry.won)); const name = text(entry.name);
    return name && Number.isInteger(count) && count > 0 ? [{ name, count, seasons: text(entry.seasonsWon)?.replace(/,/g, ", ") ?? "Temporadas no informadas" }] : [];
  });
  const id = identifier(object(root.details).id);
  return competitions.length && id ? { competitions, partial: true, checkedAt: new Date().toISOString(), source: `https://www.fotmob.com/teams/${id}/history` } : undefined;
}

function applyScorers(players: TeamPlayer[], payload: unknown, teamId: string) {
  const scores = new Map<string, string>();
  for (const topList of array(object(payload).TopLists)) for (const value of array(object(topList).StatList)) {
    const entry = object(value); const id = identifier(entry.ParticiantId); const goals = numeric(entry.StatValue);
    if (id && goals !== undefined && identifier(entry.TeamId) === teamId) scores.set(id, goals);
  }
  for (const member of players) if (scores.has(member.id)) member.goals = scores.get(member.id);
}

async function fetchOverview(entity: SportsEntity, refresh: boolean): Promise<TeamOverview> {
  const empty: TeamOverview = { supported: false, provider: "FotMob", standings: [], squad: [], fixtures: [], unavailable: [], fetchedAt: Date.now() };
  if (entity.sport !== "futbol" || !["club", "national-team"].includes(entity.kind)) return empty;
  const id = VERIFIED_IDS[entity.id] ?? findFotmobTeam(await sportsDataJson(`${BASE}/search/suggest?term=${encodeURIComponent(entity.name.slice(0, 120))}`, { refresh }), entity);
  if (!id) return empty;
  const raw = object(await sportsDataJson(`${BASE}/teams?id=${id}`, { refresh }));
  const details = object(raw.details);
  if (identifier(details.id) !== id || !entityNames(entity).has(normalizeLiveTeamKey(text(details.name)))
    || details.gender === "female" || (COUNTRY_CODES[entity.countryId ?? ""] && text(details.country) !== COUNTRY_CODES[entity.countryId!])) {
    throw new Error("La identidad del equipo devuelta por FotMob no coincide con el catálogo");
  }
  const squad = parseRoster(raw);
  const statistics = array(object(raw.stats).players).map(object).find(entry => entry.name === "goals");
  // The squad endpoint can carry placeholder zeroes (notably in Peru). Only
  // published scorer statistics may populate the goals column.
  for (const value of array(statistics?.topThree)) {
    const entry = object(value); const member = squad.find(member => member.id === identifier(entry.id));
    if (member && identifier(entry.teamId) === id) member.goals = numeric(entry.value);
  }
  const unavailable: string[] = [];
  const statsUrl = text(statistics?.fetchAllUrl);
  if (statsUrl) {
    try { applyScorers(squad, await sportsDataJson(statsUrl, { refresh }), id); }
    catch { unavailable.push("estadísticas completas"); }
  }
  const venue = object(object(object(raw.overview).venue).widget);
  return { ...empty, supported: true, teamId: id, league: text(details.primaryLeagueName), season: text(details.latestSeason),
    venue: text(venue.name), city: text(venue.city), squad, standings: parseStandings(raw), fixtures: parseFixtures(raw), lineup: parseLineup(raw, id),
    honours: parseHonours(raw), unavailable, fetchedAt: Date.now() };
}

export function loadTeamOverview(entity: SportsEntity, options: { refresh?: boolean } = {}): Promise<TeamOverview> {
  const key = [entity.id, entity.name, entity.countryId, entity.sport, entity.kind].join("|");
  const cached = overviewCache.get(key);
  if (cached && (cached.pending || (!options.refresh && cached.expires > Date.now()))) return cached.promise;
  if (overviewCache.size >= 40) overviewCache.delete(overviewCache.keys().next().value!);
  const entry = { promise: fetchOverview(entity, !!options.refresh), expires: 0, pending: true };
  overviewCache.set(key, entry);
  void entry.promise.then(() => { entry.pending = false; entry.expires = Date.now() + 300_000; }, () => { if (overviewCache.get(key) === entry) overviewCache.delete(key); });
  return entry.promise;
}
