import { describe, expect, it } from "vitest";
import { shouldPlayPlatformIntroForEntry } from "./streamingPlatformIntroHistory";

describe("streaming platform intro per history entry", () => {
  it("plays once when a platform history entry is first opened", () => {
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "platform-entry-1", true)).toBe(true);
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "platform-entry-1", true)).toBe(false);
  });

  it("plays again for a fresh visit but not when returning to the same entry", () => {
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "detail-return-entry", true)).toBe(true);
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "detail-return-entry", true)).toBe(false);
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "fresh-entry", true)).toBe(true);
  });

  it("does not claim entries when intros are disabled", () => {
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "disabled-entry", false)).toBe(false);
    expect(shouldPlayPlatformIntroForEntry("hbo-max", "disabled-entry", true)).toBe(true);
  });
});
