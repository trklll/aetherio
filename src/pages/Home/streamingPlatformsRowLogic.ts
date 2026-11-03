export const STREAMING_PLATFORM_CARD_WIDTH = 425;
export const STREAMING_PLATFORM_CARD_GAP = 28;

const ARROW_EDGE_THRESHOLD = 10;
const CARDS_PER_SCROLL = 3;

interface HorizontalScrollMetrics {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

export function getStreamingPlatformArrowState(metrics: HorizontalScrollMetrics | null) {
  if (!metrics) return { showLeft: false, showRight: false };

  return {
    showLeft: metrics.scrollLeft > ARROW_EDGE_THRESHOLD,
    showRight: metrics.scrollLeft < metrics.scrollWidth - metrics.clientWidth - ARROW_EDGE_THRESHOLD,
  };
}

export function getStreamingPlatformScrollDelta(direction: "left" | "right") {
  const distance = (STREAMING_PLATFORM_CARD_WIDTH + STREAMING_PLATFORM_CARD_GAP) * CARDS_PER_SCROLL;
  return direction === "right" ? distance : -distance;
}
