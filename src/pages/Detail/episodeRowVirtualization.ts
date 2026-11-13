export interface EpisodeVirtualRange {
  start: number;
  end: number;
}

export function getEpisodeVirtualCenterIndex(
  scrollLeft: number,
  viewportWidth: number,
  itemCount: number,
  itemStride: number,
  leftInset = 0,
) {
  const count = Math.max(0, Math.floor(Number.isFinite(itemCount) ? itemCount : 0));
  if (count === 0) return -1;

  const stride = Number.isFinite(itemStride) && itemStride > 0 ? itemStride : 1;
  const left = Math.max(0, Number.isFinite(scrollLeft) ? scrollLeft : 0);
  const width = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0);
  const inset = Math.max(0, Number.isFinite(leftInset) ? leftInset : 0);
  const centerIndex = Math.floor((left + width / 2 - inset) / stride);

  return Math.max(0, Math.min(count - 1, centerIndex));
}

export function getEpisodeVirtualRange(
  scrollLeft: number,
  viewportWidth: number,
  itemCount: number,
  itemStride: number,
  overscan = 3,
): EpisodeVirtualRange {
  const count = Math.max(0, Math.floor(Number.isFinite(itemCount) ? itemCount : 0));
  if (count === 0) return { start: 0, end: 0 };

  const stride = Number.isFinite(itemStride) && itemStride > 0 ? itemStride : 1;
  const left = Math.max(0, Number.isFinite(scrollLeft) ? scrollLeft : 0);
  const width = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0);
  const buffer = Math.max(0, Math.floor(Number.isFinite(overscan) ? overscan : 0));
  const firstVisible = Math.min(count - 1, Math.floor(left / stride));
  const lastVisible = Math.min(count, Math.max(firstVisible + 1, Math.ceil((left + width) / stride)));

  return {
    start: Math.max(0, firstVisible - buffer),
    end: Math.min(count, lastVisible + buffer),
  };
}
