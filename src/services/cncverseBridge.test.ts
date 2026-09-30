import { describe, expect, it } from "vitest";
import {
  CNCVERSE_FALLBACK_LABEL,
  cncVerseEventKey,
  cncVerseMetaToEvent,
  cncVerseProviderLabel,
  decodeCncVerseEventId,
  isCncVerseProviderLabel,
  normalizeCncVerseBridgeUrl,
  normalizeCncVerseProviderLabel,
  parseCncVerseDate,
  parseCncVerseProviderLabel,
} from "./cncverseBridge.ts";
import type { StremioMeta } from "../types/stremioSports.ts";

/** Metadato tal como lo sirve el bridge: el evento entero viaja en el id. */
function metaFromPayload(payload: Record<string, unknown>, visibleName = "👀 algo"): StremioMeta {
  return { id: `cnc:${btoa(`Catalogo::${JSON.stringify(payload)}`)}`, type: "tv", name: visibleName };
}

function meta(eventInfo: Record<string, unknown>, eventId = 50008): StremioMeta {
  return metaFromPayload({ eventId, title: "IND vs WI", eventInfo, formats: [{ title: "1080p - FHD" }] });
}

describe("normalizeCncVerseBridgeUrl", () => {
  it("quita manifest.json y la barra final", () => {
    expect(normalizeCncVerseBridgeUrl("https://bridge.example/u/abc/manifest.json"))
      .toBe("https://bridge.example/u/abc");
    expect(normalizeCncVerseBridgeUrl("https://bridge.example/u/abc/"))
      .toBe("https://bridge.example/u/abc");
  });

  it("solo acepta https", () => {
    expect(normalizeCncVerseBridgeUrl("http://bridge.example")).toBe("");
    expect(normalizeCncVerseBridgeUrl("no-es-una-url")).toBe("");
    expect(normalizeCncVerseBridgeUrl("")).toBe("");
    expect(normalizeCncVerseBridgeUrl(null)).toBe("");
  });
});

describe("parseCncVerseProviderLabel", () => {
  it("saca el proveedor de la segunda linea de name", () => {
    expect(parseCncVerseProviderLabel("Dune: Part Two\nVegaMovies - 480p")).toBe("VegaMovies");
    expect(parseCncVerseProviderLabel("Shawshank\nPikashowProvider - 1080p")).toBe("Pikashow");
    expect(parseCncVerseProviderLabel("Shawshank\nMovieLinkBDProvider - 720p")).toBe("MovieLinkBD");
    expect(parseCncVerseProviderLabel("Shawshank\nBanglaplex")).toBe("Banglaplex");
  });

  it("devuelve null cuando la segunda linea no es un proveedor", () => {
    // El bridge a veces escribe solo la calidad en lugar del proveedor.
    expect(parseCncVerseProviderLabel("Shawshank\n360p (Hindi) - The Shawshank Redemption")).toBeNull();
    expect(parseCncVerseProviderLabel("Shawshank\n1920p")).toBeNull();
    expect(parseCncVerseProviderLabel("Shawshank\n4.2 GB")).toBeNull();
    expect(parseCncVerseProviderLabel("Shawshank")).toBeNull();
    expect(parseCncVerseProviderLabel(undefined)).toBeNull();
  });
});

