import { beforeEach, describe, expect, it } from "vitest";
import {
  applySpatialPosterToUrl,
  buildSpatialPosterUrl,
  DEFAULT_SPATIAL_POSTER_INSTANCE_URL,
  DEFAULT_SPATIAL_POSTER_SETTINGS,
  extractTmdbId,
  getSpatialPosterSettings,
  isSpatialPosterUrl,
  isSpatialPostersConfigured,
  normalizeInstanceUrl,
  spatialPosterSignature,
  spatialPosterType,
  type SpatialPosterSettings,
} from "./spatialPosters";
import { probeSpatialInstance, resetSpatialAvailability } from "../services/spatialInstance";

// Sin esto, getSpatialPosterSettings() leeria el localStorage de un test previo,
// y la disponibilidad de la instancia (cache a nivel de modulo) se filtraria
// de un describe al siguiente.
beforeEach(() => {
  try { localStorage.clear(); } catch { /* sin DOM */ }
  resetSpatialAvailability();
});

const BASE: SpatialPosterSettings = {
  ...DEFAULT_SPATIAL_POSTER_SETTINGS,
  instanceUrl: "http://localhost:3000",
};

function paramsOf(url: string | undefined): URLSearchParams {
  return new URL(url!).searchParams;
}

describe("plug and play", () => {
  it("viene con la instancia local por defecto: no hay nada que configurar", () => {
    expect(DEFAULT_SPATIAL_POSTER_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_SPATIAL_POSTER_SETTINGS.instanceUrl).toBe(DEFAULT_SPATIAL_POSTER_INSTANCE_URL);
    expect(DEFAULT_SPATIAL_POSTER_INSTANCE_URL).toBe("http://localhost:3000");
    // Y con los defaults tal cual ya produce una URL utilizable.
    expect(isSpatialPostersConfigured(DEFAULT_SPATIAL_POSTER_SETTINGS)).toBe(true);
    expect(buildSpatialPosterUrl(155, "movie", DEFAULT_SPATIAL_POSTER_SETTINGS))
      .toContain("http://localhost:3000/api/poster/movie/155?");
  });

  it("un ajuste guardado sin instanceUrl cae al default, no queda apagado", () => {
    // Ajustes viejos o de otro perfil no deben dejar la app sin posters.
    expect(getSpatialPosterSettings()).toEqual(DEFAULT_SPATIAL_POSTER_SETTINGS);
  });
});

