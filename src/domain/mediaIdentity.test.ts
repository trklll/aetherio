import { describe, expect, it } from "vitest";
import {
  adaptLegacyMediaRef,
  episodeRefKey,
  MediaIdentityError,
  mediaRefFromLegacy,
  mediaRefKey,
  sameMedia,
} from "./mediaIdentity";

describe("MediaRef identity", () => {
  it("uses an unambiguous stable tuple key and separates movies from series", () => {
    const movie = { kind: "movie", namespace: "tmdb", id: "42" } as const;
    const series = { kind: "series", namespace: "tmdb", id: "42" } as const;

    expect(mediaRefKey(movie)).toBe(JSON.stringify(["movie", "tmdb", "", "42"]));
    expect(mediaRefKey(movie)).not.toBe(mediaRefKey(series));
    expect(sameMedia(movie, series, [
      { left: movie, right: series, verified: true, basis: "provider-id-map" },
    ])).toBe(false);
  });

  it("keeps anime installments distinct even when they describe a shared show", () => {
    const firstRelease = { kind: "anime", namespace: "mal", id: "100" } as const;
    const secondRelease = { kind: "anime", namespace: "mal", id: "200" } as const;

    expect(sameMedia(firstRelease, secondRelease)).toBe(false);
  });

  it("requires the addon namespace and addon id to match", () => {
    const one = { kind: "series", namespace: "addon", addonId: "catalog-a", id: "title:1" } as const;
    const other = { ...one, addonId: "catalog-b" } as const;

    expect(mediaRefKey(one)).not.toBe(mediaRefKey(other));
    expect(sameMedia(one, other)).toBe(false);
  });

  it("parses known id prefixes and treats untrusted prefixes as legacy identity", () => {
    expect(mediaRefFromLegacy({ type: "tv", id: "tmdb:123" })).toEqual({
      kind: "series", namespace: "tmdb", id: "123",
    });
    expect(mediaRefFromLegacy({ type: "anime", id: "mal:77" })).toEqual({
      kind: "anime", namespace: "mal", id: "77",
    });
    expect(mediaRefFromLegacy({ type: "series", id: "unknown:123" })).toEqual({
      kind: "series", namespace: "legacy", id: JSON.stringify(["series", "unknown:123"]),
    });
    expect(mediaRefFromLegacy({ type: "series", id: "unknown:123", namespace: "tmdb" }).namespace).toBe("legacy");
    expect(mediaRefFromLegacy({ type: "movie", id: "123" }).namespace).toBe("legacy");
  });

  it("uses explicit source provenance for bare ids and preserves original legacy fields", () => {
    expect(mediaRefFromLegacy({ type: "movie", id: "123", namespace: "tmdb" })).toEqual({
      kind: "movie", namespace: "tmdb", id: "123",
    });
    expect(adaptLegacyMediaRef({ type: "tv", id: "addon-episode-1" })).toEqual({
      ref: { kind: "series", namespace: "legacy", id: JSON.stringify(["tv", "addon-episode-1"]) },
      originalType: "tv",
      originalId: "addon-episode-1",
    });
  });

  it("only follows verified aliases, and anime aliases require delivery-level proof", () => {
    const tmdbSeries = { kind: "anime", namespace: "tmdb", id: "500" } as const;
    const malRelease = { kind: "anime", namespace: "mal", id: "100" } as const;
    expect(sameMedia(tmdbSeries, malRelease, [
      { left: tmdbSeries, right: malRelease, verified: true, basis: "provider-id-map" },
    ])).toBe(false);
    expect(sameMedia(tmdbSeries, malRelease, [
      { left: tmdbSeries, right: malRelease, verified: true, basis: "anime-installment-map" },
    ])).toBe(true);
    expect(sameMedia(tmdbSeries, malRelease, [
      { left: tmdbSeries, right: malRelease, verified: false, basis: "anime-installment-map" },
    ])).toBe(false);
  });

  it("keeps episode identity stable and rejects malformed refs with a typed error", () => {
    const media = { kind: "anime", namespace: "mal", id: "100" } as const;
    expect(episodeRefKey({ media, season: 1, episode: 2 })).toBe(
      JSON.stringify(["anime", "mal", "", "100", 1, 2]),
    );
    expect(episodeRefKey({ media })).toBe(JSON.stringify(["anime", "mal", "", "100", null, null]));
    expect(() => mediaRefKey({ kind: "series", namespace: "addon", id: "x" } as never))
      .toThrow(MediaIdentityError);
    expect(() => episodeRefKey({ media, season: -1 })).toThrow(MediaIdentityError);
  });
});
