import { describe, expect, it } from "vitest";
import {
  formatFiveStarRating,
  importedRatingToFiveStars,
  mergeUserRatingsDocuments,
  normalizeFiveStarRating,
} from "./userRatings";

describe("five-star personal ratings", () => {
  it("formats decimal scores with the Spanish decimal separator", () => {
    expect(formatFiveStarRating(4.5)).toBe("4,5");
    expect(formatFiveStarRating(5)).toBe("5");
  });

  it("converts imported ten-point ratings to half-star steps", () => {
    expect(importedRatingToFiveStars(9)).toBe(4.5);
    expect(importedRatingToFiveStars(10)).toBe(5);
    expect(importedRatingToFiveStars(0)).toBeNull();
  });

  it("accepts only positive half-star scores up to five", () => {
    expect(normalizeFiveStarRating(0.5)).toBe(0.5);
    expect(normalizeFiveStarRating(5)).toBe(5);
    expect(normalizeFiveStarRating(0)).toBeNull();
    expect(normalizeFiveStarRating(5.5)).toBeNull();
    expect(normalizeFiveStarRating(2.3)).toBeNull();
  });

  it("merges ratings from both devices and keeps the latest edit per title", () => {
    const merged = mergeUserRatingsDocuments(
      { version: 1, ratings: { "movie:1": 3, "movie:2": 4 } },
      {
        version: 1,
        ratings: { "movie:1": 5, "movie:3": 2.5 },
        changes: {
          "movie:1": { rating: 5, updatedAt: 20, operationId: "newer" },
          "movie:3": { rating: 2.5, updatedAt: 10, operationId: "remote" },
        },
      },
    );

    expect(merged?.ratings).toEqual({ "movie:1": 5, "movie:2": 4, "movie:3": 2.5 });
  });

  it("preserves a rating removal as a tombstone so it does not return on the next sync", () => {
    const removed = {
      version: 1 as const,
      ratings: {},
      changes: {
        "movie:1": { rating: null, updatedAt: 20, operationId: "remove" },
      },
    };
    const merged = mergeUserRatingsDocuments(
      { version: 1, ratings: { "movie:1": 4 } },
      removed,
    );

    expect(merged?.ratings).toEqual({});
    expect(mergeUserRatingsDocuments(merged, { version: 1, ratings: { "movie:1": 4 } })?.ratings).toEqual({});
  });
});
