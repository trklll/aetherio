import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap } from "gsap";
import { restorePageTransition } from "./pageTransition";

vi.mock("gsap", () => ({ gsap: { killTweensOf: vi.fn(), set: vi.fn() } }));

describe("restorePageTransition", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("kills interrupted animation and clears opacity and transform", () => {
    const element = {} as HTMLElement;

    restorePageTransition(element);

    expect(gsap.killTweensOf).toHaveBeenCalledWith(element);
    expect(gsap.set).toHaveBeenCalledWith(element, {
      clearProps: "opacity,transform,transformOrigin,willChange",
    });
  });

  it("does nothing when the route element is no longer mounted", () => {
    restorePageTransition(null);

    expect(gsap.killTweensOf).not.toHaveBeenCalled();
    expect(gsap.set).not.toHaveBeenCalled();
  });
});
