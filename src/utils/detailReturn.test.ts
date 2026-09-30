import { describe, expect, it } from "vitest";
import { findDetailReturnDelta, makeScrollKey } from "./detailReturn.ts";

function history(entries: Array<[number, string]>) {
  return new Map(entries);
}

describe("makeScrollKey", () => {
  it("une pathname y search", () => {
    expect(makeScrollKey("/search", "?q=akira")).toBe("/search?q=akira");
  });

  it("ignora el search en ajustes", () => {
    expect(makeScrollKey("/settings", "?tab=account")).toBe("/settings");
  });
});

describe("findDetailReturnDelta", () => {
  it("vuelve al buscador desde el detail", () => {
    const h = history([
      [0, "/home"],
      [1, "/search?q=akira&literal=1"],
      [2, "/detail/movie/589?fromSearch=1&q=akira"],
    ]);
    expect(findDetailReturnDelta(h, 2, "/detail/movie/589?fromSearch=1&q=akira")).toBe(-1);
  });

  // El fallo real: al volver del reproductor su entrada se reescribe con
  // `replace: true` y queda en la MISMA ruta del detail con otra query.
  it("salta la misma pagina del detail con otra query (vuelta del reproductor)", () => {
    const h = history([
      [0, "/home"],
      [1, "/search?q=akira&literal=1"],
      [2, "/detail/movie/589?fromSearch=1&q=akira"],
      [3, "/detail/movie/589?fromStreams=1"],
    ]);
    // Desde la entrada 3 hay que llegar a la 1, no quedarse en la 2.
    expect(findDetailReturnDelta(h, 3, "/detail/movie/589?fromStreams=1")).toBe(-2);
  });

  it("ignora episode, streams y player como origen", () => {
    const h = history([
      [0, "/search?q=akira&literal=1"],
      [1, "/detail/movie/589?fromSearch=1&q=akira"],
      [2, "/streams?type=movie&id=tt0074548"],
      [3, "/player?type=movie&id=tmdb:589"],
    ]);
    // Se saltan /streams y /player, y tambien la entrada del propio detail
    // (misma ruta, otra query): el unico origen real es el buscador.
    expect(findDetailReturnDelta(h, 3, "/detail/movie/589?fromStreams=1")).toBe(-3);
  });

  it("desde el player recien salido, el detail previo tampoco cuenta como origen", () => {
    const h = history([
      [0, "/library"],
      [1, "/detail/movie/589?fromSearch=1&q=akira"],
      [2, "/player?type=movie&id=tmdb:589"],
    ]);
    expect(findDetailReturnDelta(h, 2, "/detail/movie/589?fromStreams=1")).toBe(-2);
  });

  it("detail a detail de otra obra si cuenta como origen", () => {
    const h = history([
      [0, "/home"],
      [1, "/detail/movie/589?fromSearch=1"],
      [2, "/detail/movie/1048?fromRelated=1"],
    ]);
    expect(findDetailReturnDelta(h, 2, "/detail/movie/1048?fromRelated=1")).toBe(-1);
  });

  it("devuelve null si no hay ningun origen utilizable", () => {
    const h = history([
      [0, "/player?type=movie&id=tmdb:589"],
      [1, "/detail/movie/589"],
    ]);
    expect(findDetailReturnDelta(h, 1, "/detail/movie/589")).toBeNull();
  });

  it("devuelve null con la entrada actual como unica candidata", () => {
    const h = history([[0, "/detail/movie/589?fromSearch=1"]]);
    expect(findDetailReturnDelta(h, 0, "/detail/movie/589?fromSearch=1")).toBeNull();
  });
});