describe("normalizeCncVerseProviderLabel", () => {
  it("manda las duplicadas al nombre que Aetherio ya usa", () => {
    // Medido: el add-on propio de Aetherio gana en streams, velocidad y liveness,
    // asi que estas se suman a su chip en vez de abrir uno redundante.
    expect(normalizeCncVerseProviderLabel("HDhub4u")).toBe("HdHub");
    expect(normalizeCncVerseProviderLabel("FourKHDHub")).toBe("4KHDHub");
    expect(normalizeCncVerseProviderLabel("Animeav1")).toBe("AnimeAV1");
    expect(normalizeCncVerseProviderLabel("Moviesmod")).toBe("MoviesMod");
    expect(normalizeCncVerseProviderLabel("StreamFlix")).toBe("StreamFlix");
    expect(normalizeCncVerseProviderLabel("AllMovieLandProvider")).toBe("AllMovieLand");
    expect(normalizeCncVerseProviderLabel("MovieBoxProviderIN")).toBe("MovieBox");
    expect(normalizeCncVerseProviderLabel("CastleTvProvider")).toBe("Castle");
    expect(normalizeCncVerseProviderLabel("YTS")).toBe("YTS");
    expect(normalizeCncVerseProviderLabel("CuevanaProvider")).toBe("Cuevana UBD");
  });

  it("deja su nombre a las que Aetherio no trae", () => {
    expect(normalizeCncVerseProviderLabel("PikashowProvider")).toBe("Pikashow");
    expect(normalizeCncVerseProviderLabel("Pencurimovie")).toBe("Pencurimovie");
    expect(normalizeCncVerseProviderLabel("Pelisplus4KProvider")).toBe("Pelisplus4K");
  });

  it("agrupa el extractor generico del bridge", () => {
    expect(normalizeCncVerseProviderLabel("CNC Verse Mobile")).toBe(CNCVERSE_FALLBACK_LABEL);
    expect(normalizeCncVerseProviderLabel("CNC Verse")).toBe(CNCVERSE_FALLBACK_LABEL);
  });

  it("usa la etiqueta neutra cuando no hay linea de proveedor", () => {
    expect(cncVerseProviderLabel("Shawshank\n360p (Hindi)")).toBe(CNCVERSE_FALLBACK_LABEL);
  });

  it("reconoce sus propios nombres para el logo del puente", () => {
    expect(isCncVerseProviderLabel("VegaMovies")).toBe(true);
    expect(isCncVerseProviderLabel("HdHub")).toBe(true);
    expect(isCncVerseProviderLabel("Torrentio")).toBe(false);
  });
});

describe("decodeCncVerseEventId", () => {
  it("lee el evento del id base64", () => {
    const payload = decodeCncVerseEventId(meta({ eventName: "India vs West Indies" }).id);
    expect(payload?.eventId).toBe(50008);
    expect(payload?.eventInfo?.eventName).toBe("India vs West Indies");
  });

  it("quita el nombre del catalogo que precede al JSON", () => {
    // Formato real: `cnc:<base64 de "SportzXLiveEvents::{...}">`. Si se parsea
    // el base64 tal cual revienta y el evento se pierde entero.
    const body = { eventId: 1, title: "x", eventInfo: { eventName: "A vs B" } };
    const encoded = btoa(`PlayFyLiveEvents::${JSON.stringify(body)}`);
    const payload = decodeCncVerseEventId(`cnc:${encoded}`);
    expect(payload?.eventId).toBe(1);
    expect(payload?.eventInfo?.eventName).toBe("A vs B");
  });

  it("devuelve null ante un id que no es suyo", () => {
    expect(decodeCncVerseEventId("tt15239678")).toBeNull();
    expect(decodeCncVerseEventId("cnc:no-es-base64!!")).toBeNull();
    expect(decodeCncVerseEventId("cnc:")).toBeNull();
    expect(decodeCncVerseEventId("")).toBeNull();
    expect(decodeCncVerseEventId(null)).toBeNull();
  });

  it("devuelve null si tras el prefijo no hay JSON", () => {
    // Base64 valido que decodifica a algo sin llaves: no es un evento.
    expect(decodeCncVerseEventId(`cnc:${btoa("SportzXLiveEvents::nada")}`)).toBeNull();
  });
});

