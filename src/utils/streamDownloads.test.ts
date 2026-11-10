import { describe, expect, it } from "vitest";
import type { MediaStream } from "../types/stream";
import { getStreamDownloadAvailability, getStreamDownloadTarget, sanitizeDownloadFilename } from "./streamDownloads";

function stream(overrides: Partial<MediaStream> = {}): MediaStream {
  return {
    id: "stream-1",
    addonId: "addon-1",
    addonName: "Test source",
    name: "Test source",
    url: "https://cdn.example/video.mp4",
    ...overrides,
  };
}

describe("stream download availability", () => {
  it("allows direct HTTP media URLs", () => {
    expect(getStreamDownloadAvailability(stream()).transport).toBe("http");
  });

  it("recognizes HLS VOD playlists", () => {
    expect(getStreamDownloadAvailability(stream({ url: "https://cdn.example/master.m3u8?token=x" })))
      .toMatchObject({ supported: true, transport: "hls" });
  });

  it("allows Provider Hub torrent sources with a valid hash", () => {
    expect(getStreamDownloadAvailability(stream({
      url: "magnet:?xt=urn:btih:0123456789012345678901234567890123456789",
      infoHash: "0123456789012345678901234567890123456789",
      fileIdx: 2,
    }))).toMatchObject({ supported: true, transport: "torrent" });
    expect(getStreamDownloadAvailability(stream({
      url: undefined,
      infoHash: undefined,
      sources: ["magnet:?xt=urn:btih:0123456789012345678901234567890123456789"],
    }))).toMatchObject({ supported: true, transport: "torrent" });
    expect(getStreamDownloadTarget(stream({
      url: undefined,
      infoHash: undefined,
      sources: ["magnet:?xt=urn:btih:0123456789012345678901234567890123456789"],
    }))).toBe("magnet:?xt=urn:btih:0123456789012345678901234567890123456789");
  });

  it("supports static DASH manifests and Provider Hub YouTube IDs", () => {
    expect(getStreamDownloadAvailability(stream({ url: "https://cdn.example/manifest.mpd" })))
      .toMatchObject({ supported: true, transport: "dash" });
    expect(getStreamDownloadAvailability(stream({ url: undefined, ytId: "abc123" })))
      .toMatchObject({ supported: true, transport: "youtube" });
    expect(getStreamDownloadAvailability(stream({ url: "https://www.youtube.com/watch?v=abc123" })))
      .toMatchObject({ supported: true, transport: "youtube" });
    expect(getStreamDownloadTarget(stream({ url: undefined, ytId: "abc 123" })))
      .toBe("https://www.youtube.com/watch?v=abc%20123");
  });

  it("downloads signed Googlevideo media URLs directly", () => {
    const target = "https://r3---sn.example.googlevideo.com/videoplayback?id=opaque";
    expect(getStreamDownloadAvailability(stream({ url: target })))
      .toMatchObject({ supported: true, transport: "http" });
    expect(getStreamDownloadTarget(stream({ url: target }))).toBe(target);
  });

  it("rejects live streams and IPTV", () => {
    expect(getStreamDownloadAvailability(stream({ behaviorHints: { live: true } })).supported).toBe(false);
    expect(getStreamDownloadAvailability(stream({ behaviorHints: { sourceType: "iptv" } })).supported).toBe(false);
  });

  it("explains invalid torrent and non-HTTP sources", () => {
    for (const candidate of [
      stream({ url: "magnet:?xt=urn:btih:bad" }),
      stream({ url: "file:///video.mp4" }),
    ]) {
      const availability = getStreamDownloadAvailability(candidate);
      expect(availability.supported).toBe(false);
      expect(availability.reason).toBeTruthy();
    }
  });
});

describe("download filename sanitization", () => {
  it("removes Windows path/control characters and keeps an extension", () => {
    expect(sanitizeDownloadFilename("../Film: <test>?*", ".mp4")).toBe("Film_ _test___.mp4");
  });

  it("falls back to a safe title when the name is empty", () => {
    expect(sanitizeDownloadFilename("  ", ".ts")).toBe("video.ts");
  });
});
