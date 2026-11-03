import { afterEach, describe, expect, it } from "vitest";
import { clearHomeScroll, getHomeScroll, saveHomeScroll } from "./homeScrollStore";

describe("home scroll return snapshot", () => {
  afterEach(() => clearHomeScroll());

  it("keeps vertical and row offsets with the exact streaming source card", () => {
    saveHomeScroll({
      vertical: 720,
      rows: { "streaming-platforms": 280 },
      focus: { rowKey: "streaming-platforms", itemIndex: 4, platformId: "disney-plus" },
    });

    expect(getHomeScroll()).toMatchObject({
      vertical: 720,
      rows: { "streaming-platforms": 280 },
      focus: { rowKey: "streaming-platforms", itemIndex: 4, platformId: "disney-plus" },
    });
  });

  it("clears the pending focus without discarding the saved scroll position", () => {
    saveHomeScroll({
      vertical: 720,
      rows: { "streaming-platforms": 280 },
      focus: { rowKey: "streaming-platforms", itemIndex: 4, platformId: "disney-plus" },
    });
    saveHomeScroll({ focus: null });

    expect(getHomeScroll()).toMatchObject({
      vertical: 720,
      rows: { "streaming-platforms": 280 },
      focus: null,
    });
  });
});
