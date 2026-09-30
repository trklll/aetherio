import { describe, expect, it } from "vitest";
import {
  buildSeekrContent,
  buildSeekrLookupPath,
  clampSeekrOffsetMs,
  createSeekrTrack,
  findSeekrCueIndex,
  parseSeekrVtt,
  resolveSeekrTimelineMs,
  seekrTimelineMsForPosition,
  stepSeekrOffsetMs,
  type SeekrPreviewCue,
} from "./seekr";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:10.000
https://sprites.seekr.tv/sheet.png?token=a#xywh=0,0,320,180

00:00:10.000 --> 00:00:20.000
https://sprites.seekr.tv/sheet.png?token=b#xywh=320,0,320,180
`;

// Capturado de la API real (tmdb 4951) el 2026-09-25. La firma caduca, asi que va
// recortada, pero la estructura es la de verdad: firma en la query del VTT, tiles
// de 320x180 repartidos en varias hojas y una linea cada 10 s.
const REAL_VTT = `WEBVTT

00:00:00.000 --> 00:00:10.000
https://sprites.seekr.tv/4951/5856000/sheet_000.jpg?exp=1790387791&sig=REDACTED#xywh=0,0,320,180

00:00:10.000 --> 00:00:20.000
https://sprites.seekr.tv/4951/5856000/sheet_000.jpg?exp=1790387791&sig=REDACTED#xywh=320,0,320,180

00:00:20.000 --> 00:00:30.000
https://sprites.seekr.tv/4951/5856000/sheet_000.jpg?exp=1790387791&sig=REDACTED#xywh=640,0,320,180

01:37:20.000 --> 01:37:30.000
https://sprites.seekr.tv/4951/5856000/sheet_005.jpg?exp=1790387791&sig=REDACTED#xywh=1280,1440,320,180
`;

describe("Seekr", () => {
  it("parsea URLs firmadas y rectangulos xywh", () => {
    const cues = parseSeekrVtt(VTT);
    expect(cues).toHaveLength(2);
    expect(cues[1]).toEqual({
      startTimeMs: 10_000,
      endTimeMs: 20_000,
      sheetUrl: "https://sprites.seekr.tv/sheet.png?token=b",
      x: 320,
      y: 0,
      width: 320,
      height: 180,
    });
  });

  it("selecciona el ultimo cue cuyo inicio precede la posicion", () => {
    const cues = parseSeekrVtt(VTT);
    expect(findSeekrCueIndex(cues, -1)).toBe(0);
    expect(findSeekrCueIndex(cues, 10_000)).toBe(1);
    expect(findSeekrCueIndex(cues, 25_000)).toBe(1);
  });

  it("mapea peliculas y episodios con TMDB", () => {
    expect(buildSeekrContent({ type: "movie", id: "tmdb:603" })).toEqual({ kind: "movie", tmdbId: 603 });
    expect(buildSeekrContent({ type: "tv", id: "tmdb:1396", season: 1, episode: 2 })).toEqual({
      kind: "episode",
      showTmdbId: 1396,
      season: 1,
      episode: 2,
    });
  });

  it("construye el lookup con el orden del SDK", () => {
    const path = buildSeekrLookupPath({
      kind: "episode",
      showTmdbId: 1396,
      showImdbId: "tt0903747",
      season: 1,
      episode: 2,
    }, 8_160_000);
    expect(path).toBe("/sprites?duration_ms=8160000&show_tmdb_id=1396&show_imdb_id=tt0903747&season=1&episode=2");
  });

  it("acepta una lista de cues vacia sin fallar", () => {
    const empty: SeekrPreviewCue[] = [];
    expect(findSeekrCueIndex(empty, 1_000)).toBe(-1);
  });
});

describe("Preview Sync de Seekr", () => {
  it("limita el desplazamiento manual a +-240 s", () => {
    expect(clampSeekrOffsetMs(10_000)).toBe(10_000);
    expect(clampSeekrOffsetMs(999_999)).toBe(240_000);
    expect(clampSeekrOffsetMs(-999_999)).toBe(-240_000);
    expect(clampSeekrOffsetMs(Number.NaN)).toBe(0);
  });

  it("navega en pasos y no se pasa del limite", () => {
    expect(stepSeekrOffsetMs(0, 1)).toBe(10_000);
    expect(stepSeekrOffsetMs(0, -1)).toBe(-10_000);
    expect(stepSeekrOffsetMs(235_000, 1)).toBe(240_000);
    expect(stepSeekrOffsetMs(-235_000, -1)).toBe(-240_000);
    expect(stepSeekrOffsetMs(0, 1, 60_000)).toBe(60_000);
  });

  it("traduce la posicion local a la linea de tiempo de Seekr", () => {
    expect(resolveSeekrTimelineMs(10_000, 0, 1)).toBe(10_000);
    expect(resolveSeekrTimelineMs(10_000, 0, 2)).toBe(20_000);
    expect(resolveSeekrTimelineMs(10_000, -3_000, 1)).toBe(7_000);
  });

  it("nunca devuelve un tiempo negativo ni se sale del limite", () => {
    expect(resolveSeekrTimelineMs(1_000, -5_000, 1)).toBe(0);
    expect(resolveSeekrTimelineMs(10_000, 999_999, 1)).toBe(250_000);
  });

  it("usa escala 1 cuando la duracion de origen no es utilizable", () => {
    expect(resolveSeekrTimelineMs(10_000, 0, 0)).toBe(10_000);
    expect(resolveSeekrTimelineMs(10_000, 0, Number.NaN)).toBe(10_000);
    expect(resolveSeekrTimelineMs(10_000, 0, -2)).toBe(10_000);
  });

  it("encuentra el cue correcto despues de escalar y desplazar", () => {
    const cues = parseSeekrVtt(`WEBVTT

