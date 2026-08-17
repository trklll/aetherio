import { describe, expect, it } from "vitest";
import {
  formatAutoSyncDelay,
  formatAutoSyncTimestamp,
  parseSubtitleCuesFromText,
  sanitizeCuePreviewText,
  selectAutoSyncVisibleCues,
} from "./parser";

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hola <i>mundo</i>

2
00:00:05,000 --> 00:00:05,000
Cero duracion (debe descartarse)

3
00:00:10,500 --> 00:00:12,000
Segunda &quot;linea&quot; &amp; mas`;

describe("parser SRT", () => {
  it("parsea bloques y descarta duracion cero", () => {
    const cues = parseSubtitleCuesFromText(SRT, "https://x.com/s.srt");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startTimeMs: 1000, endTimeMs: 3500, text: "Hola mundo" });
    expect(cues[1].text).toBe("Segunda \"linea\" & mas");
  });
  it("normaliza entidades y tags", () => {
    const cues = parseSubtitleCuesFromText(SRT, "https://x.com/s.srt");
    expect(cues[1].text).toContain("&");
    expect(cues[0].text).not.toContain("<i>");
  });
});

const VTT = `WEBVTT
Kind: captions

STYLE
::cue { color: red }

NOTE comment

intro
00:00:00.500 --> 00:00:02.000 align:start
<00:00:01.000>Primera <b>linea</b>

2
00:00:03.000 --> 00:00:04.500
Segunda linea`;

describe("parser VTT", () => {
  it("salta STYLE/NOTE, respeta cue identifier y tags de tiempo", () => {
    const cues = parseSubtitleCuesFromText(VTT, "https://x.com/s.vtt");
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ startTimeMs: 500, endTimeMs: 2000, text: "Primera linea" });
    expect(cues[1].text).toBe("Segunda linea");
  });
  it("detecta VTT por header aunque la url sea .srt", () => {
    const cues = parseSubtitleCuesFromText(VTT, "https://x.com/s.srt");
    expect(cues).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("formatea timestamps y delays", () => {
    expect(formatAutoSyncTimestamp(75_000)).toBe("01:15");
    expect(formatAutoSyncTimestamp(3_661_000)).toBe("1:01:01");
    expect(formatAutoSyncDelay(1500)).toBe("+1.500s");
    expect(formatAutoSyncDelay(-300)).toBe("-0.300s");
    expect(formatAutoSyncDelay(0)).toBe("+0.000s");
  });
  it("sanitiza ASS override tags", () => {
    expect(sanitizeCuePreviewText("{\\an8}Linea\\Nsegunda\\ntercera")).toBe("Linea segunda tercera");
  });
  it("selecciona ventana centrada", () => {
    const cues = Array.from({ length: 120 }, (_, i) => ({
      startTimeMs: i * 1000,
      endTimeMs: i * 1000 + 500,
      text: `cue ${i}`,
    }));
    const visible = selectAutoSyncVisibleCues(cues, 61_000, 180_000, 90);
    expect(visible).toHaveLength(90);
    expect(visible[0].startTimeMs).toBe(16_000);
    expect(visible[89].startTimeMs).toBe(105_000);
  });
});