describe("parseCncVerseDate", () => {
  it("convierte el formato con barras, que Date.parse rechaza", () => {
    expect(parseCncVerseDate("2026/09/30 08:30:00 +0000")).toBe("2026-09-30T08:30:00.000Z");
  });

  it("devuelve null si no hay fecha usable", () => {
    expect(parseCncVerseDate("")).toBeNull();
    expect(parseCncVerseDate("manana")).toBeNull();
    expect(parseCncVerseDate(null)).toBeNull();
  });
});

describe("cncVerseMetaToEvent", () => {
  const eventInfo = {
    teamA: "IND",
    teamB: "WI",
    eventCat: "Cricket",
    eventName: "One Day International",
    isHot: "0",
    startTime: "2026/09/30 08:30:00 +0000",
    endTime: "2026/09/30 16:30:00 +0000",
  };

  it("usa el partido de title, no la competicion de eventInfo", () => {
    // Los tres esquemas ponen el partido en `title`; `eventInfo.eventName` es
    // la COMPETICION. Confundirlos llenaba la pagina de "One Day International".
    const event = cncVerseMetaToEvent(metaFromPayload({
      eventId: 16,
      title: "India vs West Indies",
      eventInfo,
    }, "🏏 India vs West Indies"));
    expect(event?.title).toBe("India vs West Indies");
    expect(event?.league).toBe("One Day International");
    expect(event?.sport).toBe("Cricket");
    expect(event?.home?.name).toBe("India");
    expect(event?.away?.name).toBe("West Indies");
    expect(event?.startsAt).toBe("2026-09-30T08:30:00.000Z");
  });

  it("cae al name visible cuando no hay title en el payload", () => {
    const event = cncVerseMetaToEvent(metaFromPayload({ eventId: 7, eventInfo }, "🏏 IND vs WI"));
    expect(event?.title).toBe("IND vs WI");
  });

  it("lee el esquema de PlayFy: channelId, category en la raiz, sin eventCat", () => {
    const event = cncVerseMetaToEvent(metaFromPayload({
      channelId: "19011",
      title: "Bangladesh vs Malaysia",
      category: "Cricket",
      eventInfo: {
        eventName: "Asian Games",
        teamA: "Bangladesh",
        teamB: "Malaysia",
        startTime: "2026/09/29 04:30:00 +0000",
        endTime: "2026/09/29 08:30:00 +0000",
      },
    }, "🏏 Bangladesh vs Malaysia"));
    expect(event?.title).toBe("Bangladesh vs Malaysia");
    expect(event?.sport).toBe("Cricket");
    expect(event?.league).toBe("Asian Games");
    expect(event?.startsAt).toBe("2026-09-29T04:30:00.000Z");
  });

  it("lee el esquema de StreamedSports: date en epoch y teams.home/away", () => {
    // Sin `eventInfo`: si no se leyera `date` y `teams`, sus 95 eventos
    // saldrian todos como "Deportes" y todos en directo.
    const event = cncVerseMetaToEvent(metaFromPayload({
      id: "belgium-vs-france-2442768",
      title: "Belgium vs France",
      category: "football",
      date: 1790621100000,
      popular: true,
      teams: { home: { name: "Belgium" }, away: { name: "France" } },
    }, "Belgium vs France"));
    expect(event?.title).toBe("Belgium vs France");
    expect(event?.sport).toBe("Football");
    expect(event?.home?.name).toBe("Belgium");
    expect(event?.away?.name).toBe("France");
    expect(event?.startsAt).toBe(new Date(1790621100000).toISOString());
    expect(event?.isFeatured).toBe(true);
    // Sin hora de fin no se puede marcar como acabado: cae por reloj.
    expect(["live", "upcoming"]).toContain(event?.status);
  });

  it("usa el reloj para lo que ya termino, no la etiqueta", () => {
    const despues = Date.parse("2026-09-30T18:00:00.000Z");
    expect(cncVerseMetaToEvent(meta({ ...eventInfo }), despues)?.status).toBe("ended");
    const durante = Date.parse("2026-09-30T12:00:00.000Z");
    expect(cncVerseMetaToEvent(meta({ ...eventInfo }), durante)?.status).toBe("live");
    const antes = Date.parse("2026-09-30T06:00:00.000Z");
    expect(cncVerseMetaToEvent(meta({ ...eventInfo }), antes)?.status).toBe("upcoming");
  });

  it("isHot manda sobre el reloj", () => {
    const antes = Date.parse("2026-09-30T06:00:00.000Z");
    const event = cncVerseMetaToEvent(meta({ ...eventInfo, isHot: "1" }), antes);
    expect(event?.status).toBe("live");
    expect(event?.period).toBe("En directo");
  });

  it("descarta un meta sin id", () => {
    expect(cncVerseMetaToEvent({ id: "", name: "Sin id" })).toBeNull();
  });

  it("el id lleva el prefijo propio para no chocar con otros providers", () => {
    expect(cncVerseMetaToEvent(meta(eventInfo))?.id).toMatch(/^cncverse:cnc:/);
  });
});

