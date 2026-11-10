import { describe, expect, it } from "vitest";
import {
  VIDEO_ENHANCEMENT_DISABLED,
  VIDEO_ENHANCEMENT_OPTIONS,
  readVideoEnhancementProfile,
  normalizeVideoEnhancementProfile,
  saveVideoEnhancementProfile,
} from "./videoEnhancements";

function installStorage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

describe("video enhancement profiles", () => {
  it("exposes a valid profile for every menu option", () => {
    expect(VIDEO_ENHANCEMENT_OPTIONS.length).toBeGreaterThan(1);
    for (const option of VIDEO_ENHANCEMENT_OPTIONS) {
      expect(option.value).toMatch(/^(off|fast:|hq:|fsr:|vsr:|scaler:|deband:)/);
      expect(option.label).not.toHaveLength(0);
      expect(option.description).not.toHaveLength(0);
    }
  });

  it("rejects stale or unsupported saved profiles", () => {
    installStorage();
    localStorage.setItem("aetherio-player-video-enhancement", "missing:profile");
    expect(readVideoEnhancementProfile()).toBe(VIDEO_ENHANCEMENT_DISABLED);
    expect(saveVideoEnhancementProfile("missing:profile")).toBe(VIDEO_ENHANCEMENT_DISABLED);
  });

  it("round-trips every supported profile", () => {
    installStorage();
    for (const option of VIDEO_ENHANCEMENT_OPTIONS) {
      expect(saveVideoEnhancementProfile(option.value)).toBe(option.value);
      expect(readVideoEnhancementProfile()).toBe(option.value);
    }
  });

  it("does not expose duplicate fast/HQ entries for single Anime4K CNN shaders", () => {
    const standalone = VIDEO_ENHANCEMENT_OPTIONS.filter(option =>
      /cnn-2x|denoise-cnn-2x/.test(option.value),
    );
    expect(standalone.map(option => option.value)).toEqual([
      "fast:cnn-2x-medium",
      "fast:cnn-2x-very-large",
      "fast:denoise-cnn-2x-very-large",
      "fast:cnn-2x-ultra-large",
    ]);
    expect(standalone.every(option => !/Rápido|Alta calidad/.test(option.label))).toBe(true);
  });

  it("migrates legacy standalone HQ aliases to their single canonical profile", () => {
    expect(normalizeVideoEnhancementProfile("hq:cnn-2x-medium")).toBe("fast:cnn-2x-medium");
    expect(normalizeVideoEnhancementProfile("hq:cnn-2x-very-large")).toBe("fast:cnn-2x-very-large");
    expect(normalizeVideoEnhancementProfile("hq:denoise-cnn-2x-very-large")).toBe("fast:denoise-cnn-2x-very-large");
    expect(normalizeVideoEnhancementProfile("hq:cnn-2x-ultra-large")).toBe("fast:cnn-2x-ultra-large");
    installStorage();
    localStorage.setItem("aetherio-player-video-enhancement", "hq:cnn-2x-medium");
    expect(readVideoEnhancementProfile()).toBe("fast:cnn-2x-medium");
  });
});
