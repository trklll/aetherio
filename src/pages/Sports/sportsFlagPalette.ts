/** Lift crest hues into the phone reference's luminous cloth, without whitening the background. */
export function sportsFlagPalette(home: string, away: string): { home: string; away: string } {
  const hue = (color: string): number | null => {
    if (!/^#[\da-f]{6}$/i.test(color)) return null;
    const [red, green, blue] = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    const delta = high - low;
    if (delta < .12) return null;
    const sector = high === red ? (green - blue) / delta : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    return (sector * 60 + 360) % 360;
  };
  const tone = (value: number, saturation: number, lightness: number) => {
    const h = Math.round(value);
    let light = lightness;
    // Equal HSL lightness is much brighter for yellow/green than for blue.
    // Bound actual sRGB luminance rather than letting those fixtures wash out text.
    while (light > 16) {
      const l = light / 100;
      const channels = [0, 8, 4].map(offset => {
        const k = (offset + h / 30) % 12;
        const channel = l - saturation / 100 * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      if (channels.reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0) <= .19) break;
      light -= 1;
    }
    return `hsl(${h} ${saturation}% ${light}%)`;
  };
  let left = hue(home);
  let right = hue(away);
  const blue = (value: number) => value >= 190 && value <= 250;
  // A missing/CORS-blocked sample may use the other side's verified blue light.
  // Explicit monochrome crests still stay neutral, never acquire an invented team color.
  const unavailable = (color: string) => color.toLowerCase() === "#45494f" || !/^#[\da-f]{6}$/i.test(color);
  if (left === null && unavailable(home) && right !== null && blue(right)) left = right;
  if (right === null && unavailable(away) && left !== null && blue(left)) right = left;
  // Similar blue insignia still need the reference's azure → indigo separation.
  const relatedBlues = left !== null && right !== null && blue(left) && blue(right) && Math.abs(left - right) < 42;
  return {
    home: left === null ? "hsl(210 8% 27%)" : tone(left - (blue(left) ? 6 : 0), 88, 38),
    away: right === null ? "hsl(220 8% 23%)" : tone((right + (relatedBlues ? 37 : 0)) % 360, 58, 34),
  };
}
