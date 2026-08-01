import { describe, expect, it } from "vitest";
import type { MediaStream } from "../types/stream";
import { getStreamFormatBadges } from "./streamFormatters";

const stream = (overrides: Partial<MediaStream> = {}): MediaStream => ({
  id: "test-stream",
  addonId: "test-addon",
  addonName: "Test",
  name: "Test",
  ...overrides,
});

describe("stream format badges", () => {
  it("keeps the original JSON assets and their image associations", () => {
    const badges = getStreamFormatBadges(stream({ title: "1080p DDP HDR10 5.1" }));
    expect(badges.map(badge => badge.id)).toEqual(expect.arrayContaining([
      "resolution-1080p",
      "dolby-digital-plus",
      "hdr10",
      "channels-5.1",
    ]));
    expect(badges.every(badge => badge.imageUrl)).toBe(true);
  });

  it("does not expose manually added codec, resolution or channel badges", () => {
    const ids = getStreamFormatBadges(stream({ title: "H.264 H.265 HEVC FHD UHD 480p 2.0 Mono" })).map(badge => badge.id);
    expect(ids).not.toEqual(expect.arrayContaining([
      "codec-h264", "codec-h265", "codec-hevc", "fhd", "uhd", "resolution-480p", "channels-2.0", "channels-mono",
    ]));
  });

  it("uses explicit structured channels without inferring them from DDP", () => {
    expect(getStreamFormatBadges(stream({ title: "DDP" })).map(badge => badge.id)).not.toContain("channels-5.1");
    expect(getStreamFormatBadges(stream({ technicalMetadata: {
      resolutionHeight: 1080,
      audioCodec: "E-AC-3",
      audioChannels: 6,
    } })).map(badge => badge.id)).toEqual(expect.arrayContaining([
      "resolution-1080p",
      "dolby-digital-plus",
      "channels-5.1",
    ]));
  });
});
