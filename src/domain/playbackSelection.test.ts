import { describe, expect, it } from "vitest";
import {
  createPlaybackTrackPreference,
  matchPlaybackTrackPreference,
  normalizePlaybackLanguage,
  normalizePlaybackTrackTitle,
  resolvePlaybackTrackSelection,
  type PlaybackTrackCandidate,
} from "./playbackSelection";

const audio: PlaybackTrackCandidate[] = [
  { value: "track:2", language: "spa", title: "Español - Latino" },
  { value: "track:5", language: "eng", title: "English" },
];

describe("identidad semántica de pistas", () => {
  it("normaliza idioma y título sin perder los marcadores forced/SDH", () => {
    expect(normalizePlaybackLanguage("es-419")).toBe("spa");
    expect(normalizePlaybackTrackTitle("  Español — Comentário (SDH)  ")).toBe("espanol comentario");
    expect(createPlaybackTrackPreference({
      language: "es",
      title: "Español - Forced SDH",
    })).toEqual({ language: "spa", title: "espanol", forced: true, sdh: true });
  });

  it("encuentra la misma pista semántica aunque mpv asigne otro id", () => {
    const preference = createPlaybackTrackPreference({ language: "spa", title: "Español - Latino" });
    expect(preference).not.toBeNull();
    expect(matchPlaybackTrackPreference(preference!, [
      { value: "track:18", language: "eng", title: "English" },
      { value: "track:42", language: "spa", title: "Español - Latino" },
    ])?.value).toBe("track:42");
  });

  it("no elige una pista por índice si varias del mismo idioma son ambiguas", () => {
    const preference = createPlaybackTrackPreference({ language: "spa", title: "Comentario" });
    expect(matchPlaybackTrackPreference(preference!, [
      { value: "track:2", language: "spa", title: "Latino" },
      { value: "track:7", language: "spa", title: "Castellano" },
    ])).toBeNull();
  });

  it("respeta flags forced y SDH al emparejar", () => {
    const preference = createPlaybackTrackPreference({ language: "eng", title: "English SDH" });
    expect(matchPlaybackTrackPreference(preference!, [
      { value: "track:4", language: "eng", title: "English", sdh: false },
      { value: "track:9", language: "eng", title: "English SDH", sdh: true },
    ])?.value).toBe("track:9");
  });
});

describe("precedencia de selección de reproducción", () => {
  const spanish = createPlaybackTrackPreference({ language: "spa", title: "Español" })!;
  const english = createPlaybackTrackPreference({ language: "eng", title: "English" })!;

  it("prioriza sesión manual, episodio, entrega, idioma global y luego pista predeterminada", () => {
    const candidates: PlaybackTrackCandidate[] = [
      { value: "track:31", language: "spa", title: "Español" },
      { value: "track:32", language: "eng", title: "English", isDefault: true },
    ];
    const resolve = (input: Partial<Parameters<typeof resolvePlaybackTrackSelection>[0]> = {}) =>
      resolvePlaybackTrackSelection({
        candidates,
        globalLanguages: ["eng"],
        ...input,
      });

    expect(resolve({ manual: spanish }).candidate?.value).toBe("track:31");
    expect(resolve({ episode: spanish, delivery: english }).source).toBe("episode");
    expect(resolve({ delivery: spanish }).source).toBe("delivery");
    expect(resolve().source).toBe("global");
    expect(resolve({ globalLanguages: [] }).source).toBe("default");
    expect(resolve({ globalLanguages: [], candidates: [{ ...candidates[0], isDefault: false }] }).source).toBe("none");
  });

  it("un off guardado es una intención terminal, no un fallback a forced ni al idioma global", () => {
    const off = { language: "", title: "", forced: false, sdh: false, subtitleMode: "off" as const };
    const result = resolvePlaybackTrackSelection({
      candidates: [{ value: "track:8", language: "eng", title: "English Forced", forced: true }],
      episode: off,
      delivery: spanish,
      globalLanguages: ["eng"],
      kind: "subtitle",
    });
    expect(result).toMatchObject({ source: "episode", mode: "off", candidate: null });
  });

  it("una intención ausente en la fuente queda intacta y permite fallback sin borrarla", () => {
    const missing = createPlaybackTrackPreference({ language: "spa", title: "Español" })!;
    const savedBefore = structuredClone(missing);
    const result = resolvePlaybackTrackSelection({
      candidates: [{ value: "track:6", language: "eng", title: "English" }],
      episode: missing,
      globalLanguages: ["eng"],
      kind: "audio",
    });
    expect(result).toMatchObject({ source: "global", candidate: { value: "track:6" } });
    expect(missing).toEqual(savedBefore);
  });

  it("usa el segundo idioma global y deja el predeterminado del archivo si no hay coincidencias", () => {
    expect(resolvePlaybackTrackSelection({
      candidates: audio,
      globalLanguages: ["", "spa"],
    }).candidate?.value).toBe("track:2");
    expect(resolvePlaybackTrackSelection({
      candidates: audio,
      globalLanguages: ["jpn"],
      defaultValue: "track:5",
    }).source).toBe("default");
    expect(english.language).toBe("eng");
  });
});
