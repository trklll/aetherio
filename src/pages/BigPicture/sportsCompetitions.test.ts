import { describe, expect, it } from "vitest";
import { defaultSportsPreferences } from "../../data/sports/preferences.ts";
import { buildSportsCompetitions } from "./sportsCompetitions.ts";

describe("Competiciones que sigues", () => {
  it("shows every followed competition in saved order without needing events", () => {
    const prefs = { ...defaultSportsPreferences(), followedCompetitions: ["comp:eng-premier", "comp:esp-laliga"] };
    expect(buildSportsCompetitions(prefs).map(card => card.entity.id)).toEqual(["comp:eng-premier", "comp:esp-laliga"]);
  });

  it("ignores unknown ids, other entity kinds, and duplicates", () => {
    const prefs = { ...defaultSportsPreferences(), followedCompetitions: ["club:liverpool", "missing", "comp:esp-laliga", "comp:esp-laliga"] };
    expect(buildSportsCompetitions(prefs).map(card => card.entity.id)).toEqual(["comp:esp-laliga"]);
  });
});
