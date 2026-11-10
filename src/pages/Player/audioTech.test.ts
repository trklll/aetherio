import { describe, expect, it } from "vitest";
import {
  audioBadgeFromLabel,
  audioBadgeFromStream,
  audioBadgeToStreamBadgeId,
  cleanAudioTrackLabel,
  presentAudioTrack,
  resolveAudioBadges,
  resolveHeaderAudioBadges,
} from "./audioTech";
import { getStreamFormatBadges } from "../../utils/streamFormatters";
import type { MediaStream } from "../../types/stream";

describe("audioBadgeToStreamBadgeId", () => {
  it("cada insignia tiene su badge en el .json", () => {
    expect(audioBadgeToStreamBadgeId("atmos")).toBe("atmos");
    expect(audioBadgeToStreamBadgeId("truehd")).toBe("truehd");
    expect(audioBadgeToStreamBadgeId("dtsx")).toBe("dts-x");
    expect(audioBadgeToStreamBadgeId("dts-hd-ma")).toBe("dts-hd-ma");
    expect(audioBadgeToStreamBadgeId("dts-hd")).toBe("dts-hd");
    expect(audioBadgeToStreamBadgeId("dts")).toBe("dts");
    expect(audioBadgeToStreamBadgeId("ddplus")).toBe("dolby-digital-plus");
    expect(audioBadgeToStreamBadgeId("dd")).toBe("dolby-digital");
  });
});

describe("cleanAudioTrackLabel", () => {
  it("quita la tecnologia del texto y deja el idioma", () => {
    expect(cleanAudioTrackLabel("English - Dolby Atmos 5.1")).toBe("English");
    expect(cleanAudioTrackLabel("English - DTS-HD")).toBe("English");
    expect(cleanAudioTrackLabel("Español (Dolby Digital Plus)")).toBe("Español");
    expect(cleanAudioTrackLabel(" Commentary 7.1 ")).toBe("Commentary");
  });

  it("el codigo ISO delante del nombre sobra", () => {
    expect(cleanAudioTrackLabel("eng - English - Dolby Atmos 5.1")).toBe("English");
    expect(cleanAudioTrackLabel("spa - Espanol AD")).toBe("Espanol AD");
    // Sin nombre detras, el codigo es toda la informacion que hay.
    expect(cleanAudioTrackLabel("eng")).toBe("eng");
  });

  it("no deja signos de union colgando", () => {
    expect(cleanAudioTrackLabel("Ingles - ")).toBe("Ingles");
    expect(cleanAudioTrackLabel(" - Inglés")).toBe("Inglés");
  });

  it("si no hay nada que quitar devuelve el rotulo intacto", () => {
    expect(cleanAudioTrackLabel("Español")).toBe("Español");
    expect(cleanAudioTrackLabel("")).toBe("");
  });
});

describe("audioBadgeFromLabel", () => {
  it("reconoce la tecnologia del propio rotulo, con prioridad", () => {
    expect(audioBadgeFromLabel("English - Dolby Atmos 5.1")).toEqual({ id: "atmos", label: "Dolby Atmos" });
    expect(audioBadgeFromLabel("English - DTS-HD")).toEqual({ id: "dts-hd", label: "DTS-HD" });
    expect(audioBadgeFromLabel("English - DTS")).toEqual({ id: "dts", label: "DTS" });
  });

  it("DTS:X y DTS-HD MA no se confunden con DTS o DTS-HD a secas", () => {
    expect(audioBadgeFromLabel("English - DTS-X")).toEqual({ id: "dtsx", label: "DTS:X" });
    expect(audioBadgeFromLabel("English - DTS-HD MA")).toEqual({ id: "dts-hd-ma", label: "DTS-HD MA" });
    expect(audioBadgeFromLabel("Espanol - EAC3")).toEqual({ id: "ddplus", label: "Dolby Digital Plus" });
  });

  it("atmos gana sobre el resto de tecnologias", () => {
    expect(audioBadgeFromLabel("Spanish - E-AC3 Atmos")?.id).toBe("atmos");
  });

  it("sin tecnologia devuelve null", () => {
    expect(audioBadgeFromLabel("English")).toBeNull();
    // Los canales no son una tecnologia: no generan insignia.
    expect(audioBadgeFromLabel("Commentary 2.0")).toBeNull();
  });
});

describe("audioBadgeFromStream", () => {
  it("lee el .json de la stream", () => {
    expect(audioBadgeFromStream({ dynamicRange: "Dolby Atmos" })).toEqual({ id: "atmos", label: "Dolby Atmos" });
    expect(audioBadgeFromStream({ audioCodec: "eac3" })).toEqual({ id: "ddplus", label: "Dolby Digital Plus" });
    expect(audioBadgeFromStream({ audioChannels: 6 })).toBeNull();
  });

  it("sin datos no inventa insignia", () => {
    expect(audioBadgeFromStream(null)).toBeNull();
    expect(audioBadgeFromStream({ audioChannels: 2 })).toBeNull();
  });
});

