import { describe, expect, it, vi } from "vitest";
import type { CanonicalEvent } from "../data/sports/types.ts";
import { buildSportsMatchArtwork, buildSportsMatchArtworkForEvent, splitSportsMatchTitle, withSampledSportsMatchColors } from "./sportsMatchCards.ts";

describe("sports match card engine", () => {
  it("resolves two real local crests and team colors without fetching a poster", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const match = buildSportsMatchArtwork({ title: "Real Madrid vs Barcelona", sport: "futbol" });
      expect(match.home).toMatchObject({ name: "Real Madrid", color: "#FFFFFF", initials: "RM" });
      expect(match.away).toMatchObject({ color: "#A50044", initials: "BAR" });
      expect(match.home?.crest).toMatch(/^\/assets\/football-logos\/clubs\/.+\.svg$/);
      expect(match.away?.crest).toMatch(/^\/assets\/football-logos\/clubs\/.+\.svg$/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ["Hamburger SV", "/assets/football-logos/clubs/fl-hamburger-sv.svg"],
    ["Borussia M'gladbach", "/assets/football-logos/clubs/fl-borussia-monchengladbach.svg"],
    ["Borussia M’gladbach", "/assets/football-logos/clubs/fl-borussia-monchengladbach.svg"],
    ["Slavia Prague", "/assets/football-logos/clubs/fl-slavia-praha.svg"],
  ])("resolves the local crest for fixture alias %s", (name, crest) => {
    const match = buildSportsMatchArtwork({ title: `${name} vs Bayern Munich`, sport: "futbol", competitionName: "Bundesliga" });
    expect(match.home?.crest).toBe(crest);
  });

  it("resolves Oxford City from its own verified Football-Logos page", () => {
    const match = buildSportsMatchArtwork({ title: "Leicester City vs Oxford City", sport: "futbol" });
    expect(match.away?.crest).toBe("/assets/football-logos/clubs/fl-oxford-city.png");
    expect(match.away?.crest).not.toBe("/assets/football-logos/clubs/fl-oxford-united.svg");
  });

  it.each(["DA", "Deportivo A Coruña", "Deportivo La Coruña"])("resolves Deportivo abbreviation/name %s to its catalog crest", name => {
    const match = buildSportsMatchArtwork({ title: `Real Madrid vs ${name}`, sport: "futbol" });
    expect(match.away?.crest).toBe("/assets/football-logos/clubs/fl-deportivo-la-coruna.svg");
  });

  it("includes a verified local competition logo when the event has a known competition", () => {
    const match = buildSportsMatchArtwork({
      title: "Real Madrid vs Barcelona", sport: "futbol", competitionId: "comp:esp-laliga",
    });
    expect(match.competitionLogo).toBe("/assets/football-logos/competitions/esp-laliga.svg");
    expect(buildSportsMatchArtwork({ title: "Real Madrid vs Barcelona", sport: "futbol", competitionId: "comp:not-in-catalog" }).competitionLogo).toBeUndefined();
  });

  it("resolves the Europa Conference League badge from a replay title when its id is missing", () => {
    const match = buildSportsMatchArtwork({
      title: "Midtjylland vs Ajax - Europa Conference League", sport: "futbol",
    });
    expect(match.competitionLogo).toBe("/assets/football-logos/competitions/uefa-conference.svg");
  });

  it.each(["vs", "VS", "vs.", "v", "v.", "–", "—", "-"])("understands the %s match separator", separator => {
    expect(splitSportsMatchTitle(`Paris Saint-Germain ${separator} Real Madrid`)).toEqual(["Paris Saint-Germain", "Real Madrid"]);
  });

  it("keeps explicit participants authoritative over a decorative catalog title", () => {
    const match = buildSportsMatchArtwork({
      title: "Partido de la jornada", sport: "futbol",
      home: { name: "Arsenal" }, away: { name: "Chelsea" },
    });
    expect(match.home?.name).toBe("Arsenal");
    expect(match.away?.name).toBe("Chelsea");
    expect(match.home?.color).not.toBe(match.away?.color);
  });

  it("uses provider crests and valid colors for participants outside the registry", () => {
    const match = buildSportsMatchArtwork({
      title: "Aurora Norte vs Deportivo Sur", sport: "futbol",
      home: { name: "Aurora Norte", crest: "https://teams.test/aurora.png", color: "#abc" },
      away: { name: "Deportivo Sur", crest: "/sports-test-away.png", color: "#123456" },
    });
    expect(match.home).toMatchObject({ crest: "https://teams.test/aurora.png", color: "#AABBCC", initials: "AN" });
    expect(match.away).toMatchObject({ crest: "/sports-test-away.png", color: "#123456", initials: "DS" });
  });

  it("keeps known Peruvian clubs on their registered colors instead of provider palettes", () => {
    const match = buildSportsMatchArtwork({
      title: "Cusco vs FBC Melgar", sport: "futbol",
      home: { name: "Cusco", color: "#123456" },
      away: { name: "FBC Melgar", color: "#654321" },
    });
    expect(match.home).toMatchObject({ color: "#D2A544", crest: "/assets/football-logos/peru/primera-division/512x512/cusco.1a6f0822.png" });
    expect(match.away).toMatchObject({ color: "#C8102E", crest: "/assets/football-logos/peru/primera-division/512x512/melgar.8445d24d.png" });
  });

  it("uses crest-sampled colors in the playback match while preserving other match metadata", () => {
    const match = buildSportsMatchArtwork({ title: "Atalanta vs Kairat - Europa Conference League", sport: "futbol" });
    const playback = withSampledSportsMatchColors(match, { home: "#1267A8", away: "#D8B629" });
    expect(playback?.home?.color).toBe("#1267A8");
    expect(playback?.away?.color).toBe("#D8B629");
    expect(playback?.competitionLogo).toBe(match.competitionLogo);
    expect(withSampledSportsMatchColors(match, undefined)).toBe(match);
  });

  it("builds playback artwork from the same canonical event metadata used by Ahora mismo", () => {
    const event: CanonicalEvent = {
      id: "sports:event-1", providerId: "sports", sport: "futbol", status: "live",
      title: "Aurora Norte vs Deportivo Sur", timePrecision: "exact", competitionId: "comp:esp-laliga",
      home: { name: "Aurora Norte" }, away: { name: "Deportivo Sur" }, participants: [], sources: [], confidence: "partial",
      raw: {
        id: "event-1", title: "Aurora Norte vs Deportivo Sur", sport: "futbol", league: "La Liga", status: "live",
        startsAt: "2026-11-08T18:00:00Z", sources: [],
        home: { name: "Aurora Norte", logo: "https://teams.test/aurora.png", color: "#123456" },
        away: { name: "Deportivo Sur", logo: "https://teams.test/sur.png", color: "#ABCDEF" },
      },
    };

    const match = buildSportsMatchArtworkForEvent(event);

    expect(match.competitionLogo).toBe("/assets/football-logos/competitions/esp-laliga.svg");
    expect(match.home).toMatchObject({ crest: "https://teams.test/aurora.png", color: "#123456" });
    expect(match.away).toMatchObject({ crest: "https://teams.test/sur.png", color: "#ABCDEF" });
  });

  it("prefers the verified local crest and retains the provider crest as a fallback", () => {
    const match = buildSportsMatchArtwork({
      title: "Real Madrid vs Barcelona", sport: "futbol",
      home: { name: "Real Madrid", crest: "https://teams.test/madrid.png" },
    });
    expect(match.home?.crest).toMatch(/^\/assets\/football-logos\/clubs\//);
    expect(match.home?.fallbackCrest).toBe("https://teams.test/madrid.png");
  });

  it("does not turn women or youth squads into the senior team's crest", () => {
    const match = buildSportsMatchArtwork({ title: "Real Madrid U21 vs Barcelona Women", sport: "futbol" });
    expect(match.home?.crest).toBeUndefined();
    expect(match.away?.crest).toBeUndefined();
  });

  it("uses national flags without cropping them into invented club badges", () => {
    const match = buildSportsMatchArtwork({ title: "Peru vs Chile", sport: "futbol" });
    expect(match.home?.crest).toMatch(/\/countries\/nt-peru\./);
    expect(match.away?.crest).toMatch(/\/countries\/nt-chile\./);
  });

  it("resolves basketball team and league logos from SportsLogos by league context", () => {
    const match = buildSportsMatchArtwork({ title: "Lakers vs Boston Celtics", sport: "baloncesto", competitionName: "NBA" });
    expect(match.home?.crest).toBe("/assets/basketball-logos/teams/6/237.gif");
    expect(match.away?.crest).toBe("/assets/basketball-logos/teams/6/213.gif");
    expect(match.competitionLogo).toBe("/assets/basketball-logos/leagues/6.gif");
  });

  it("does not guess a basketball crest for a name missing from the downloaded list", () => {
    const match = buildSportsMatchArtwork({ title: "Unknown Club vs Another Club", sport: "baloncesto", competitionName: "NBA" });
    expect(match.home?.crest).toBeUndefined();
    expect(match.away?.crest).toBeUndefined();
  });

  it("uses stable initials and colors when no team identity is known", () => {
    const input = { title: "Deportivo Sin Ficha vs Aurora Norte", sport: "futbol" };
    const match = buildSportsMatchArtwork(input);
    expect(match).toEqual(buildSportsMatchArtwork(input));
    expect(match.home).toMatchObject({ name: "Deportivo Sin Ficha", initials: "DS" });
    expect(match.home?.crest).toBeUndefined();
    expect(match.home?.color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it.each(["javascript:alert(1)", "file:///C:/logo.png", "//outside.test/logo.png", "http://outside.test/logo.png", "https://user:secret@teams.test/logo.png"])("rejects unsafe crest URLs: %s", crest => {
    const match = buildSportsMatchArtwork({ title: "Aurora vs Sur", home: { name: "Aurora", crest, color: "red; background: url(https://outside.test)" } });
    expect(match.home?.crest).toBeUndefined();
    expect(match.home?.color).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("supports a loopback crest in the Tauri development runtime", () => {
    const match = buildSportsMatchArtwork({ title: "Aurora vs Sur", home: { name: "Aurora", crest: "http://127.0.0.1:7310/team.png" } });
    expect(match.home?.crest).toBe("http://127.0.0.1:7310/team.png");
  });

  it("does not manufacture two opponents for a tournament or fight card", () => {
    const match = buildSportsMatchArtwork({ title: "UFC 350: Main Card", sport: "mma" });
    expect(match.home).toBeUndefined();
    expect(match.away).toBeUndefined();
    expect(match.label).toBe("MMA");
    expect(splitSportsMatchTitle("Grand Prix de Brasil")).toBeNull();
    expect(splitSportsMatchTitle(" vs ")).toBeNull();
  });
});
