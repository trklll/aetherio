import { describe, expect, it } from "vitest";
import {
  formatFiveStarRating,
  importedRatingToFiveStars,
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
});