describe("instancia caida", () => {
  it("no emite ninguna URL si ya sabemos que la instancia esta caida", async () => {
    // Cubre TODOS los llamadores: hook, Home, Catalog, Detail y el picker.
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    await expect(probeSpatialInstance(BASE.instanceUrl, down)).resolves.toBe(false);

    expect(buildSpatialPosterUrl(155, "movie", BASE)).toBeUndefined();
    expect(applySpatialPosterToUrl("https://img.tmdb.org/x.jpg", 155, "movie", BASE))
      .toBe("https://img.tmdb.org/x.jpg");
  });

  it("vuelve a emitir URLs cuando la instancia se levanta", async () => {
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
    const up = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await probeSpatialInstance(BASE.instanceUrl, down);
    expect(buildSpatialPosterUrl(155, "movie", BASE)).toBeUndefined();

    // La caída se cachea 20 s a propósito: no se wantalear el puerto. Pasado
    // ese TTL el siguiente sondeo reintenta y, si responde, se reactiva solo.
    resetSpatialAvailability();
    await probeSpatialInstance(BASE.instanceUrl, up);
    expect(buildSpatialPosterUrl(155, "movie", BASE)).toContain("/api/poster/movie/155?");
  });

  it("durante el TTL de caída no vuelve a tocar el puerto", async () => {
    let attempts = 0;
    const counted = (async () => {
      attempts += 1;
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await probeSpatialInstance(BASE.instanceUrl, counted);
    await probeSpatialInstance(BASE.instanceUrl, counted);
    await probeSpatialInstance(BASE.instanceUrl, counted);
    expect(attempts).toBe(1);
  });
});

describe("normalizeInstanceUrl", () => {
  it("añade esquema y quita el slash final", () => {
    expect(normalizeInstanceUrl("localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeInstanceUrl("  https://posters.local/base//  ")).toBe("https://posters.local/base");
  });

  it("rechaza esquemas no http(s) y basura", () => {
    expect(normalizeInstanceUrl("ftp://x")).toBe("");
    expect(normalizeInstanceUrl("file:///etc/passwd")).toBe("");
    expect(normalizeInstanceUrl("   ")).toBe("");
    expect(normalizeInstanceUrl(undefined)).toBe("");
  });

  it("acepta un host sin esquema (lo normal al escribirlo a mano)", () => {
    expect(normalizeInstanceUrl("posters.local:7789")).toBe("http://posters.local:7789");
  });
});

describe("isSpatialPostersConfigured", () => {
  it("exige enabled y una instancia válida", () => {
    expect(isSpatialPostersConfigured(BASE)).toBe(true);
    expect(isSpatialPostersConfigured({ ...BASE, enabled: false })).toBe(false);
    // Sin instancia el pipeline queda apagado → Aetherio usa TMDB.
    expect(isSpatialPostersConfigured({ ...BASE, instanceUrl: "" })).toBe(false);
    expect(isSpatialPostersConfigured({ ...BASE, instanceUrl: "ftp://x" })).toBe(false);
  });
});

describe("extractTmdbId", () => {
  it("acepta ids Stremio/TMDB", () => {
    expect(extractTmdbId("tmdb:12345")).toBe(12345);
    expect(extractTmdbId("12345")).toBe(12345);
    expect(extractTmdbId("tmdb:12345:1:2")).toBe(12345);
  });

  it("devuelve null para ids sin TMDB", () => {
    expect(extractTmdbId("tt1234567")).toBeNull();
    expect(extractTmdbId("kitsu:1")).toBeNull();
    expect(extractTmdbId(null)).toBeNull();
  });
});

describe("spatialPosterType", () => {
  it("mapea a los dos tipos de la ruta", () => {
    expect(spatialPosterType("movie")).toBe("movie");
    expect(spatialPosterType("series")).toBe("tv");
    expect(spatialPosterType("tv")).toBe("tv");
    expect(spatialPosterType(undefined)).toBe("tv");
  });
});

describe("buildSpatialPosterUrl", () => {
  it("usa la ruta por ID TMDB (no IMDb)", () => {
    expect(buildSpatialPosterUrl(12345, "movie", BASE)).toContain("http://localhost:3000/api/poster/movie/12345?");
    expect(buildSpatialPosterUrl(12345, "series", BASE)).toContain("/api/poster/tv/12345?");
  });

  it("emite lang y region siempre explícitos (el upstream cae en it/IT)", () => {
    const p = paramsOf(buildSpatialPosterUrl(1, "movie", BASE));
    expect(p.get("lang")).toBe("es");
    expect(p.get("region")).toBe("MX");
    expect(p.has("lang")).toBe(true);
    expect(p.has("region")).toBe(true);
  });

  it("traduce los toggles a los nombres de parámetro del upstream", () => {
    const p = paramsOf(buildSpatialPosterUrl(1, "movie", {
      ...BASE,
      globalBadges: false,
      rankingBadges: false,
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      networkLogo: false,
      blurEnabled: false,
    }));
    expect(p.get("badges")).toBe("0");
    expect(p.get("ranking")).toBe("0");
    expect(p.get("bg")).toBe("0");
    expect(p.get("by")).toBe("0");
    expect(p.get("br")).toBe("0");
    expect(p.get("netLogo")).toBe("0");
    expect(p.get("be")).toBe("0");
  });

  it("omite los parámetros cuando los toggles están activos", () => {
    const p = paramsOf(buildSpatialPosterUrl(1, "movie", BASE));
    for (const key of ["badges", "ranking", "bg", "by", "br", "netLogo", "be"]) {
      expect(p.get(key)).toBeNull();
    }
  });

  it("el override de ranking manda sobre los ajustes", () => {
    const withOverride = paramsOf(buildSpatialPosterUrl(1, "movie", BASE, { rankingBadges: false }));
    expect(withOverride.get("ranking")).toBe("0");
    const withOverrideOn = paramsOf(buildSpatialPosterUrl(1, "movie", { ...BASE, rankingBadges: false }, { rankingBadges: true }));
    expect(withOverrideOn.get("ranking")).toBeNull();
  });

  it("emite estilo, calidad, ribbon y blur", () => {
    const p = paramsOf(buildSpatialPosterUrl(1, "movie", {
      ...BASE,
      badgeStyle: "vetro",
      rankingBadgeStyle: "netflix",
      manualQuality: "4K",
      ribbonSide: "right",
      blurIntensity: 12,
      blurFade: 30,
      blurDarkness: 55,
      gradientHeight: 42,
    }));
    expect(p.get("bs")).toBe("vetro");
    expect(p.get("rs")).toBe("netflix");
    expect(p.get("mq")).toBe("4K");
    expect(p.get("side")).toBe("right");
    expect(p.get("blur")).toBe("12");
    expect(p.get("bf")).toBe("30");
    expect(p.get("bd")).toBe("55");
    expect(p.get("gradHeight")).toBe("42");
  });

  it("no emite mq si los sellos de calidad están apagados", () => {
    const p = paramsOf(buildSpatialPosterUrl(1, "movie", { ...BASE, qualityBadges: false, manualQuality: "4K" }));
    expect(p.get("mq")).toBeNull();
  });

  it("no emite scale/ox/oy cuando son los defaults", () => {
    const p = paramsOf(buildSpatialPosterUrl(1, "movie", BASE));
    expect(p.get("scale")).toBeNull();
    expect(p.get("ox")).toBeNull();
    expect(p.get("oy")).toBeNull();
  });

  it("devuelve undefined sin instancia o sin ID TMDB", () => {
    expect(buildSpatialPosterUrl(1, "movie", { ...BASE, instanceUrl: "" })).toBeUndefined();
    expect(buildSpatialPosterUrl(0, "movie", BASE)).toBeUndefined();
  });
});

describe("applySpatialPosterToUrl", () => {
  it("envuelve la URL base cuando está configurado", () => {
    expect(applySpatialPosterToUrl("https://img.tmdb.org/x.jpg", 42, "movie", BASE))
      .toContain("/api/poster/movie/42?");
  });

  it("devuelve la original si no hay configuración o ID", () => {
    const original = "https://img.tmdb.org/x.jpg";
    expect(applySpatialPosterToUrl(original, 42, "movie", { ...BASE, instanceUrl: "" })).toBe(original);
    expect(applySpatialPosterToUrl(original, null, "movie", BASE)).toBe(original);
  });

  it("no re-encapsula una URL que ya viene de SpatialPosters", () => {
    const already = buildSpatialPosterUrl(42, "movie", BASE)!;
    expect(applySpatialPosterToUrl(already, 42, "movie", BASE)).toBe(already);
  });
});

describe("isSpatialPosterUrl", () => {
  it("reconoce la ruta de póster de SpatialPosters", () => {
    expect(isSpatialPosterUrl("http://localhost:3000/api/poster/movie/42?lang=es")).toBe(true);
    expect(isSpatialPosterUrl("http://localhost:3000/api/poster/tv/42")).toBe(true);
  });

  it("no confunde otras URLs", () => {
    expect(isSpatialPosterUrl("https://btttr.cc/poster/imdb/x.jpg")).toBe(false);
    expect(isSpatialPosterUrl("https://img.tmdb.org/x.jpg")).toBe(false);
    expect(isSpatialPosterUrl("http://localhost:3000/api/poster/movie/abc")).toBe(false);
    expect(isSpatialPosterUrl(undefined)).toBe(false);
  });
});

describe("spatialPosterSignature", () => {
  it("cambia al cambiar ajustes relevantes", () => {
    const base = spatialPosterSignature(BASE);
    expect(spatialPosterSignature({ ...BASE, badgeStyle: "pill" })).not.toBe(base);
    expect(spatialPosterSignature({ ...BASE, region: "US" })).not.toBe(base);
    expect(spatialPosterSignature({ ...BASE, instanceUrl: "http://otro:3000" })).not.toBe(base);
  });

  it("reporta off cuando no hay instancia configurada", () => {
    expect(spatialPosterSignature({ ...BASE, instanceUrl: "" }).startsWith("off|")).toBe(true);
  });
});
