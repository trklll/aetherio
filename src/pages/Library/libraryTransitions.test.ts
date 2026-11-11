import { beforeEach, describe, expect, it, vi } from "vitest";
import { gsap } from "gsap";
import { animateLibraryTabPanel } from "./libraryTransitions";

const tween = vi.hoisted(() => ({ kill: vi.fn() }));
vi.mock("gsap", () => ({
  gsap: {
    fromTo: vi.fn(() => tween),
    killTweensOf: vi.fn(),
    set: vi.fn(),
  },
}));

describe("animateLibraryTabPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("kills an interrupted entrance and clears its visual styles on cleanup", () => {
    const panel = {} as HTMLElement;
    const cleanup = animateLibraryTabPanel(panel, false);

    cleanup();

    expect(tween.kill).toHaveBeenCalledOnce();
    expect(gsap.set).toHaveBeenLastCalledWith(panel, {
      clearProps: "opacity,transform,willChange",
    });
  });

  it("also cleans up the reduced-motion cross-fade", () => {
    const panel = {} as HTMLElement;
    const cleanup = animateLibraryTabPanel(panel, true);

    cleanup();

    expect(tween.kill).toHaveBeenCalledOnce();
    expect(gsap.set).toHaveBeenLastCalledWith(panel, {
      clearProps: "opacity,transform",
    });
  });

});
