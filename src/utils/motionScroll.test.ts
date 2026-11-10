import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, installInertialScroll, scrollByGsap, stopInertialScroll } from "./motion";

vi.mock("gsap", () => ({ gsap: { to: vi.fn(), killTweensOf: vi.fn() } }));

class ScrollElement extends EventTarget {
  scrollTop = 0;
  scrollHeight = 5000;
  clientHeight = 900;
  parentElement: ScrollElement | null = null;
  optOut = false;
  scrollTo = vi.fn((_options: ScrollToOptions) => {});
  closest() { return this.optOut ? this : null; }
}

class Wheel extends Event {
  static DOM_DELTA_PIXEL = 0;
  static DOM_DELTA_LINE = 1;
  static DOM_DELTA_PAGE = 2;
  deltaY = 120;
  deltaX = 0;
  deltaMode = 0;
  ctrlKey = false;
  metaKey = false;
  shiftKey = false;
  constructor(options: Partial<Wheel> = {}) {
    super("wheel", { cancelable: true });
    Object.assign(this, options);
  }
}

const cleanups: Array<() => void> = [];
beforeEach(() => {
  vi.clearAllMocks();
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLElement", ScrollElement);
  vi.stubGlobal("WheelEvent", Wheel);
  vi.stubGlobal("getComputedStyle", () => ({ overflowY: "auto" }));
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.unstubAllGlobals();
});

function mount() {
  const element = new ScrollElement();
  cleanups.push(installInertialScroll(element as unknown as HTMLElement, { compositor: true }));
  return element;
}

describe("compositor-backed TV wheel routing", () => {
  it("accumulates bursts without starting GSAP scrollTop tweens", () => {
    const element = mount();
    const wheel = new Wheel();
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 160.8, behavior: "smooth" });
    element.dispatchEvent(new Wheel());
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 321.6, behavior: "smooth" });
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it("respects nested vertical scrollers", () => {
    const element = mount();
    const child = new ScrollElement();
    child.parentElement = element;
    const wheel = new Wheel();
    Object.defineProperty(wheel, "target", { value: child });
    element.dispatchEvent(wheel);
    expect(child.scrollTo).toHaveBeenCalledWith({ top: 160.8, behavior: "smooth" });
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("does not capture zoom, horizontal, shift or opted-out gestures", () => {
    const element = mount();
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaX: 240 }, { deltaY: 0 }]) {
      const wheel = new Wheel(options);
      element.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(false);
    }
    element.optOut = true;
    element.dispatchEvent(new Wheel());
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("clamps to the end and leaves boundary chaining to the browser", () => {
    const element = mount();
    element.scrollTop = 4000;
    element.dispatchEvent(new Wheel());
    expect(element.scrollTo).toHaveBeenCalledWith({ top: 4100, behavior: "smooth" });
    element.scrollTop = 4100;
    const wheel = new Wheel();
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(element.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("cancels pending native motion on pointer/scrollbar interaction", () => {
    const element = mount();
    element.dispatchEvent(new Wheel());
    element.scrollTop = 50;
    element.dispatchEvent(new Event("pointerdown"));
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 50, behavior: "instant" });
    element.dispatchEvent(new Wheel());
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 210.8, behavior: "smooth" });
  });

  it("clears the pending target after scrollend", () => {
    const element = mount();
    element.dispatchEvent(new Wheel());
    element.scrollTop = 160.8;
    element.dispatchEvent(new Event("scrollend"));
    element.scrollTop = 50;
    element.dispatchEvent(new Wheel());
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 210.8, behavior: "smooth" });
  });

  it("stops on navigation keys and removes listeners on cleanup", () => {
    const element = mount();
    element.dispatchEvent(new Wheel());
    const key = new Event("keydown");
    Object.defineProperty(key, "key", { value: "ArrowDown" });
    window.dispatchEvent(key);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });
    cleanups.pop()!();
    element.scrollTo.mockClear();
    element.dispatchEvent(new Wheel());
    expect(element.scrollTo).not.toHaveBeenCalled();
    expect(() => stopInertialScroll(null)).not.toThrow();
  });

  it("keeps reduced-motion gestures native and unmodified", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const element = mount();
    const wheel = new Wheel();
    element.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });
});

describe("shared GSAP row scrolling", () => {
  it("uses the Home tween and easing for vertical panel follow-scroll", () => {
    const element = new ScrollElement();
    element.scrollTop = 120;

    scrollByGsap(element as unknown as HTMLElement, 48, 0.48, "vertical");

    expect(gsap.to).toHaveBeenCalledWith(element, {
      scrollTop: 168,
      duration: 0.48,
      ease: "power3.out",
      overwrite: "auto",
    });
  });
});
