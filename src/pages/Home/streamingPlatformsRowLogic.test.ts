import { describe, expect, it } from "vitest";
import {
  getStreamingPlatformArrowState,
  getStreamingPlatformScrollDelta,
} from "./streamingPlatformsRowLogic";

describe("streaming platform row navigation", () => {
  it("hides arrows when the scroller has no measurable overflow", () => {
    expect(getStreamingPlatformArrowState(null)).toEqual({ showLeft: false, showRight: false });
    expect(getStreamingPlatformArrowState({ scrollLeft: 0, scrollWidth: 900, clientWidth: 900 }))
      .toEqual({ showLeft: false, showRight: false });
  });

  it("shows arrows only in directions with more content", () => {
    const metrics = { scrollWidth: 2_700, clientWidth: 1_000 };

    expect(getStreamingPlatformArrowState({ ...metrics, scrollLeft: 0 }))
      .toEqual({ showLeft: false, showRight: true });
    expect(getStreamingPlatformArrowState({ ...metrics, scrollLeft: 800 }))
      .toEqual({ showLeft: true, showRight: true });
    expect(getStreamingPlatformArrowState({ ...metrics, scrollLeft: 1_700 }))
      .toEqual({ showLeft: true, showRight: false });
  });

  it("scrolls by three cards in the requested direction", () => {
    expect(getStreamingPlatformScrollDelta("right")).toBe(1_359);
    expect(getStreamingPlatformScrollDelta("left")).toBe(-1_359);
  });
});
