import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBetterPosterToUrl,
  betterPosterSignature,
  buildBetterPosterUrl,
  extractImdbId,
  getBetterPosterSettings,
  isBetterPosterUrl,
  saveBetterPosterSettings,
  type BetterPosterSettings,
} from "./betterPosters";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

const BASE: BetterPosterSettings = {
  enabled: true,
  showGenre: true,
  showRating: false,
  trendTags: true,
  qualityTags: false,
  ageRating: false,
  ratingSource: "avg",
  lang: "es-ES",
};

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("localStorage", createStorage());
  vi.stubGlobal("navigator", { language: "es-ES" });
});

describe("buildBetterPosterUrl", () => {
  it("construye la variante por defecto (poster-g, español)", () => {
    expect(buildBetterPosterUrl("tt1234567", BASE)).toBe(
      "https://btttr.cc/poster-g/imdb/poster-default/tt1234567.jpg?lang=es-ES",
    );
  });

  it("normaliza ids con prefijo (serie:episodio) al tt", () => {
    expect(buildBetterPosterUrl("tt1234567:1:2", BASE)).toBe(
      "https://btttr.cc/poster-g/imdb/poster-default/tt1234567.jpg?lang=es-ES",
    );
  });

  it("elige la base según género/rating", () => {
    expect(buildBetterPosterUrl("tt1", { ...BASE, showGenre: true, showRating: true }))
      .toContain("/poster/imdb/");
    expect(buildBetterPosterUrl("tt1", { ...BASE, showGenre: false, showRating: true }))
      .toContain("/poster-r/imdb/");
    expect(buildBetterPosterUrl("tt1", { ...BASE, showGenre: false, showRating: false }))
      .toContain("/poster-n/imdb/");
  });

  it("añade sufijos de calidad/edad", () => {
    expect(buildBetterPosterUrl("tt1", { ...BASE, qualityTags: true, ageRating: true }))
      .toContain("/poster-gqa/imdb/");
    expect(buildBetterPosterUrl("tt1", { ...BASE, showGenre: false, showRating: false, qualityTags: true }))
      .toContain("/poster-nq/imdb/");
  });

  it("desactiva trend tags con tag=none", () => {
    expect(buildBetterPosterUrl("tt1", { ...BASE, trendTags: false }))
      .toBe("https://btttr.cc/poster-g/imdb/poster-default/tt1.jpg?tag=none&lang=es-ES");
  });

  it("permite override de trend tags por fila (top)", () => {
    expect(buildBetterPosterUrl("tt1", BASE, { trendTags: false })).toContain("tag=none");
    expect(buildBetterPosterUrl("tt1", BASE, { trendTags: true })).not.toContain("tag=none");
  });

  it("omite lang en inglés y propaga la fuente de rating", () => {
    expect(buildBetterPosterUrl("tt1", { ...BASE, lang: "en" }))
      .toBe("https://btttr.cc/poster-g/imdb/poster-default/tt1.jpg");
    expect(buildBetterPosterUrl("tt1", { ...BASE, ratingSource: "IM" }))
      .toContain("rs=IM");
  });
});

describe("applyBetterPosterToUrl", () => {
  it("devuelve la original si está desactivado o no hay imdb", () => {
    expect(applyBetterPosterToUrl("http://x/p.jpg", "tt1", { ...BASE, enabled: false }))
      .toBe("http://x/p.jpg");
    expect(applyBetterPosterToUrl("http://x/p.jpg", null, BASE)).toBe("http://x/p.jpg");
    expect(applyBetterPosterToUrl(undefined, "tt1", BASE)).toContain("btttr.cc");
  });

  it("no reconstruye una URL btttr existente salvo override", () => {
    const baked = "https://btttr.cc/poster-g/imdb/poster-default/tt1.jpg?lang=es-ES";
    expect(applyBetterPosterToUrl(baked, "tt1", BASE)).toBe(baked);
    expect(applyBetterPosterToUrl(baked, "tt1", BASE, { trendTags: false }))
      .toContain("tag=none");
  });

  it("nunca lanza", () => {
    expect(() => applyBetterPosterToUrl(undefined, null, undefined)).not.toThrow();
  });
});

describe("extractImdbId / isBetterPosterUrl / signature", () => {
  it("extrae tt del id o de externalIds", () => {
    expect(extractImdbId("tt123")).toBe("tt123");
    expect(extractImdbId("tmdb:456", "tt789")).toBe("tt789");
    expect(extractImdbId("tmdb:456")).toBeNull();
    expect(extractImdbId("TT123:1:2")).toBe("TT123");
  });

  it("detecta URLs btttr", () => {
    expect(isBetterPosterUrl("https://btttr.cc/poster-g/imdb/poster-default/tt1.jpg")).toBe(true);
    expect(isBetterPosterUrl("https://image.tmdb.org/t/p/w500/x.jpg")).toBe(false);
    expect(isBetterPosterUrl(undefined)).toBe(false);
  });

  it("la firma cambia con cualquier ajuste", () => {
    const a = betterPosterSignature(BASE);
    expect(betterPosterSignature({ ...BASE, lang: "en" })).not.toBe(a);
    expect(betterPosterSignature({ ...BASE, enabled: false })).not.toBe(a);
  });
});

describe("persistencia de ajustes", () => {
  it("roundtrip save/get y normalización de valores raros", () => {
    saveBetterPosterSettings({ ...BASE, lang: "es-MX", ratingSource: "IM" });
    expect(getBetterPosterSettings()).toMatchObject({ lang: "es-MX", ratingSource: "IM" });
    saveBetterPosterSettings({ ...BASE, lang: "   ", ratingSource: "XX" as never });
    const next = getBetterPosterSettings();
    expect(next.lang).toBe("es-ES");
    expect(next.ratingSource).toBe("avg");
  });
});
