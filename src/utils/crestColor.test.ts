import { afterEach, describe, expect, it, vi } from "vitest";
import { extractCrestColor, extractCrestColors, NEUTRAL_CREST_COLOR, sampleCrestImage } from "./crestColor.ts";

afterEach(() => vi.unstubAllGlobals());

describe("extractCrestColor", () => {
  it("keeps a monochrome crest neutral instead of inventing a hue", () => {
    expect(extractCrestColor(new Uint8ClampedArray([
      255, 255, 255, 255,
      20, 20, 20, 255,
      120, 120, 120, 255,
    ]))).toBe(NEUTRAL_CREST_COLOR);
  });

  it("returns the dominant chromatic color and ignores transparent pixels", () => {
    expect(extractCrestColor(new Uint8ClampedArray([
      210, 30, 30, 255,
      205, 35, 35, 255,
      0, 255, 0, 0,
    ]))).toBe("#D01010");
  });

  it("returns the first distinct dominant colors for a crest gradient", () => {
    expect(extractCrestColors(new Uint8ClampedArray([
      210, 30, 30, 255,
      205, 35, 35, 255,
      20, 50, 210, 255,
    ]), 2)).toEqual(["#D01010", "#1030D0"]);
  });

  it("samples a crest at the same bounded aspect ratio as Home cards", () => {
    const pixels = new Uint8ClampedArray([210, 30, 30, 255]);
    const context = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels })),
    };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    const image = { naturalWidth: 512, naturalHeight: 256 } as HTMLImageElement;

    const sample = sampleCrestImage(image);

    expect(sample?.color).toBe("#D01010");
    expect(sample).toMatchObject({ width: 256, height: 128, scale: 0.5 });
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 256, 128);
  });

  it("keeps the known fallback when an image cannot be read", () => {
    const context = { drawImage: vi.fn(() => { throw new Error("tainted canvas"); }), getImageData: vi.fn() };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });

    expect(sampleCrestImage({ naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement)).toBeUndefined();
  });
});
