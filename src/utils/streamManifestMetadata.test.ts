import { describe, expect, it } from "vitest";
import { parseDashManifest, parseHlsManifest, shouldInspectStreamManifest } from "./streamManifestMetadata";

describe("stream manifest metadata", () => {
  it("extracts HLS resolution, codecs, range, channels and Atmos", () => {
    const metadata = parseHlsManifest(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,ec-3"
video.m3u8
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English Atmos",CHANNELS="6/JOC",CODECS="ec-3"`);
    expect(metadata).toMatchObject({ resolutionHeight: 1080, videoCodec: "H.264", audioCodec: expect.stringContaining("E-AC-3"), audioChannels: 6 });
    expect(metadata?.audioCodec).toMatch(/Atmos/);
  });

  it("extracts DASH HEVC/HDR and explicit audio channels", () => {
    const metadata = parseDashManifest(`<MPD><Period><AdaptationSet contentType="video" mimeType="video/mp4" codecs="hev1.2.4.L120" width="3840" height="2160"><Representation /></AdaptationSet><AdaptationSet contentType="audio" mimeType="audio/mp4" codecs="ec-3"><AudioChannelConfiguration value="8" /></AdaptationSet><SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:TransferCharacteristics" value="16" /></Period></MPD>`);
    expect(metadata).toMatchObject({ resolutionHeight: 2160, videoCodec: "HEVC", audioCodec: "E-AC-3", audioChannels: 8 });
  });

  it("returns null for invalid manifests", () => {
    expect(parseHlsManifest("not a manifest")).toBeNull();
    expect(parseDashManifest("<not-mpd />")).toBeNull();
  });

  it("does not inspect direct media files", () => {
    const base = { id: "1", addonId: "a", addonName: "A", name: "A" };
    expect(shouldInspectStreamManifest({ ...base, url: "https://cdn.test/video.mp4" })).toBe(false);
    expect(shouldInspectStreamManifest({ ...base, url: "https://cdn.test/video.mkv?token=private" })).toBe(false);
    expect(shouldInspectStreamManifest({ ...base, url: "https://cdn.test/master.m3u8?token=private" })).toBe(true);
  });
});
