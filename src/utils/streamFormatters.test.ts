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

  it("detects service, codec and release badges from title text", () => {
    const ids = getStreamFormatBadges(stream({ title: "Show S01E01 1080p WEB-DL NF x264" })).map(badge => badge.id);
    expect(ids).toEqual(expect.arrayContaining([
      "resolution-1080p",
      "s-nflx",
      "video-codec-avc",
      "q-w",
    ]));
  });

  it("detects special edition and BluRay badges", () => {
    const ids = getStreamFormatBadges(stream({ title: "Movie 2024 Extended Edition 1080p BluRay" })).map(badge => badge.id);
    expect(ids).toEqual(expect.arrayContaining([
      "edition-extended",
      "q-b",
    ]));
  });

  it("detects language badge without matching subtitle mentions", () => {
    const ids = getStreamFormatBadges(stream({ title: "Show S01E01 LATINO 1080p WEB-DL" })).map(badge => badge.id);
    expect(ids).toContain("l-es");
    expect(ids).not.toContain("l-en");
  });

  it("resolves technical badges from structured metadata", () => {
    const ids = getStreamFormatBadges(stream({ technicalMetadata: {
      resolutionHeight: 480,
      videoCodec: "HEVC",
      bitDepth: "10-bit",
      audioCodec: "AAC",
      audioChannels: 2,
    } })).map(badge => badge.id);
    expect(ids).toEqual(expect.arrayContaining([
      "gr-480p-sd",
      "video-codec-hevc",
      "bit-depth-10bit",
      "a-aac",
      "ch-20",
    ]));
  });

  it("does not duplicate concepts already covered (single 4K badge)", () => {
    const ids = getStreamFormatBadges(stream({ title: "Movie 2024 4K DV Atmos" })).map(badge => badge.id);
    expect(ids).toEqual(expect.arrayContaining([
      "resolution-2160p",
      "dolby-vision",
      "atmos",
    ]));
    expect(ids.filter(id => id === "resolution-2160p" || id === "r-4k")).toHaveLength(1);
  });

  it("every badge resolves an image", () => {
    const badges = getStreamFormatBadges(stream({
      title: "Show S01E01 10bit HEVC FLAC 2.0 LATINO NF Extended HDTV WebRip 3D IMAX-Enhanced OPUS PCM MP3 DVD-RIP",
    }));
    expect(badges.length).toBeGreaterThan(10);
    expect(badges.every(badge => badge.imageUrl)).toBe(true);
  });
});
