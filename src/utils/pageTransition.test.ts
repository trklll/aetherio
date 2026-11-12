import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap } from "gsap";
import { animatePageTransitionCurtain, restorePageTransition } from "./pageTransition";

const curtainTween = vi.hoisted(() => ({ kill: vi.fn() }));
vi.mock("gsap", () => ({
  gsap: {
    killTweensOf: vi.fn(),
    set: vi.fn(),
    fromTo: vi.fn(() => curtainTween),
  },
}));

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

  it("clears a route curtain when its transition is interrupted", () => {
    const curtain = {} as HTMLElement;

    const cleanup = animatePageTransitionCurtain(curtain, false);
    cleanup();

    expect(curtainTween.kill).toHaveBeenCalledOnce();
    expect(gsap.killTweensOf).toHaveBeenCalledWith(curtain);
    expect(gsap.set).toHaveBeenLastCalledWith(curtain, {
      clearProps: "opacity,transform,willChange",
    });
  });

  it("forces the curtain clear if the entrance tween never completes", () => {
    vi.useFakeTimers();
    const curtain = {} as HTMLElement;
    const cleanup = animatePageTransitionCurtain(curtain, false);

    vi.advanceTimersByTime(600);

    expect(curtainTween.kill).toHaveBeenCalledOnce();
    expect(gsap.set).toHaveBeenLastCalledWith(curtain, {
      clearProps: "opacity,transform,willChange",
    });
    cleanup();
    vi.useRealTimers();
  });

  it("does not animate the route curtain when reduced motion is enabled", () => {
    const curtain = {} as HTMLElement;

    animatePageTransitionCurtain(curtain, true);

    expect(gsap.fromTo).not.toHaveBeenCalled();
    expect(gsap.set).toHaveBeenCalledWith(curtain, {
      clearProps: "opacity,transform,willChange",
    });
  });
});
