import { describe, expect, it } from "vitest";
import { resolvePostPlayAction, advancePostPlayCountdown } from "./postPlayPrompt";

describe("post-play prompt arbitration", () => {
  it("next episode wins over outro, but not before the threshold", () => {
    expect(resolvePostPlayAction({ nextReady: true, recommendationReady: false, dismissed: false, skipKind: "outro" })).toBe("next-episode");
    expect(resolvePostPlayAction({ nextReady: false, recommendationReady: false, dismissed: false, skipKind: "outro" })).toBe("skip");
  });
  it("cancelling never falls through to the conflicting outro", () => {
    expect(resolvePostPlayAction({ nextReady: true, recommendationReady: false, dismissed: true, skipKind: "outro" })).toBeNull();
  });
  it("movies offer recommendations without a next episode", () => {
    expect(resolvePostPlayAction({ nextReady: false, recommendationReady: true, dismissed: false, skipKind: "outro" })).toBe("recommendation");
  });
  it("keeps intro/resumen available before post-play", () => {
    expect(resolvePostPlayAction({ nextReady: false, recommendationReady: false, dismissed: false, skipKind: "intro" })).toBe("skip");
  });
  it("does not invent an action when there is nothing playable", () => {
    expect(resolvePostPlayAction({ nextReady: false, recommendationReady: false, dismissed: false, skipKind: null })).toBeNull();
  });
});

describe("countdown", () => {
  it("waits a full countdown rather than navigating at the threshold", () => {
    expect(advancePostPlayCountdown(0, 1000, true)).toBe(1000);
    expect(advancePostPlayCountdown(11_000, 1000, true)).toBe(12_000);
  });
  it("does not run during pause, buffering or hidden overlays", () => {
    expect(advancePostPlayCountdown(5000, 1000, false)).toBe(5000);
  });
  it("clamps at the deadline", () => {
    expect(advancePostPlayCountdown(11_900, 500, true)).toBe(12_000);
  });
});
