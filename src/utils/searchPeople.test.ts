import { describe, expect, it } from "vitest";
import { isNameMatch, normalizeName, pickTopNameMatch, TOP_MATCH_POPULARITY } from "./searchPeople";

describe("isNameMatch", () => {
  it("acepta el nombre completo, con y sin acentos ni mayúsculas", () => {
    expect(isNameMatch("Inde Navarrete", "inde navarrete")).toBe(true);
    expect(isNameMatch("Inde Navarrete", "INDE NAVARRETE")).toBe(true);
    expect(isNameMatch("Pepe Martínez", "pepe martinez")).toBe(true);
  });

  it("acepta el nombre escrito a medias (prefijo)", () => {
    // El caso que rompía la tab de reparto: "navar" no es "navarrete".
    expect(isNameMatch("Inde Navarrete", "inde navar")).toBe(true);
    expect(isNameMatch("Inde Navarrete", "navar")).toBe(true);
    expect(isNameMatch("Inde Navarrete", "inde")).toBe(true);
    expect(isNameMatch("Inde Navarrete", "navarre")).toBe(true);
  });

  it("tolera un typo en el token, no solo el prefijo", () => {
    expect(isNameMatch("Inde Navarrete", "inde navarrette")).toBe(true);
    expect(isNameMatch("Inde Navarrete", "inde naavrrete")).toBe(true);
  });

  it("acepta solo un nombre o solo un apellido", () => {
    expect(isNameMatch("Inde Navarrete", "navarrete")).toBe(true);
    expect(isNameMatch("Inde Navarrete", "inde")).toBe(true);
    expect(isNameMatch("Anne Hathaway", "anne")).toBe(true);
    expect(isNameMatch("Anne Hathaway", "hathaway")).toBe(true);
  });

  it("rechaza los homónimos difusos que devuelve TMDB", () => {
    // Buscando "nnn": "st4nn" no es el nombre, aunque TMDB lo devuelva.
    expect(isNameMatch("st4nn", "nnn")).toBe(false);
    // Un apellido no es el otro apellido: 1 edit a 5 letras es demasiado poco
    // para darlo por bueno.
    expect(isNameMatch("Jonathan Banks", "hanks")).toBe(false);
    expect(isNameMatch("Inde Navarrete", "nvaro")).toBe(false);
  });

  it("no deja que un prefijo corto valide cualquier nombre", () => {
    expect(isNameMatch("Ana Lily Amirpour", "an")).toBe(false);
    expect(isNameMatch("Ana Lily Amirpour", "am")).toBe(false);
    // Con 3+ letras el prefijo sí cuenta.
    expect(isNameMatch("Ana Lily Amirpour", "ami")).toBe(true);
  });

  it("exige que TODOS los tokens de la query estén cubiertos", () => {
    expect(isNameMatch("Inde", "inde navarrete")).toBe(false);
    expect(isNameMatch("Pepe", "pepe martinez")).toBe(false);
  });

  it("no casa con entradas vacías", () => {
    expect(isNameMatch("", "inde")).toBe(false);
    expect(isNameMatch("Inde Navarrete", "")).toBe(false);
    expect(isNameMatch("   ", "inde")).toBe(false);
  });
});

describe("normalizeName", () => {
  it("quita acentos, baja a minúsculas y colapsa espacios", () => {
    expect(normalizeName("  José  María  ")).toBe("jose maria");
    expect(normalizeName("Pepe Martínez")).toBe("pepe martinez");
  });
});

describe("pickTopNameMatch", () => {
  const people = [
    { name: "st4nn", popularity: 4 },
    { name: "Inde Navarrete", popularity: 12 },
    { name: "Inde Navarro", popularity: 9 },
  ];

  it("devuelve la persona buscada, ignorando los homónimos", () => {
    expect(pickTopNameMatch(people, "inde navar")?.name).toBe("Inde Navarrete");
  });

  it("exige superar el listón de popularidad", () => {
    // Coincide el nombre pero nadie la conoce: no es el resultado que se buscó.
    const unknown = [{ name: "Nnn", popularity: 0.4 }];
    expect(pickTopNameMatch(unknown, "nnn")).toBeNull();
    expect(pickTopNameMatch([{ name: "Nnn", popularity: TOP_MATCH_POPULARITY }], "nnn")?.name).toBe("Nnn");
  });

  it("devuelve null si nadie coincide con el nombre", () => {
    expect(pickTopNameMatch(people, "matrix")).toBeNull();
    expect(pickTopNameMatch([], "inde")).toBeNull();
  });
});
