const NEUTRAL_CREST_COLOR = "#45494F";

export interface CrestImageSample {
  color: string;
  pixels: ArrayLike<number>;
  width: number;
  height: number;
  scale: number;
}

/** Extracts the most common chromatic tones from RGBA pixels, ignoring outlines and transparency. */
export function extractCrestColors(pixels: ArrayLike<number>, limit = 3): string[] {
  const bins = new Map<number, number>();
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 96) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const high = Math.max(red, green, blue);
    const low = Math.min(red, green, blue);
    // Black/white/gray crests should remain neutral, never acquire a guessed hue.
    if (high - low < 28 || high < 38 || high > 238) continue;
    const key = ((red >> 5) << 6) | ((green >> 5) << 3) | (blue >> 5);
    bins.set(key, (bins.get(key) ?? 0) + alpha);
  }

  const colors: string[] = [];
  const colorChannels: number[][] = [];
  const minimumDistanceSquared = 64 ** 2;
  for (const [key] of [...bins].sort(([, a], [, b]) => b - a)) {
    const channels = [(key >> 6) & 7, (key >> 3) & 7, key & 7]
      .map(channel => Math.min(255, channel * 32 + 16));
    if (colorChannels.some(existing => existing.reduce((sum, value, index) => sum + (value - channels[index]) ** 2, 0) < minimumDistanceSquared)) continue;
    colors.push(`#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`);
    colorChannels.push(channels);
    if (colors.length >= Math.max(1, Math.floor(limit))) break;
  }
  return colors.length ? colors : [NEUTRAL_CREST_COLOR];
}

export function extractCrestColor(pixels: ArrayLike<number>): string {
  return extractCrestColors(pixels, 1)[0] ?? NEUTRAL_CREST_COLOR;
}

/** Read a crest at the same bounded, aspect-preserving resolution used by Home cards. */
export function sampleCrestImage(image: HTMLImageElement): CrestImageSample | undefined {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (!naturalWidth || !naturalHeight) return undefined;

  const scale = Math.min(1, 256 / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return { color: extractCrestColor(pixels), pixels, width, height, scale };
  } catch {
    // Remote crests without CORS permission keep their verified team color.
    return undefined;
  }
}

export { NEUTRAL_CREST_COLOR };
