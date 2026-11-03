import { describe, expect, it } from "vitest";
import { appendBackdropLayer, settleBackdropLayers } from "./backdropLayers";

describe("backdrop transition layers", () => {
  it("retains the visible transition when a second selection arrives mid-fade", () => {
    const first = { id: 1, url: "first.jpg", initialOpacity: 1 as const };
    const second = { id: 2, url: "second.jpg", initialOpacity: 0 as const };
    const third = { id: 3, url: "third.jpg", initialOpacity: 0 as const };
    const duringFirstFade = appendBackdropLayer([first], second);

    expect(appendBackdropLayer(duringFirstFade, third)).toEqual([first, second, third]);
  });

  it("settles to the latest layer after its crossfade completes", () => {
    const layers = [
      { id: 1, url: "first.jpg", initialOpacity: 1 as const },
      { id: 2, url: "second.jpg", initialOpacity: 0 as const },
    ];

    expect(settleBackdropLayers(layers, 2)).toEqual([{
      ...layers[1],
      initialOpacity: 1,
    }]);
  });

  it("does not append a duplicate target", () => {
    const layers = [{ id: 1, url: "same.jpg", initialOpacity: 1 as const }];

    expect(appendBackdropLayer(layers, { id: 2, url: "same.jpg", initialOpacity: 0 })).toBe(layers);
  });
});
