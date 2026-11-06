/** Synthetic fixture shaped like the public team JSON; never shipped as live data. */
export function fotmobTeamFixture(id = 6398, name = "Alianza Lima", peru = true) {
  const row = { id, name, idx: 1, pts: 68, played: 32, wins: 20, draws: 8, losses: 4, scoresStr: "53-23", goalConDiff: 30 };
  const match = { id: 100, home: { id, name, score: 2 }, away: { id: 200, name: "Rival", score: 0 }, status: { utcTime: "2026-11-01T15:00:00Z", finished: true, started: true, scoreStr: "2 - 0" } };
  const squad = [{ title: "coach", members: [{ id: 99, name: "Entrenador" }] }, { title: "attackers", members: [{ id: 1, name: "Jugador de prueba", shirtNumber: 9, age: 24, cname: "Perú", positionId: 3, goals: 0 }, { id: 2, name: "Otro jugador", positionId: 3, goals: 0 }] }];
  return {
    details: { id, name, gender: "male", type: "team", country: peru ? "PER" : "ENG", latestSeason: "2026", primaryLeagueId: peru ? 131 : 47, primaryLeagueName: peru ? "Liga 1" : "Premier League" },
    table: [{ data: peru ? { leagueId: 131, leagueName: "Liga 1", composite: true, annualTable: { name: "Liga 1", table: [row] }, tables: [{ leagueName: "Clausura", table: { all: [{ ...row, pts: 28, played: 15 }] } }, { leagueName: "Apertura", table: { all: [{ ...row, pts: 40, played: 17 }] } }] } : { leagueId: 47, leagueName: "Premier League", table: { all: [row] } } }],
    squad: { squad },
    fixtures: { allFixtures: { fixtures: [match, { id: 101, home: { id, name }, away: { id: 201, name: "Siguiente rival" }, status: { utcTime: "2026-12-01T15:00:00Z", started: false, finished: false } }] } },
    overview: { venue: { widget: { name: "Estadio de prueba", city: "Lima" } }, lastMatch: match, lastLineupStats: { id, formation: "4-4-2", starters: [{ id: 1, name: "Jugador de prueba", shirtNumber: "9", usualPlayingPositionId: 3 }], lastMatch: { matchId: 100, homeTeamId: id, awayTeamId: 200 } } },
    stats: { players: [{ name: "goals", fetchAllUrl: "https://data.fotmob.com/stats/131/season/123/goals.json", topThree: [{ id: 1, teamId: id, value: 7 }] }] },
    history: { trophyList: [{ name: "Copa de prueba", won: 1, runnerup: 0, seasonsWon: "2020" }, { name: "Otra copa", won: 0, runnerup: 1, seasonsWon: "" }] },
  };
}
