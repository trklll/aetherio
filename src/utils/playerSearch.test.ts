import { describe, expect, it } from "vitest";
import { buildPlayerSearch } from "./playerSearch.ts";

describe("buildPlayerSearch", () => {
  it("usa el query resuelto cuando la URL no lleva search params (Episodie embebido en Detail)", () => {
    // /detail/movie/tt0074548 no tiene search: sin esto el reproductor queda sin identidad.
    const params = new URLSearchParams("");
    const search = buildPlayerSearch(params, { type: "movie", id: "tt0074548" });
    expect(new URLSearchParams(search).get("type")).toBe("movie");
    expect(new URLSearchParams(search).get("id")).toBe("tt0074548");
  });

  it("manda temporada y capitulo desde el query resuelto", () => {
    const params = new URLSearchParams("");
    const parsed = new URLSearchParams(
      buildPlayerSearch(params, { type: "series", id: "tt0903747", season: 2, episode: 5 }),
    );
    expect(parsed.get("season")).toBe("2");
    expect(parsed.get("ep")).toBe("5");
  });

  it("respeta la ruta clasica con search params", () => {
    const params = new URLSearchParams("type=series&id=tt0903747&season=1&ep=2&fromSearch=1&q=akira");
    const parsed = new URLSearchParams(
      buildPlayerSearch(params, { type: "series", id: "tt0903747", season: 1, episode: 2 }),
    );
    expect(parsed.get("type")).toBe("series");
    expect(parsed.get("id")).toBe("tt0903747");
    expect(parsed.get("season")).toBe("1");
    expect(parsed.get("ep")).toBe("2");
    expect(parsed.get("fromSearch")).toBe("1");
    expect(parsed.get("q")).toBe("akira");
  });

  it("cae a los search params cuando no hay query resuelto", () => {
    const params = new URLSearchParams("type=movie&id=tmdb:589");
    const parsed = new URLSearchParams(buildPlayerSearch(params, null));
    expect(parsed.get("type")).toBe("movie");
    expect(parsed.get("id")).toBe("tmdb:589");
  });

  it("conserva temporada 0 (especiales) y descarta capitulo invalido", () => {
    const specials = new URLSearchParams(buildPlayerSearch(new URLSearchParams(""), {
      type: "series",
      id: "tt1",
      season: 0,
      episode: 1,
    }));
    expect(specials.get("season")).toBe("0");
    expect(specials.get("ep")).toBe("1");

    const invalid = new URLSearchParams(
      buildPlayerSearch(new URLSearchParams("ep=0&season=abc"), { type: "series", id: "tt1" }),
    );
    expect(invalid.get("ep")).toBeNull();
    expect(invalid.get("season")).toBeNull();
  });

  it("no inventa type/id si no hay ni query ni params", () => {
    expect(buildPlayerSearch(new URLSearchParams(""), null)).toBe("");
  });
});
