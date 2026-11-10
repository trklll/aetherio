export function getRelativeSeekTarget(currentTime: number, duration: number, offset: number): number {
  const current = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const delta = Number.isFinite(offset) ? offset : 0;
  const target = Math.max(0, current + delta);

  return Number.isFinite(duration) && duration > 0
    ? Math.min(duration, target)
    : target;
}
