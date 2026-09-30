import { getTmdbImageProxyUrl } from "../../config/apiKeys.ts";

export interface ImageLightness {
  average: number;
  brightPixelRatio: number;
}

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;
const SAMPLE_TIMEOUT_MS = 1500;

export function shouldUseDarkPlayerText(lightness: ImageLightness | null): boolean {
  if (!lightness) return false;
  return lightness.average >= 0.72 || lightness.brightPixelRatio >= 0.62;
}

export function sampleImageLightness(imageUrl: string): Promise<ImageLightness | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: ImageLightness | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), SAMPLE_TIMEOUT_MS);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      window.clearTimeout(timer);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_WIDTH;
        canvas.height = SAMPLE_HEIGHT;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          finish(null);
          return;
        }

        context.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const pixels = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
        let total = 0;
        let bright = 0;
        let count = 0;

        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 128) continue;
          const luminance = (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255;
          total += luminance;
          if (luminance >= 0.78) bright += 1;
          count += 1;
        }

        finish(count > 0 ? { average: total / count, brightPixelRatio: bright / count } : null);
      } catch {
        finish(null);
      }
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    image.src = getTmdbImageProxyUrl(imageUrl) ?? imageUrl;
  });
}
