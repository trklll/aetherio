import { describe, expect, it } from "vitest";
import { sportsFlagPalette } from "./sportsFlagPalette";

describe("sportsFlagPalette", () => {
  it("separates two blue crests into the reference's azure and indigo", () => {
    expect(sportsFlagPalette("#0067B1", "#0067B1")).toEqual({
      home: "hsl(199 88% 38%)", away: "hsl(242 58% 34%)",
    });
  });

  it("preserves distinct team hues rather than painting every match blue", () => {
    expect(sportsFlagPalette("#cc0000", "#008800")).toEqual({
      home: "hsl(0 88% 38%)", away: "hsl(120 58% 34%)",
    });
  });

  it("keeps monochrome and invalid crests neutral", () => {
    expect(sportsFlagPalette("#45494F", "bad")).toEqual({
      home: "hsl(210 8% 27%)", away: "hsl(220 8% 23%)",
    });
    expect(sportsFlagPalette("#ffffff", "#000000")).toEqual(sportsFlagPalette("", ""));
  });

  it("accepts lowercase colors and keeps separated blue hues distinct", () => {
    expect(sportsFlagPalette("#0067b1", "#0067b1")).toEqual(sportsFlagPalette("#0067B1", "#0067B1"));
    expect(sportsFlagPalette("#0000ff", "#00ffff").away).toBe("hsl(180 58% 34%)");
  });

  it("continues a verified blue across the field when the other crest cannot be sampled", () => {
    expect(sportsFlagPalette("#45494F", "#0067B1")).toEqual(sportsFlagPalette("#0067B1", "#0067B1"));
  });

  it("bounds luminous yellow and green so white foregrounds remain readable", () => {
    for (const color of ["#ffff00", "#00ff00", "#00ffff", "#ff00ff"]) {
      const value = sportsFlagPalette(color, color).home.match(/hsl\((\d+) (\d+)% (\d+)%\)/)!;
      const [h, s, l] = [Number(value[1]), Number(value[2]) / 100, Number(value[3]) / 100];
      const channels = [0, 8, 4].map(offset => {
        const k = (offset + h / 30) % 12;
        const channel = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      expect(channels.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0)).toBeLessThanOrEqual(.19);
    }
  });
});
