export type OnboardingDirection = "left" | "right" | "up" | "down";

export interface OnboardingFocusItem {
  id: string;
  group: string;
  left: number;
  top: number;
  width: number;
}

/** Navigate actual visual rows, never wrap horizontally or jump diagonally.
 * Group order comes from the DOM, independent of the viewport's scroll offset.
 */
export function findOnboardingNeighbor<T extends OnboardingFocusItem>(
  items: readonly T[],
  current: T,
  direction: OnboardingDirection,
  preferredX = current.left + current.width / 2,
): T | undefined {
  const group = items.filter(item => item.group === current.group);
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "right" || direction === "down";
  const sameRow = (item: T) => Math.abs(item.top - current.top) < 4;
  if (horizontal) {
    return group.filter(item => item.id !== current.id && sameRow(item)
      && (forward ? item.left > current.left : item.left < current.left))
      .sort((a, b) => Math.abs(a.left - current.left) - Math.abs(b.left - current.left))[0];
  }

  let candidates = group.filter(item => !sameRow(item)
    && (forward ? item.top > current.top : item.top < current.top));
  if (!candidates.length) {
    const groups = [...new Set(items.map(item => item.group))];
    const nextGroup = groups[groups.indexOf(current.group) + (forward ? 1 : -1)];
    candidates = items.filter(item => item.group === nextGroup);
  }
  if (!candidates.length) return undefined;
  const rowTop = forward
    ? Math.min(...candidates.map(item => item.top))
    : Math.max(...candidates.map(item => item.top));
  return candidates.filter(item => Math.abs(item.top - rowTop) < 4)
    .sort((a, b) => Math.abs(a.left + a.width / 2 - preferredX)
      - Math.abs(b.left + b.width / 2 - preferredX))[0];
}
