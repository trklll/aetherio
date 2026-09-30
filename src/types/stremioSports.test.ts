import { describe, expect, it } from "vitest";
import {
  cleanMetaName,
  humanizeSport,
  isLiveReleaseInfo,
  metaTitle,
  parseTextDate,
  splitVersus,
  stremioStreamToLiveSource,
} from "./stremioSports.ts";
import { isPlayableMediaStream } from "../utils/playableMedia.ts";
import { liveEventToMediaStreams, type LiveEvent } from "./liveSports.ts";

describe("cleanMetaName", () => {
  it("quita el prefijo de emoji y el marcador LIVE", () => {
    expect(cleanMetaName("🔴 LIVE: China U23 vs Thailand U23", "x")).toBe("China U23 vs Thailand U23");
  });

  it("deja los caracteres no latin1 intactos", () => {
    expect(cleanMetaName("Fórmula 1 - Baku", "x")).toBe("Fórmula 1 - Baku");
  });

  it("colapsa espacios y recorta", () => {
    expect(cleanMetaName("  LIVE:   Barcelona   vs   Real  ", "x")).toBe("Barcelona vs Real");
  });

  it("cae al fallback cuando no queda texto", () => {
    expect(cleanMetaName("🔴", "Evento")).toBe("Evento");
    expect(cleanMetaName(undefined, "Evento")).toBe("Evento");
  });
});

describe("humanizeSport", () => {
  it("normaliza el genero del addon", () => {
    expect(humanizeSport("MOTORSPORT")).toBe("Motorsport");
    expect(humanizeSport("american_football")).toBe("American football");
  });

  it("usa un valor por defecto cuando falta", () => {
    expect(humanizeSport(undefined)).toBe("Deportes");
    expect(humanizeSport("  ")).toBe("Deportes");
  });
});

describe("isLiveReleaseInfo", () => {
  it("detecta LIVE con variantes", () => {
    expect(isLiveReleaseInfo("LIVE")).toBe(true);
    expect(isLiveReleaseInfo("live now")).toBe(true);
  });

  it("no confunde una fecha con un directo", () => {
    expect(isLiveReleaseInfo("26 Sep 2026 · 04:30 UTC")).toBe(false);
    expect(isLiveReleaseInfo(undefined)).toBe(false);
  });
});

describe("parseTextDate", () => {
  it("parsea el formato de Sports Streams con hora", () => {
    expect(parseTextDate("26 Sep 2026 · 04:30 UTC")).toBe("2026-09-26T04:30:00.000Z");
  });

  it("parsea la variante de dos digitos de dia", () => {
    expect(parseTextDate("5 Oct 2026 · 19:05 UTC")).toBe("2026-10-05T19:05:00.000Z");
  });

  it("devuelve null para lo que no es fecha", () => {
    expect(parseTextDate("LIVE")).toBeNull();
    expect(parseTextDate("26 Foo 2026")).toBeNull();
    expect(parseTextDate(undefined)).toBeNull();
  });
});

describe("splitVersus", () => {
  it("separa los dos equipos", () => {
    expect(splitVersus("Seattle Mariners vs Los Angeles Angels")).toEqual([
      "Seattle Mariners",
      "Los Angeles Angels",
    ]);
  });

  it("acepta v. y vs.", () => {
    expect(splitVersus("Lakers v. Celtics")).toEqual(["Lakers", "Celtics"]);
  });

  it("devuelve null si no hay rival", () => {
    expect(splitVersus("Canal ESPN")).toBeNull();
  });
});

describe("metaTitle", () => {
  it("usa cast como local/visitante cuando el titulo es un enfrentamiento", () => {
    expect(metaTitle({ id: "x", name: "🔴 LIVE: China U23 vs Thailand U23", cast: ["China U23", "Thailand U23"] }))
      .toBe("China U23 vs Thailand U23");
  });

  it("cae al nombre limpio si no hay cast", () => {
    expect(metaTitle({ id: "x", name: "🔴 LIVE: Barça vs Real" })).toBe("Barça vs Real");
  });

  /**
   * El addon mete la descripcion del evento en `cast` cuando el deporte no tiene
   * rival. Sin este filtro salia "Formula 1 Grand Prix Baku vs Race | Baku,
   * Azerbaijan | 26 September 2026".
   */
  it("ignora cast cuando el titulo no describe un enfrentamiento", () => {
    expect(metaTitle({
      id: "x",
      name: "🔴 Formula 1 Grand Prix Baku",
      cast: ["Formula 1 Grand Prix Baku", "Race | Baku, Azerbaijan | 26 September 2026"],
    })).toBe("Formula 1 Grand Prix Baku");
  });

  it("descarta un cast de un solo elemento", () => {
    expect(metaTitle({ id: "x", name: "A vs B", cast: ["A"] })).toBe("A vs B");
  });
});