describe("cncVerseEventKey", () => {
  const base = { teamA: "IND", teamB: "WI", eventCat: "Cricket", eventName: "One Day International" };

  it("funde el mismo partido de catalogos distintos", () => {
    const a = metaFromPayload({ eventId: 16, title: "India vs West Indies", eventInfo: { ...base, startTime: "2026/09/30 08:30:00 +0000" } });
    const b = metaFromPayload({ eventId: 16, title: "India vs West Indies", eventInfo: { ...base, startTime: "2026/09/30 08:30:00 +0000" } });
    const c = metaFromPayload({ eventId: 16, title: "India vs West Indies", eventInfo: { ...base, startTime: "2026/09/30 08:30:00 +0000" } });
    const key = cncVerseEventKey(a);
    expect(cncVerseEventKey(b)).toBe(key);
    expect(cncVerseEventKey(c)).toBe(key);
  });

  it("funde tambien entre esquemas distintos si comparten identificador", () => {
    // PlayFy usa channelId donde los demas usan eventId: si un catalogo llegara
    // a reutilizar un numero, sin esta comprobacion saldrian dos filas.
    const conEventId = metaFromPayload({ eventId: 19011, title: "Bangladesh vs Malaysia" });
    const conChannelId = metaFromPayload({ channelId: 19011, title: "Bangladesh vs Malaysia" });
    expect(cncVerseEventKey(conChannelId)).toBe(cncVerseEventKey(conEventId));
  });

  it("separa partidos distintos y reincidencias", () => {
    const a = metaFromPayload({ eventId: 16, title: "A", eventInfo: { startTime: "2026/09/30 08:30:00 +0000" } });
    const otro = metaFromPayload({ eventId: 17, title: "A", eventInfo: { startTime: "2026/09/30 08:30:00 +0000" } });
    const revancha = metaFromPayload({ eventId: 16, title: "A", eventInfo: { startTime: "2026/10/02 08:30:00 +0000" } });
    expect(cncVerseEventKey(a)).not.toBe(cncVerseEventKey(otro));
    expect(cncVerseEventKey(a)).not.toBe(cncVerseEventKey(revancha));
  });

  it("usa el epoch como inicio en los catalogos que no traen startTime", () => {
    const a = metaFromPayload({ id: "belgium-vs-france-1", date: 1790621100000 });
    const b = metaFromPayload({ id: "belgium-vs-france-1", date: 1790621100000 });
    const c = metaFromPayload({ id: "belgium-vs-france-1", date: 1790700000000 });
    expect(cncVerseEventKey(b)).toBe(cncVerseEventKey(a));
    expect(cncVerseEventKey(c)).not.toBe(cncVerseEventKey(a));
  });

  it("sin identificador legible cae al id del meta, que es unico", () => {
    const strange: StremioMeta = { id: "cnc:no-es-base64!!" };
    expect(cncVerseEventKey(strange)).toBe("id:cnc:no-es-base64!!");
  });
});