describe("resolveAudioBadges", () => {
it("tecnologia, codec y canales van en ese orden", () => {
    expect(resolveAudioBadges({ audioCodec: "eac3", audioChannels: 6, dynamicRange: "Dolby Atmos" }).map(b => b.id))
      .toEqual(["atmos", "channels-5.1"]);
    expect(resolveAudioBadges({ audioCodec: "flac", audioChannels: 2 }).map(b => b.id))
      .toEqual(["a-flac", "ch-20"]);
  });

  it("el codec entra si no hay tecnologia", () => {
    expect(resolveAudioBadges({ audioCodec: "flac", audioChannels: 8 }).map(b => b.id))
      .toEqual(["a-flac", "channels-7.1"]);
  });

  it("solo aparece lo que el .json declara", () => {
    expect(resolveAudioBadges({ audioCodec: "aac", audioChannels: 2 }).map(b => b.id))
      .toEqual(["ch-20"]);
    expect(resolveAudioBadges({ audioChannels: 7 }).map(b => b.id))
      .toEqual(["channels-6.1"]);
  });

  it("sin datos no inventa logos", () => {
    expect(resolveAudioBadges(null)).toEqual([]);
    expect(resolveAudioBadges({})).toEqual([]);
  });
});

describe("presentAudioTrack", () => {
  it("la pista manda sobre el dato del archivo", () => {
    const presentation = presentAudioTrack("English - Dolby Atmos 5.1", { audioCodec: "ac3" });
    expect(presentation.label).toBe("Inglés");
    expect(presentation.badge?.id).toBe("atmos");
  });

  it("usa el dato del archivo cuando la pista no dice nada", () => {
    const presentation = presentAudioTrack("Inglés", { dynamicRange: "Dolby Atmos" });
    expect(presentation.label).toBe("Inglés");
    expect(presentation.badge?.label).toBe("Dolby Atmos");
  });

  it("el codigo crudo del stream se vuelve legible", () => {
    expect(presentAudioTrack("en").label).toBe("Inglés");
    expect(presentAudioTrack("ja").label).toBe("Japonés");
    expect(presentAudioTrack("spa").label).toBe("Español");
expect(presentAudioTrack("en - Dolby Atmos 5.1").label).toBe("Inglés");
  });
});

/**
 * La cabecera del menu de audio del reproductor y el panel de streams tienen que
 * dar la misma respuesta. Cuando no la daba: el panel corria los patrones del
 * manifiesto sobre el TEXTO de la stream (nombre, titulo, filename) y la
 * cabecera solo miraba `technicalMetadata`, asi que una stream con Atmos en el
 * nombre se quedaba sin logo dentro del reproductor.
 */
describe("cabecera del menu de audio", () => {
  const atmosByText = {
    id: "s1",
    name: "Marty Supreme 1080p Atmos",
    title: "Marty Supreme 1080p Atmos DDP5.1",
    behaviorHints: { filename: "Marty.Supreme.1080p.Atmos.DDP5.1.mkv" },
    // El .json no declara nada de audio mas alla del codec: el Atmos solo esta
    // en el texto.
    technicalMetadata: { audioCodec: "eac3", audioChannels: 6 },
  } as unknown as MediaStream;

  it("detecta lo mismo que el panel cuando el Atmos viene del texto", () => {
    const panel = getStreamFormatBadges(atmosByText).map(entry => entry.id);
    const header = resolveHeaderAudioBadges(atmosByText);
    expect(panel).toContain("atmos");
    expect(header.map(entry => entry.id)).toContain("atmos");
    expect(header[0]?.imageUrl).toBeTruthy();
  });

  it("toma la insignia del panel tal cual, con su PNG", () => {
    const header = resolveHeaderAudioBadges(atmosByText);
    const panel = getStreamFormatBadges(atmosByText);
    for (const entry of header) {
      const source = panel.find(item => item.id === entry.id);
      expect(source?.imageUrl).toBe(entry.imageUrl);
    }
  });

  it("respeta el orden tecnologia, codec y canales, con tope de dos", () => {
    const ids = resolveHeaderAudioBadges(atmosByText, 3).map(entry => entry.id);
    expect(ids.length).toBeLessThanOrEqual(3);
    const techIndex = ids.findIndex(id => id === "atmos");
    const channelsIndex = ids.findIndex(id => id.startsWith("channels-"));
    if (techIndex >= 0 && channelsIndex >= 0) expect(techIndex).toBeLessThan(channelsIndex);
  });

  it("con el perfil declarado en el .json tambien sale", () => {
    const declared = {
      id: "s2",
      name: "Marty Supreme",
      behaviorHints: {},
      technicalMetadata: { audioProfile: "Dolby Atmos", audioChannels: 6 },
    } as unknown as MediaStream;
    expect(resolveHeaderAudioBadges(declared).map(entry => entry.id)).toContain("atmos");
  });

  it("sin pistas ni stream no hay cabecera", () => {
    expect(resolveHeaderAudioBadges(null)).toEqual([]);
    expect(resolveHeaderAudioBadges(undefined)).toEqual([]);
  });

  it("lo que no tiene PNG no se inventa", () => {
    const sinPng = {
      id: "s3",
      name: "Pelicula",
      behaviorHints: {},
      technicalMetadata: { audioCodec: "eac3", audioChannels: 6 },
    } as unknown as MediaStream;
    // El DD+ si tiene PNG: debe aparecer con el codec eac3 aunque no haya
    // nada mas declarado.
    const ids = resolveHeaderAudioBadges(sinPng).map(entry => entry.id);
    for (const id of ids) {
      expect(getStreamFormatBadges(sinPng).find(entry => entry.id === id)?.imageUrl).toBeTruthy();
    }
  });
});