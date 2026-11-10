import { describe, expect, it } from "vitest";
import { decimalOdds, formatDecimalOdds } from "./sportsOdds";

describe("decimal sports odds", () => {
  it("converts American prices, not English fractional odds", () => {
    expect(formatDecimalOdds(-145, "american")).toBe("1.69");
    expect(formatDecimalOdds(150, "american")).toBe("2.50");
    expect(formatDecimalOdds(-380, "american")).toBe("1.26");
    expect(formatDecimalOdds(-125, "american")).toBe("1.80");
    expect(formatDecimalOdds(2.4)).toBe("2.40");
  });
  it("rejects absent, non-finite and impossible prices instead of fabricating them", () => {
    for (const value of [undefined, null, NaN, Infinity, 0, 1, -3]) expect(decimalOdds(value)).toBeUndefined();
    for (const value of [0, 99, -99]) expect(formatDecimalOdds(value, "american")).toBeUndefined();
  });
});
