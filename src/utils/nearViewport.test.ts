import { afterEach, describe, expect, it, vi } from "vitest";
import { observeNearViewport } from "./nearViewport";

afterEach(() => vi.unstubAllGlobals());

describe("shared artwork visibility observer", () => {
  function setup() {
    let notify: IntersectionObserverCallback;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    const construct = vi.fn();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
        notify = callback;
        construct(options);
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    });
    return {
      observe, unobserve, disconnect, construct,
      emit: (target: Element, isIntersecting: boolean) => notify([
        { target, isIntersecting } as IntersectionObserverEntry,
      ], {} as IntersectionObserver),
    };
  }

  it("shares one observer and only admits intersecting artwork once", () => {
    const observer = setup();
    const first = {} as Element;
    const second = {} as Element;
    const loadFirst = vi.fn();
    const loadSecond = vi.fn();
    const stopFirst = observeNearViewport(first, loadFirst);
    const stopSecond = observeNearViewport(second, loadSecond);
    expect(observer.construct).toHaveBeenCalledTimes(1);
    expect(observer.construct).toHaveBeenCalledWith(expect.objectContaining({ rootMargin: "400px" }));
    expect(loadFirst).not.toHaveBeenCalled();
    observer.emit(first, false);
    expect(loadFirst).not.toHaveBeenCalled();
    observer.emit(first, true);
    observer.emit(first, true);
    expect(loadFirst).toHaveBeenCalledTimes(1);
    expect(loadSecond).not.toHaveBeenCalled();
    stopFirst();
    stopSecond();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes unmounted cards and releases the observer", () => {
    const observer = setup();
    const target = {} as Element;
    const load = vi.fn();
    const stop = observeNearViewport(target, load);
    stop();
    observer.emit(target, true);
    expect(load).not.toHaveBeenCalled();
    expect(observer.unobserve).toHaveBeenCalledWith(target);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it("supports independent subscribers on the same element", () => {
    const observer = setup();
    const target = {} as Element;
    const cancelled = vi.fn();
    const load = vi.fn();
    const stop = observeNearViewport(target, cancelled);
    const stopOther = observeNearViewport(target, load);
    stop();
    expect(observer.unobserve).not.toHaveBeenCalled();
    observer.emit(target, true);
    expect(cancelled).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledOnce();
    stopOther();
  });

  it("loads normally when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const load = vi.fn();
    expect(() => observeNearViewport({} as Element, load)()).not.toThrow();
    expect(load).toHaveBeenCalledOnce();
  });
});
