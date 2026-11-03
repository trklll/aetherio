import { describe, expect, it } from "vitest";
import { allowsAdditionalTorrent, allowsAdditionalVideo } from "./policy.ts";

describe("additional sources: original audio, no burnt-in subtitles", () => {
  it.each([
    "[SubsPlease] Sample - 03 (1080p) [1234ABCD].mkv",
    "[Erai-raws] Sample - 03 [1080p][Multiple Subtitle].mkv",
    "Sample - 03 [Japanese][Softsubs].mkv",
    "[Ohys-Raws] Sample - 03 (BS11 1280x720 x264 AAC).mp4",
  ])("accepts releases with positive raw/softsub evidence: %s", name => {
    expect(allowsAdditionalTorrent({ name })).toBe(true);
  });
  it.each([
    "Sample - 03 [English Dub][Softsubs].mkv", "Sample - 03 [German Dub][Raw].mkv",
    "Sample - 03 [Dual Audio][Softsubs].mkv", "Sample - 03 [French Dub].mkv",
    "Sample - 03 [Hardsub].mp4", "[SubsPlease] Sample [Hardsubs].mkv",
    "Sample - 03.mkv", "Sample - 03 [English Sub].mp4",
  ])("rejects dubs, hardsubs and unknown subtitle formats: %s", name => {
    expect(allowsAdditionalTorrent({ name })).toBe(false);
  });
  it("does not equate an external subtitle with absence of burnt-in subtitles", () => {
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [{ language: "en" }] }, "hard-sub")).toBe(false);
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [{ language: "en" }] }, "soft-sub")).toBe(true);
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [] }, "raw")).toBe(true);
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [] }, "english-dub")).toBe(false);
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [] }, "unknown")).toBe(false);
  });
  it("fails closed for a trusted softsub site with no subtitle metadata, and rejects every foreign-dub label", () => {
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [] }, "Auto", true)).toBe(false);
    expect(allowsAdditionalVideo({ type: "m3u8", subtitles: [{ url: "https://cdn.example/sub.vtt" }] }, "Auto", true)).toBe(true);
    for (const server of ["Italian", "Korean", "Chinese Dub", "Portuguese (Brazil)"]) {
      expect(allowsAdditionalVideo({ subtitles: [{ language: "en" }] }, server, true)).toBe(false);
    }
  });
});
