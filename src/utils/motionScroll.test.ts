import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gsap, installWheelScroll, installInertialScroll, scrollByGsap, stopInertialScroll } from "./motion";

vi.mock("gsap", () => ({ gsap: { to: vi.fn(), killTweensOf: vi.fn() } }));

class ScrollElement extends EventTarget {
  scrollTop = 0;
  scrollHeight = 5000;
  clientHeight = 900;
  parentElement: ScrollElement | null = null;
  overflowY = "auto";
  overscrollBehaviorY = "auto";
  optOut = false;
  scrollTo = vi.fn((options: ScrollToOptions) => { this.scrollTop = options.top ?? this.scrollTop; });
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
  constructor(options: Partial<Wheel> = {}, cancelable = true) {
    super("wheel", { cancelable });
    Object.assign(this, options);
  }
}

const cleanups: Array<() => void> = [];
const frames = new Map<number, FrameRequestCallback>();
let now = 0;
let nextFrame = 0;

function advanceFrames(duration = 600) {
  for (let elapsed = 0; elapsed < duration; elapsed += 16) {
    now += 16;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  frames.clear();
  now = 0;
  nextFrame = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLElement", ScrollElement);
  vi.stubGlobal("WheelEvent", Wheel);
  vi.stubGlobal("getComputedStyle", (element: ScrollElement) => ({
    overflowY: element.overflowY,
    overscrollBehaviorY: element.overscrollBehaviorY,
  }));
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount() {
  const element = new ScrollElement();
  cleanups.push(installWheelScroll(element as unknown as HTMLElement));
  return element;
}

function dispatchWheel(root: ScrollElement, target: ScrollElement, options: Partial<Wheel> = {}) {
  const wheel = new Wheel(options);
  Object.defineProperty(wheel, "target", { value: target });
  root.dispatchEvent(wheel);
  return wheel;
}

describe("PC wheel scrolling with short continuous smoothing", () => {
  it.each([120, 480, -120])("smooths the full %ipx distance without gain or truncation", deltaY => {
    const element = mount();
    element.scrollTop = 1000;
    const wheel = dispatchWheel(element, element, { deltaY });
    expect(wheel.defaultPrevented).toBe(true);
    expect(element.scrollTop).toBe(1000);
    advanceFrames(16);
    expect(Math.abs(element.scrollTop - 1000)).toBeGreaterThan(0);
    expect(Math.abs(element.scrollTop - 1000)).toBeLessThan(Math.abs(deltaY));
    advanceFrames();
    expect(element.scrollTop).toBe(1000 + deltaY);
    expect(frames.size).toBe(0);
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it.each([8, 40, -8])("leaves %ipx precision trackpad gestures native", deltaY => {
    const element = mount();
    expect(dispatchWheel(element, element, { deltaY }).defaultPrevented).toBe(false);
    expect(element.scrollTo).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each([
    [Wheel.DOM_DELTA_LINE, 3, 54],
    [Wheel.DOM_DELTA_PAGE, 1, 900],
  ])("preserves the full normalized deltaMode %i distance", (deltaMode, deltaY, distance) => {
    const element = mount();
    dispatchWheel(element, element, { deltaMode, deltaY });
    advanceFrames();
    expect(element.scrollTop).toBe(distance);
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it("accumulates bursts in one running animation rather than restarting it", () => {
    const element = mount();
    element.scrollTop = 1000;
    dispatchWheel(element, element);
    advanceFrames(16);
    const running = [...frames.keys()];
    dispatchWheel(element, element);
    dispatchWheel(element, element);
    expect([...frames.keys()]).toEqual(running);
    advanceFrames();
    expect(element.scrollTop).toBe(1360);
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it("starts gently and decelerates briefly rather than jumping or coasting", () => {
    const element = mount();
    dispatchWheel(element, element);
    advanceFrames(16);
    const firstStep = element.scrollTop;
    expect(firstStep).toBeGreaterThan(20);
    expect(firstStep).toBeLessThan(30);
    advanceFrames(16);
    expect(element.scrollTop - firstStep).toBeLessThan(firstStep);
    advanceFrames(480);
    expect(element.scrollTop).toBe(120);
    expect(frames.size).toBe(0);
  });

  it("reverses on the next frame without dragging the old destination along", () => {
    const element = mount();
    element.scrollTop = 1000;
    dispatchWheel(element, element, { deltaY: 480 });
    advanceFrames(32);
    const before = element.scrollTop;
    dispatchWheel(element, element, { deltaY: -120 });
    advanceFrames(16);
    expect(element.scrollTop).toBeLessThan(before);
    advanceFrames();
    expect(element.scrollTop).toBeCloseTo(before - 120);
  });

  it("scrolls the nearest nested container, not the background", () => {
    const root = mount();
    const child = new ScrollElement();
    child.parentElement = root;
    dispatchWheel(root, child);
    advanceFrames();
    expect(child.scrollTop).toBe(120);
    expect(root.scrollTo).not.toHaveBeenCalled();
  });

  it.each(["contain", "none"])("respects overscroll-behavior: %s at a nested boundary", overscrollBehavior => {
    const root = mount();
    const child = new ScrollElement();
    child.parentElement = root;
    child.scrollTop = 4100;
    child.overscrollBehaviorY = overscrollBehavior;
    const wheel = dispatchWheel(root, child);
    expect(wheel.defaultPrevented).toBe(false);
    expect(root.scrollTo).not.toHaveBeenCalled();
    expect(child.scrollTo).not.toHaveBeenCalled();
  });

  it("allows normal chaining when a nested container is at its boundary", () => {
    const root = mount();
    const child = new ScrollElement();
    child.parentElement = root;
    child.scrollTop = 4100;
    dispatchWheel(root, child);
    advanceFrames();
    expect(root.scrollTop).toBe(120);
    expect(child.scrollTo).not.toHaveBeenCalled();
  });

  it("clamps to both edges without queuing extra distance", () => {
    const element = mount();
    element.scrollTop = 4000;
    dispatchWheel(element, element, { deltaY: 480 });
    advanceFrames();
    expect(element.scrollTop).toBe(4100);
    expect(dispatchWheel(element, element).defaultPrevented).toBe(false);
    dispatchWheel(element, element, { deltaY: -4800 });
    advanceFrames();
    expect(element.scrollTop).toBe(0);
    dispatchWheel(element, element, { deltaY: 120 });
    advanceFrames();
    expect(element.scrollTop).toBe(120);
  });

  it("does not capture zoom, horizontal, shift, non-cancelable or opted-out gestures", () => {
    const element = mount();
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaX: 240 }, { deltaY: 0 }]) {
      expect(dispatchWheel(element, element, options).defaultPrevented).toBe(false);
    }
    element.dispatchEvent(new Wheel({}, false));
    element.optOut = true;
    dispatchWheel(element, element);
    expect(element.scrollTo).not.toHaveBeenCalled();
    expect(gsap.killTweensOf).not.toHaveBeenCalled();
  });

  it("does not handle the same event twice in nested installations", () => {
    const element = mount();
    const wheel = new Wheel();
    wheel.preventDefault();
    element.dispatchEvent(wheel);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("interrupts only vertical programmatic motion when the user scrolls", () => {
    const element = mount();
    dispatchWheel(element, element);
    expect(gsap.killTweensOf).toHaveBeenCalledWith(element, "scrollTop");
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it("leaves hidden/static containers alone", () => {
    const element = mount();
    element.overflowY = "hidden";
    expect(dispatchWheel(element, element).defaultPrevented).toBe(false);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("cancels pending frames and removes its listeners on cleanup", () => {
    const element = mount();
    dispatchWheel(element, element);
    expect(frames.size).toBe(1);
    cleanups.pop()!();
    expect(frames.size).toBe(0);
    dispatchWheel(element, element);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it.each(["pointerdown", "keydown", "explicit", "trackpad"])("stops smoothing on %s input", kind => {
    const element = mount();
    dispatchWheel(element, element);
    advanceFrames(32);
    const position = element.scrollTop;
    if (kind === "pointerdown") element.dispatchEvent(new Event("pointerdown"));
    if (kind === "keydown") {
      const key = new Event("keydown");
      Object.defineProperty(key, "key", { value: "ArrowDown" });
      window.dispatchEvent(key);
    }
    if (kind === "explicit") stopInertialScroll(element as unknown as HTMLElement);
    if (kind === "trackpad") expect(dispatchWheel(element, element, { deltaY: 8 }).defaultPrevented).toBe(false);
    advanceFrames();
    expect(element.scrollTop).toBe(position);
    expect(frames.size).toBe(0);
  });

  it.each(["ArrowDown", "PageUp", "a"])("leaves %s keyboard/gamepad navigation unchanged", key => {
    mount();
    const event = new Event("keydown");
    Object.defineProperty(event, "key", { value: key });
    window.dispatchEvent(event);
    expect(gsap.killTweensOf).not.toHaveBeenCalled();
  });

  it("remains instant with reduced motion enabled", () => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), { matchMedia: () => ({ matches: true }) }));
    const element = mount();
    dispatchWheel(element, element);
    expect(element.scrollTop).toBe(120);
    expect(element.scrollTo).toHaveBeenCalledWith({ top: 120, behavior: "instant" });
    expect(gsap.to).not.toHaveBeenCalled();
  });
});

describe("shared GSAP row scrolling", () => {
  it("preserves the existing tween for navigation controls", () => {
    const element = new ScrollElement();
    element.scrollTop = 120;
    scrollByGsap(element as unknown as HTMLElement, 48, 0.48, "vertical");
    expect(gsap.to).toHaveBeenCalledWith(element, {
      scrollTop: 168, duration: 0.48, ease: "power3.out", overwrite: "auto",
    });
    expect(() => stopInertialScroll(null)).not.toThrow();
  });
});

function mountTv() {
  const element = new ScrollElement();
  element.scrollTo.mockImplementation(() => {});
  cleanups.push(installInertialScroll(element as unknown as HTMLElement, { compositor: true }));
  return element;
}

describe("existing TV wheel behavior stays unchanged", () => {
  it("accumulates bursts on the compositor without GSAP tweens", () => {
    const element = mountTv();
    const wheel = dispatchWheel(element, element);
    expect(wheel.defaultPrevented).toBe(true);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 160.8, behavior: "smooth" });
    dispatchWheel(element, element);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 321.6, behavior: "smooth" });
    expect(gsap.to).not.toHaveBeenCalled();
  });

  it("preserves nested TV routing", () => {
    const element = mountTv();
    const child = new ScrollElement();
    child.parentElement = element;
    dispatchWheel(element, child);
    expect(child.scrollTo).toHaveBeenCalledWith({ top: 160.8, behavior: "smooth" });
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("ignores zoom, horizontal, shift and opted-out gestures", () => {
    const element = mountTv();
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaX: 240 }, { deltaY: 0 }]) {
      expect(dispatchWheel(element, element, options).defaultPrevented).toBe(false);
    }
    element.optOut = true;
    dispatchWheel(element, element);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("preserves the end boundary", () => {
    const element = mountTv();
    element.scrollTop = 4000;
    dispatchWheel(element, element);
    expect(element.scrollTo).toHaveBeenCalledWith({ top: 4100, behavior: "smooth" });
    element.scrollTop = 4100;
    expect(dispatchWheel(element, element).defaultPrevented).toBe(false);
    expect(element.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("cancels pending motion on pointer/scrollbar interaction", () => {
    const element = mountTv();
    dispatchWheel(element, element);
    element.scrollTop = 50;
    element.dispatchEvent(new Event("pointerdown"));
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 50, behavior: "instant" });
    dispatchWheel(element, element);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 210.8, behavior: "smooth" });
  });

  it("clears the pending target on scrollend", () => {
    const element = mountTv();
    dispatchWheel(element, element);
    element.scrollTop = 160.8;
    element.dispatchEvent(new Event("scrollend"));
    element.scrollTop = 50;
    dispatchWheel(element, element);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 210.8, behavior: "smooth" });
  });

  it("preserves navigation key cancellation and removes listeners on cleanup", () => {
    const element = mountTv();
    dispatchWheel(element, element);
    const key = new Event("keydown");
    Object.defineProperty(key, "key", { value: "ArrowDown" });
    window.dispatchEvent(key);
    expect(element.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "instant" });
    cleanups.pop()!();
    element.scrollTo.mockClear();
    dispatchWheel(element, element);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });

  it("keeps reduced-motion gestures native", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const element = mountTv();
    expect(dispatchWheel(element, element).defaultPrevented).toBe(false);
    expect(element.scrollTo).not.toHaveBeenCalled();
  });
});
