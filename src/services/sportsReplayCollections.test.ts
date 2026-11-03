import { describe, expect, it } from "vitest";
import { defaultSportsPreferences } from "../data/sports/preferences.ts";
import type { SportsPreferences } from "../data/sports/types.ts";
import {
  buildSportsReplayPlan,
  decodeReplayPageHandle,
  encodeReplayPageHandle,
  sportsReplayPlanSignature,
} from "./sportsReplayCollections.ts";

function prefs(patch: Partial<SportsPreferences> = {}): SportsPreferences {
  return { ...defaultSportsPreferences(), ...patch };
}

const catalogIds = (patch: Partial<SportsPreferences> = {}) =>
  buildSportsReplayPlan(prefs(patch)).sources.map(source => (source.kind === "generic" ? "generic" : source.catalogId));

describe("plan curado de Repeticiones", () => {
  it("sin nada elegido cae en la cola genérica infinita, como siempre", () => {
    const plan = buildSportsReplayPlan(prefs());
    expect(plan.sources).toEqual([{ kind: "generic" }]);
    expect(plan.personalized).toBe(false);
  });

  it("con solo fútbol elegido recorre los buckets y el archivo, sin cola genérica", () => {
    expect(catalogIds({ sports: ["futbol"] })).toEqual([
      "nuvio_sports_replays_football_today",
      "nuvio_sports_replays_football_yesterday",
      "nuvio_sports_replays_football_this_week",
      "nuvio_sports_replays_football_older",
    ]);
  });

  it("suma el catálogo curado de cada competición seguida que el addon cura", () => {
    expect(catalogIds({ sports: ["futbol"], followedCompetitions: ["comp:esp-laliga", "comp:eng-premier", "comp:uefa-champions"] })).toEqual([
      "nuvio_sports_replays_football_today",
      "nuvio_sports_replays_football_yesterday",
      "nuvio_sports_replays_football_this_week",
      "nuvio_sports_replays_football_premier_league",
      "nuvio_sports_replays_football_ucl",
      "nuvio_sports_replays_football_older",
    ]);
    const plan = buildSportsReplayPlan(prefs({ sports: ["futbol"], followedCompetitions: ["comp:eng-premier"] }));
    const premier = plan.sources.find(source => source.kind === "catalog" && source.catalogId.includes("premier_league"));
    expect(premier).toMatchObject({ competitionId: "comp:eng-premier" });
  });

  it("deja LaLiga, sin carpeta propia del addon, a los buckets que casan por título", () => {
    expect(catalogIds({ sports: ["futbol"], followedCompetitions: ["comp:esp-laliga"] })).toEqual([
      "nuvio_sports_replays_football_today",
      "nuvio_sports_replays_football_yesterday",
      "nuvio_sports_replays_football_this_week",
      "nuvio_sports_replays_football_older",
    ]);
  });

  it("con MMA elegido agrega la cola genérica al final del plan", () => {
    expect(catalogIds({ sports: ["futbol", "mma"] })).toEqual([
      "nuvio_sports_replays_football_today",
      "nuvio_sports_replays_football_yesterday",
      "nuvio_sports_replays_football_this_week",
      "nuvio_sports_replays_football_older",
      "generic",
    ]);
    expect(catalogIds({ sports: ["mma"] })).toEqual(["generic"]);
  });

  it("deduce el deporte de lo seguido aunque no se hayan elegido deportes", () => {
    expect(catalogIds({ followedCompetitions: ["comp:esp-laliga"] })).toEqual([
      "nuvio_sports_replays_football_today",
      "nuvio_sports_replays_football_yesterday",
      "nuvio_sports_replays_football_this_week",
      "nuvio_sports_replays_football_older",
    ]);
    expect(catalogIds({ followedOrganizations: ["org:ufc"] })).toEqual(["generic"]);
  });

  it("las carpetas no elegibles de la colección quedan fuera del plan", () => {
    const plan = buildSportsReplayPlan(prefs({ sports: ["futbol", "mma"] }));
    expect(plan.sources.every(source => source.kind === "generic" || source.catalogId.startsWith("nuvio_sports_replays_football")
      || source.catalogId === "nuvio_sports_catalog/genre=Replays")).toBe(true);
  });

  it("codifica direcciones de página fuente+skip que se decodifican idénticas", () => {
    expect(encodeReplayPageHandle(0, 300)).toBe(300);
    expect(encodeReplayPageHandle(2, 40)).toBe(2_000_040);
    expect(decodeReplayPageHandle(2_000_040)).toEqual({ sourceIndex: 2, skip: 40 });
    expect(decodeReplayPageHandle(300)).toEqual({ sourceIndex: 0, skip: 300 });
    expect(decodeReplayPageHandle(Number.NaN)).toEqual({ sourceIndex: 0, skip: 0 });
  });

  it("la firma del plan cambia solo con las preferencias que importan", () => {
    const base = sportsReplayPlanSignature(prefs({ sports: ["futbol"] }));
    expect(sportsReplayPlanSignature(prefs({ sports: ["futbol"], view: "para-ti" }))).toBe(base);
    expect(sportsReplayPlanSignature(prefs({ sports: ["futbol"], followedCompetitions: ["comp:uefa-champions"] }))).not.toBe(base);
    expect(sportsReplayPlanSignature(prefs({ sports: ["mma"] }))).not.toBe(base);
  });
});
