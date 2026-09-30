import { describe, expect, it } from "vitest";
import { shouldUseDarkPlayerText } from "./playerContrast.ts";

describe("shouldUseDarkPlayerText", () => {
  it("does not switch for dark artwork", () => {
    expect(shouldUseDarkPlayerText({ average: 0.28, brightPixelRatio: 0.08 })).toBe(false);
  });

  it("switches when the artwork is broadly bright", () => {
    expect(shouldUseDarkPlayerText({ average: 0.74, brightPixelRatio: 0.4 })).toBe(true);
  });

  it("switches when most pixels are bright even if the mean is mixed", () => {
    expect(shouldUseDarkPlayerText({ average: 0.58, brightPixelRatio: 0.66 })).toBe(true);
  });

  it("keeps the current white scheme when sampling is unavailable", () => {
    expect(shouldUseDarkPlayerText(null)).toBe(false);
  });
});
