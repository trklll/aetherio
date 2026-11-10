export interface TmdbCardImageResponsiveProps {
  fallbackSrc: string;
  srcSet: string;
  sizes: string;
}

const IMAGE_HOST = "image.tmdb.org";
const ORIGINAL_IMAGE_PATH = /^\/t\/p\/original\/(.+)$/;

const HORIZONTAL_CARD_SIZES = [
  [500, "w500"],
  [780, "w780"],
  [1280, "w1280"],
  [1920, "w1920"],
  [3840, "original"],
] as const;

const VERTICAL_CARD_SIZES = [
  [342, "w342"],
  [500, "w500"],
  [780, "w780"],
  [3840, "original"],
] as const;

/**
 * Choose a TMDB thumbnail set for a Home card while retaining the original URL
 * in media metadata used by Detail/preview screens. The img fallback is the
 * smallest suitable variant; the original remains a srcSet candidate for high-
 * density displays. Width descriptors let Chromium pick pixels for the card's
 * CSS width and display density instead of always decoding a full-size image.
 */
export function getTmdbCardImageResponsiveProps(
  source: string | undefined,
  displayWidth: number,
): TmdbCardImageResponsiveProps | undefined {
  if (!source || !Number.isFinite(displayWidth) || displayWidth <= 0) return undefined;

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return undefined;
  }

  if (url.hostname.toLowerCase() !== IMAGE_HOST) return undefined;
  const originalPath = url.pathname.match(ORIGINAL_IMAGE_PATH);
  if (!originalPath) return undefined;

  const sizes = displayWidth < 300 ? VERTICAL_CARD_SIZES : HORIZONTAL_CARD_SIZES;
  const fallbackSize = sizes.find(([width]) => width >= displayWidth) ?? sizes[sizes.length - 1];
  const fallback = new URL(url);
  fallback.pathname = `/t/p/${fallbackSize[1]}/${originalPath[1]}`;
  const srcSet = sizes.map(([width, size]) => {
    const variant = new URL(url);
    variant.pathname = `/t/p/${size}/${originalPath[1]}`;
    return `${variant.href} ${width}w`;
  }).join(", ");

  return {
    fallbackSrc: fallback.href,
    srcSet,
    sizes: `${Math.ceil(displayWidth)}px`,
  };
}
