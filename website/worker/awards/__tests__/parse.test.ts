import { describe, expect, it } from "vitest";
import {
  classifySubject,
  detectStatus,
  extractYear,
  cleanWorkTitle,
  stripStatusMarkers,
  translateCategory,
} from "../parse";

describe("detectStatus", () => {
  it("detecta ganadoras en español", () => {
    expect(detectStatus("Ganadora: Anora")).toBe("winner");
    expect(detectStatus("Ganador — Sean Baker")).toBe("winner");
    expect(detectStatus("Película ganada")).toBe("winner");
  });

  it("detecta ganadoras en inglés", () => {
    expect(detectStatus("Winner: Anora")).toBe("winner");
    expect(detectStatus("The Brutalist won")).toBe("winner");
    expect(detectStatus("wins the Palme d'Or")).toBe("winner");
  });

  it("detecta ganadoras en japonés", () => {
    expect(detectStatus("受賞: バーフライ")).toBe("winner");
    expect(detectStatus("最優秀作品賞")).toBe("winner");
  });

  it("detecta nominadas", () => {
    expect(detectStatus("Nominada: Conclave")).toBe("nominee");
    expect(detectStatus("nominated for Best Picture")).toBe("nominee");
    expect(detectStatus("優秀作品賞")).toBe("nominee");
  });

  it("devuelve null sin marcador", () => {
    expect(detectStatus("Anora")).toBe(null);
  });
});

describe("stripStatusMarkers", () => {
  it("elimina marcadores conservando el título", () => {
    expect(stripStatusMarkers("Ganadora: Anora")).toBe("Anora");
    expect(stripStatusMarkers("★ Anora")).toBe("Anora");
    expect(stripStatusMarkers("Winner — The Brutalist")).toBe("The Brutalist");
  });
});

describe("extractYear", () => {
  it("extrae años válidos", () => {
    expect(extractYear("Oppenheimer (2023)")).toBe(2023);
    expect(extractYear("El día de la bestia - 1995")).toBe(1995);
  });

  it("ignora años fuera de rango y ausentes", () => {
    expect(extractYear("Anora")).toBeUndefined();
    expect(extractYear("El año 1500")).toBeUndefined();
    expect(extractYear("1917")).toBeUndefined();
    expect(extractYear("2001: A Space Odyssey")).toBeUndefined();
  });
});

describe("cleanWorkTitle", () => {
  it("quita cadenas editoriales de series y temporadas sin tocar el tÃ­tulo", () => {
    expect(cleanWorkTitle("Succession (HBO)")).toBe("Succession");
    expect(cleanWorkTitle(`Breaking Bad (AMC)\u2021`)).toBe("Breaking Bad");
    expect(cleanWorkTitle("Jujutsu Kaisen (season 2)")).toBe("Jujutsu Kaisen");
    expect(cleanWorkTitle("Jujutsu Kaisen (cour 1)")).toBe("Jujutsu Kaisen");
  });
});

describe("classifySubject", () => {
  it("clasifica personas", () => {
    expect(classifySubject("Best Actor in a Leading Role")).toBe("person");
    expect(classifySubject("Mejor dirección")).toBe("person");
    expect(classifySubject("Best Original Screenplay")).toBe("person");
  });

  it("clasifica episodios", () => {
    expect(classifySubject("Outstanding Episode")).toBe("episode");
    expect(classifySubject("Mejor episodio")).toBe("episode");
  });

  it("clasifica canciones", () => {
    expect(classifySubject("Best Original Song")).toBe("song");
    expect(classifySubject("Mejor canción original")).toBe("song");
    expect(classifySubject("Best Opening Sequence")).toBe("song");
  });

  it("clasifica categorías técnicas", () => {
    expect(classifySubject("Best Cinematography")).toBe("technical");
    expect(classifySubject("Best Visual Effects")).toBe("technical");
    expect(classifySubject("Mejor fotografía")).toBe("technical");
    expect(classifySubject("Mejor banda sonora")).toBe("technical");
  });

  it("por defecto clasifica la obra", () => {
    expect(classifySubject("Best Picture")).toBe("work");
    expect(classifySubject("Mejor película")).toBe("work");
    expect(classifySubject("")).toBe("work");
  });
});

describe("translateCategory", () => {
  it("traduce categorías conocidas", () => {
    expect(translateCategory("Best Picture", { "Best Picture": "Mejor Película" })).toBe("Mejor Película");
  });

  it("respeta mayúsculas/minúsculas", () => {
    expect(translateCategory("best picture", { "Best Picture": "Mejor Película" })).toBe("Mejor Película");
  });

  it("conserva el original si no está en el diccionario", () => {
    expect(translateCategory("Best Stunt", { "Best Picture": "Mejor Película" })).toBe("Best Stunt");
  });
});