00:00:00.000 --> 00:00:10.000
https://sprites.seekr.tv/sheet.png?token=a#xywh=0,0,320,180

00:00:10.000 --> 00:00:20.000
https://sprites.seekr.tv/sheet.png?token=a#xywh=0,180,320,180

00:00:20.000 --> 00:00:30.000
https://sprites.seekr.tv/sheet.png?token=a#xywh=0,360,320,180

00:00:30.000 --> 00:00:40.000
https://sprites.seekr.tv/sheet.png?token=a#xywh=0,540,320,180
`);
    // El video local dura 20 s pero la referencia 40 s: sin escala el preview
    // llegaria tarde a la mitad del contenido.
    expect(cues[findSeekrCueIndex(cues, 15_000)].startTimeMs).toBe(10_000);
    expect(cues[findSeekrCueIndex(cues, resolveSeekrTimelineMs(15_000, 0, 2))].startTimeMs).toBe(30_000);
    expect(cues[findSeekrCueIndex(cues, resolveSeekrTimelineMs(15_000, -4_000, 2))].startTimeMs).toBe(20_000);
  });

  it("conserva la escala entregada por la API al crear la pista", () => {
    const track = createSeekrTrack(parseSeekrVtt(VTT), 1.5, 40_000);
    expect(track.scale).toBe(1.5);
    expect(track.sourceDurationMs).toBe(40_000);
    expect(createSeekrTrack(parseSeekrVtt(VTT), 0).scale).toBe(1);
  });
});

describe("posicion de la barra en milisegundos", () => {
  const stamp = (totalSeconds: number) => {
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}.000`;
  };
  // 585 cues como el VTT real: uno cada 10 s durante 1:37:36.
  const DENSE = parseSeekrVtt(Array.from({ length: 586 }, (_, index) => {
    const at = index * 10;
    return `${stamp(at)} --> ${stamp(at + 10)}\nhttps://sprites.seekr.tv/s.jpg#xywh=0,0,320,180\n`;
  }).join("\n"));

  it("la pista cubre el minuto 48 con un cue cada 10 s", () => {
    expect(DENSE).toHaveLength(586);
  });

  it("convierte los segundos de la barra a milisegundos de la pista", () => {
    // 48:48 cae en el cue de 2.920 s, no en el primero.
    expect(seekrTimelineMsForPosition(2_928, 0, 1)).toBe(2_928_000);
    expect(DENSE[findSeekrCueIndex(DENSE, seekrTimelineMsForPosition(2_928, 0, 1))].startTimeMs)
      .toBe(2_920_000);
  });

  it("sigue el offset manual en milisegundos", () => {
    expect(seekrTimelineMsForPosition(2_928, -10_000, 1)).toBe(2_918_000);
    expect(seekrTimelineMsForPosition(2_928, 10_000, 1)).toBe(2_938_000);
    expect(DENSE[findSeekrCueIndex(DENSE, seekrTimelineMsForPosition(2_928, -10_000, 1))].startTimeMs)
      .toBe(2_910_000);
  });

  it("aplica la escala despues de convertir a milisegundos", () => {
    expect(seekrTimelineMsForPosition(1_000, 0, 2)).toBe(2_000_000);
    expect(DENSE[findSeekrCueIndex(DENSE, seekrTimelineMsForPosition(1_000, 0, 2))].startTimeMs)
      .toBe(2_000_000);
  });

  it("trata el inicio del video sin inventar tiempos", () => {
    expect(seekrTimelineMsForPosition(0, 0, 1)).toBe(0);
    expect(seekrTimelineMsForPosition(-5, 0, 1)).toBe(0);
  });
});

describe("VTT real de api.seekr.tv", () => {
  it("parsea el formato real conservando la firma de la URL", () => {
    const cues = parseSeekrVtt(REAL_VTT);
    expect(cues).toHaveLength(4);
    expect(cues[0]).toEqual({
      startTimeMs: 0,
      endTimeMs: 10_000,
      sheetUrl: "https://sprites.seekr.tv/4951/5856000/sheet_000.jpg?exp=1790387791&sig=REDACTED",
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    });
  });

  it("salta entre hojas y traduce las horasminutes sin perderlas", () => {
    const cues = parseSeekrVtt(REAL_VTT);
    const last = cues[cues.length - 1];
    expect(last.startTimeMs).toBe(5_840_000);
    expect(last.sheetUrl).toContain("sheet_005.jpg");
    expect(last.sheetUrl).toContain("sig=REDACTED");
    expect(new Set(cues.map(cue => cue.sheetUrl)).size).toBe(2);
  });

  it("con scale 1 la correccion manual es la unica que desplaza el preview", () => {
    const cues = parseSeekrVtt(REAL_VTT);
    const positionMs = 15_000;
    expect(findSeekrCueIndex(cues, resolveSeekrTimelineMs(positionMs, 0, 1))).toBe(1);
    // Un offset negativo devuelve la imagen anterior: es lo que hace el boton -10s.
    expect(findSeekrCueIndex(cues, resolveSeekrTimelineMs(positionMs, -10_000, 1))).toBe(0);
    expect(findSeekrCueIndex(cues, resolveSeekrTimelineMs(positionMs, 10_000, 1))).toBe(2);
  });
});
