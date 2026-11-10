import { describe, expect, it } from "vitest";
import { getRelativeSeekTarget } from "./playerSeek.ts";

describe("getRelativeSeekTarget", () => {
  it("calculates repeated relative seeks from the latest playhead", () => {
    const firstTarget = getRelativeSeekTarget(120, 900, 30);
    const secondTarget = getRelativeSeekTarget(firstTarget, 900, -10);

    expect(firstTarget).toBe(150);
    expect(secondTarget).toBe(140);
  });

  it("clamps seeks to the start and known duration", () => {
    expect(getRelativeSeekTarget(10, 900, -30)).toBe(0);
    expect(getRelativeSeekTarget(895, 900, 30)).toBe(900);
  });

  it("allows forward seeks when duration is not known", () => {
    expect(getRelativeSeekTarget(10, 0, 30)).toBe(40);
  });
});
