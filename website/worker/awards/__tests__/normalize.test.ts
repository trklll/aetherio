import { describe, expect, it } from "vitest";
import {
  extractSeasonEpisode,
  makeImportKey,
  normalizeName,
  normalizeTitle,
  titlesEqual,
  workKey,
} from "../normalize";

describe("normalizeTitle", () => {
  it("normaliza acentos y diacríticos", () => {
    expect(normalizeTitle("Óscar")).toBe("oscar");
    expect(normalizeTitle("El abrazo de la serpiente")).toBe("el abrazo de la serpiente");
    expect(normalizeTitle("La La Land")).toBe("la la land");
  });

  it("elimina apóstrofos y signos de puntuación", () => {
    expect(normalizeTitle("Don't Look Up")).toBe("dont look up");
    expect(normalizeTitle("C'era una volta...")).toBe("cera una volta");
  });

  it("convierte variantes japonesas de ancho completo (NFKC)", () => {
    expect(normalizeTitle("Ｓｐｙ×Ｆａｍｉｌｙ")).toBe("spy family");
    expect(normalizeTitle("スパイファミリー")).toBe("スパイファミリー");
  });

  it("apenda temporada/episodio como sufijo canónico", () => {
    expect(normalizeTitle("Game of Thrones S1E3")).toBe("game of thrones s1 e3");
    expect(normalizeTitle("Succession Season 2")).toBe("succession s2");
    expect(normalizeTitle("Breaking Bad temporada 5")).toBe("breaking bad s5");
    expect(normalizeTitle("El capítulo 4")).toBe("el e4");
    expect(extractSeasonEpisode("第 7 話")).toEqual({ season: null, episode: 7 });
  });

  it("devuelve vacío para entradas inválidas", () => {
    expect(normalizeTitle("")).toBe("");
    expect(normalizeTitle("!!!")).toBe("");
  });
});

describe("titlesEqual / workKey", () => {
  it("compara títulos por clave normalizada", () => {
    expect(titlesEqual("Óscar", "oscar")).toBe(true);
    expect(titlesEqual("Oppenheimer", "Oppenheimer")).toBe(true);
    expect(titlesEqual("Oppenheimer", "Oppernheimer")).toBe(false);
    expect(titlesEqual("", "x")).toBe(false);
  });

  it("workKey no distingue temporada", () => {
    expect(workKey("Succession Season 2")).toBe(workKey("Succession S2"));
  });

  it("workKey distingue remakes con el año", () => {
    expect(workKey("A Star Is Born", 1976)).not.toBe(workKey("A Star Is Born", 2018));
    expect(workKey("A Star Is Born", 1976)).toBe(workKey("a star is born", 1976));
  });
});

describe("normalizeName", () => {
  it("normaliza variantes de nombres propios", () => {
    expect(normalizeName("Óscar")).toBe("oscar");
    expect(normalizeName("Javier Bardem")).toBe("javier bardem");
  });
});

describe("makeImportKey", () => {
  it("es idempotente: mismo contenido produce la misma clave", () => {
    const base = {
      ceremony: "oscar",
      edition: 96,
      category: "Best Picture",
      status: "winner",
      workTitle: "Oppenheimer",
      recipients: [],
    };
    expect(makeImportKey(base)).toBe(makeImportKey(base));
    expect(makeImportKey({ ...base, category: "BEST PICTURE" })).toBe(makeImportKey(base));
    expect(makeImportKey({ ...base, workTitle: "  oppenheimer  " })).toBe(makeImportKey(base));
  });

  it("los destinatarios se ordenan y normalizan", () => {
    const base = {
      ceremony: "oscar",
      edition: 96,
      category: "Best Director",
      status: "winner",
      workTitle: "Oppenheimer",
    };
    const a = makeImportKey({ ...base, recipients: ["B C", "A D"] });
    const b = makeImportKey({ ...base, recipients: ["A D", "B C"] });
    expect(a).toBe(b);
  });

  it("distingue ceremonia, edición y estado", () => {
    const base = {
      category: "Best Picture",
      workTitle: "Anora",
      recipients: [],
    };
    const winner = makeImportKey({ ...base, ceremony: "oscar", edition: 97, status: "winner" });
    const nominee = makeImportKey({ ...base, ceremony: "oscar", edition: 97, status: "nominee" });
    const bafta = makeImportKey({ ...base, ceremony: "bafta", edition: 97, status: "winner" });
    expect(winner).not.toBe(nominee);
    expect(winner).not.toBe(bafta);
  });
});
