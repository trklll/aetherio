import { describe, expect, it } from "vitest";

import { normalizeGenreLabel } from "../lib/genre-label";

describe("normalizeGenreLabel", () => {
  it("deja intactos los generos que ya son una palabra", () => {
    for (const genre of ["Drama", "Crimen", "Animación", "Acción", "Thriller", "Terror"]) {
      expect(normalizeGenreLabel(genre)).toBe(genre);
    }
  });

  it("no traduce Sci-Fi, que es el termino que se usa en espanol", () => {
    expect(normalizeGenreLabel("Sci-Fi")).toBe("Sci-Fi");
    expect(normalizeGenreLabel("Science Fiction")).toBe("Science Fiction");
  });

  it("parte los generos compuestos de TMDB por la primera mitad", () => {
    // Estos son los nombres literales que devuelve /genre/{movie,tv}/list?language=es
    expect(normalizeGenreLabel("Ciencia ficción y fantasía")).toBe("Ciencia ficción");
    expect(normalizeGenreLabel("Acción y aventura")).toBe("Acción");
    expect(normalizeGenreLabel("Acción y aventuras")).toBe("Acción");
    expect(normalizeGenreLabel("Guerra y política")).toBe("Guerra");
  });

  it("parte por coma cuando el upstream usa coma en vez de 'y'", () => {
    expect(normalizeGenreLabel("Guerra, política")).toBe("Guerra");
  });

  it("acorta los compuestos sin perder la palabra que ya estaba en espanol", () => {
    expect(normalizeGenreLabel("Aventura y acción")).toBe("Aventura");
    expect(normalizeGenreLabel("Crimen y misterio")).toBe("Crimen");
  });

  it("tolera acentos y mayusculas distintos", () => {
    expect(normalizeGenreLabel("ACCION Y AVENTURA")).toBe("Acción");
    expect(normalizeGenreLabel("ciencia ficción y fantasía")).toBe("Ciencia ficción");
    expect(normalizeGenreLabel("  Drama  ")).toBe("Drama");
  });

  it("devuelve vacio ante null/undefined/vacio en vez de romperse", () => {
    expect(normalizeGenreLabel(null)).toBe("");
    expect(normalizeGenreLabel(undefined)).toBe("");
    expect(normalizeGenreLabel("   ")).toBe("");
  });

  it("no parte un ' y ' pegado, porque ahi no se sabe donde cortar", () => {
    // "Accion&Aventura" no lleva espacios: partirlo a ciegas dejaria media
    // palabra pegada, que se ve peor que el nombre entero.
    expect(normalizeGenreLabel("Accion yAventura")).toBe("Accion yAventura");
  });

  it("parte los compuestos con ampersand, como los escribe Stremio", () => {
    expect(normalizeGenreLabel("Sci-Fi & Fantasy")).toBe("Sci-Fi");
    expect(normalizeGenreLabel("War & Politics")).toBe("Guerra");
    expect(normalizeGenreLabel("Action & Adventure")).toBe("Acción");
  });

  it("deja pasar un genero compuesto desconocido en vez de perderlo", () => {
    // Mejor "Musica y algo mas" que una cadena vacia.
    expect(normalizeGenreLabel("Musica y algo mas")).toBe("Musica");
  });
});