describe("stremioStreamToLiveSource", () => {
  it("copia proxyHeaders.request a headers", () => {
    const source = stremioStreamToLiveSource({
      name: "Direct Stream",
      url: "https://proxy.example/api/manifest?url=x",
      behaviorHints: {
        proxyHeaders: {
          request: { Referer: "https://a.example", Origin: "https://a.example", "User-Agent": "UA/1" },
        },
      },
    }, "evt-1", 0);
    expect(source?.headers).toEqual({
      Referer: "https://a.example",
      Origin: "https://a.example",
      "User-Agent": "UA/1",
    });
  });

  it("descarta el centinela de canal offline", () => {
    expect(stremioStreamToLiveSource({ name: "Unavailable", url: "https://www.google.com" }, "evt-1", 0)).toBeNull();
  });

  it("descarta un stream sin url", () => {
    expect(stremioStreamToLiveSource({ name: "Solo YouTube", ytId: "abc" }, "evt-1", 0)).toBeNull();
  });

  it("no inventa headers si no vienen", () => {
    const source = stremioStreamToLiveSource({ name: "A", url: "https://x/a.m3u8" }, "evt-1", 0);
    expect(source?.headers).toBeUndefined();
  });

  it("marca la primera fuente como la por defecto", () => {
    const first = stremioStreamToLiveSource({ name: "A", url: "https://x/a.m3u8" }, "evt-1", 0);
    const second = stremioStreamToLiveSource({ name: "B", url: "https://x/b.m3u8" }, "evt-1", 1);
    expect(first?.isDefault).toBe(true);
    expect(second?.isDefault).toBe(false);
  });

  it("ignora valores de header que no son texto", () => {
    const source = stremioStreamToLiveSource({
      name: "A",
      url: "https://x/a.m3u8",
      behaviorHints: { proxyHeaders: { request: { Referer: 42, Origin: "https://ok.example" } } },
    }, "evt-1", 0);
    expect(source?.headers).toEqual({ Origin: "https://ok.example" });
  });
});

describe("integracion con el reproductor", () => {
  const event: LiveEvent = {
    id: "nuvio:evt-1",
    title: "China U23 vs Thailand U23",
    sport: "Fútbol",
    league: "Fútbol",
    status: "live",
    startsAt: "2026-09-26T06:00:00.000Z",
    sources: [{
      id: "evt-1:0",
      label: "Direct Stream",
      // URL de proxy: no termina en .m3u8, igual que en el addon real.
      url: "https://proxy.example/api/manifest?url=https%3A%2F%2Fcdn%2Fa.m3u8&referer=x",
      headers: { Referer: "https://a.example", Origin: "https://a.example" },
    }],
  };

  /**
   * Este es el test que importa: los addons marcan sus streams como
   * `notWebReady`, y si esa bandera llegara al MediaStream, `playableMedia.ts`
   * lo rechazaria y el reproductor no mostraria ninguna fuente. El conversor
   * construye behaviorHints en lista blanca justamente para que no llegue.
   */
  it("el stream del addon sigue siendo jugable pese a notWebReady", () => {
    const [stream] = liveEventToMediaStreams(event);
    expect(stream.behaviorHints?.notWebReady).toBeUndefined();
    expect(isPlayableMediaStream(stream)).toBe(true);
  });

  it("una URL de proxy sin extension sigue contando como reproducible", () => {
    const [stream] = liveEventToMediaStreams(event);
    expect(isPlayableMediaStream(stream)).toBe(true);
  });

  it("los headers llegan al behaviorHints para que mpv los aplique", () => {
    const [stream] = liveEventToMediaStreams(event);
    const headers = stream.behaviorHints?.headers as Record<string, string>;
    expect(headers.Referer).toBe("https://a.example");
    expect(headers.Origin).toBe("https://a.example");
  });
});
