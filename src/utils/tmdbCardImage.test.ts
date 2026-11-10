import { describe, expect, it } from "vitest";
import { getTmdbCardImageResponsiveProps } from "./tmdbCardImage";

describe("getTmdbCardImageResponsiveProps", () => {
  it("uses backdrop variants sized for a horizontal card and preserves URL parameters", () => {
    const responsive = getTmdbCardImageResponsiveProps(
      "https://image.tmdb.org/t/p/original/backdrop.jpg?token=abc",
      425,
    );

    expect(responsive).toEqual({
      fallbackSrc: "https://image.tmdb.org/t/p/w500/backdrop.jpg?token=abc",
      srcSet: [
        "https://image.tmdb.org/t/p/w500/backdrop.jpg?token=abc 500w",
        "https://image.tmdb.org/t/p/w780/backdrop.jpg?token=abc 780w",
        "https://image.tmdb.org/t/p/w1280/backdrop.jpg?token=abc 1280w",
        "https://image.tmdb.org/t/p/w1920/backdrop.jpg?token=abc 1920w",
        "https://image.tmdb.org/t/p/original/backdrop.jpg?token=abc 3840w",
      ].join(", "),
      sizes: "425px",
    });
  });

  it("uses poster variants for vertical cards", () => {
    const responsive = getTmdbCardImageResponsiveProps(
      "https://image.tmdb.org/t/p/original/poster.jpg",
      217,
    );

    expect(responsive?.srcSet).toBe([
      "https://image.tmdb.org/t/p/w342/poster.jpg 342w",
      "https://image.tmdb.org/t/p/w500/poster.jpg 500w",
      "https://image.tmdb.org/t/p/w780/poster.jpg 780w",
      "https://image.tmdb.org/t/p/original/poster.jpg 3840w",
    ].join(", "));
    expect(responsive?.fallbackSrc).toBe("https://image.tmdb.org/t/p/w342/poster.jpg");
    expect(responsive?.sizes).toBe("217px");
  });

  it.each([
    undefined,
    "",
    "/api/poster/local.jpg",
    "https://image.tmdb.org/t/p/w780/already-sized.jpg",
    "https://example.com/t/p/original/custom.jpg",
    "https://image.tmdb.org.evil.test/t/p/original/not-tmdb.jpg",
  ])("leaves non-original or non-TMDB sources alone (%s)", source => {
    expect(getTmdbCardImageResponsiveProps(source, 425)).toBeUndefined();
  });

  it("rejects invalid card widths", () => {
    expect(getTmdbCardImageResponsiveProps("https://image.tmdb.org/t/p/original/a.jpg", 0)).toBeUndefined();
    expect(getTmdbCardImageResponsiveProps("https://image.tmdb.org/t/p/original/a.jpg", Number.NaN)).toBeUndefined();
  });

  it("selects a safe fallback variant for wide hero and neighbor images", () => {
    expect(getTmdbCardImageResponsiveProps("https://image.tmdb.org/t/p/original/hero.jpg", 1920)?.fallbackSrc)
      .toBe("https://image.tmdb.org/t/p/w1920/hero.jpg");
    expect(getTmdbCardImageResponsiveProps("https://image.tmdb.org/t/p/original/side.jpg", 1188)?.fallbackSrc)
      .toBe("https://image.tmdb.org/t/p/w1280/side.jpg");
  });
});
