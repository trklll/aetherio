import { describe, expect, it } from "vitest";
import { getSteppedRangeValue } from "./rangeInput";

describe("getSteppedRangeValue", () => {
  it("moves continuously while clamping and respecting the step", () => {
    expect(getSteppedRangeValue(90, 80, 100, 1, 0.3)).toBe(90);
    expect(getSteppedRangeValue(90, 80, 100, 1, 1.2)).toBe(91);
    expect(getSteppedRangeValue(99, 97, 100, 1, 8)).toBe(100);
    expect(getSteppedRangeValue(98, 97, 100, 1, -8)).toBe(97);
  });

  it("supports fractional steps", () => {
    expect(getSteppedRangeValue(1, 0, 3.5, 0.5, 0.4)).toBe(1.5);
  });
});
