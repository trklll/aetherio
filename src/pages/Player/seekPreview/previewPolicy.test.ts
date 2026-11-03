import { describe, expect, it } from "vitest";
import {
  clampPreviewTime,
  getAdaptivePreviewPlan,
  getPreviewCacheSlotMs,
  getPreviewRequestTimeSeconds,
} from "./previewPolicy";

describe("política de previews de búsqueda", () => {
  it("limita el destino a la duración conocida", () => {
    expect(clampPreviewTime(-4, 120)).toBe(0);
    expect(clampPreviewTime(145, 120)).toBe(120);
    expect(clampPreviewTime(Number.NaN, 120)).toBe(0);
  });

  it("agrupa el timeline en zonas de cinco segundos", () => {
    expect(getPreviewCacheSlotMs(30)).toBe(30_000);
    expect(getPreviewCacheSlotMs(34.99)).toBe(30_000);
    expect(getPreviewCacheSlotMs(35)).toBe(35_000);
  });

  it("pide el inicio de la zona y mantiene el último slot dentro de la duración", () => {
    expect(getPreviewRequestTimeSeconds(34.99)).toBe(30);
    expect(getPreviewRequestTimeSeconds(60, 60)).toBe(55);
  });

  it("permite cobertura amplia solo para archivos pequeños conocidos", () => {
    expect(getAdaptivePreviewPlan(5_000_000_000, false)).toEqual({
      strideSeconds: 5,
      allowWholeFile: true,
      maximumAheadSeconds: 0,
    });
    expect(getAdaptivePreviewPlan(20_000_000_000, false)).toEqual({
      strideSeconds: 20,
      allowWholeFile: false,
      maximumAheadSeconds: 60,
    });
    expect(getAdaptivePreviewPlan(null, false)).toEqual({
      strideSeconds: 15,
      allowWholeFile: false,
      maximumAheadSeconds: 60,
    });
  });

  it("desactiva anticipación para streams en directo", () => {
    expect(getAdaptivePreviewPlan(1_000_000_000, true)).toEqual({
      strideSeconds: 0,
      allowWholeFile: false,
      maximumAheadSeconds: 0,
    });
  });
});
