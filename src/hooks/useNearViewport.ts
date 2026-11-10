import { useEffect, useState, type RefObject } from "react";
import { observeNearViewport } from "../utils/nearViewport";

/** Admit once: scrolling away must not clear images or reset their fallback. */
export function useNearViewport<T extends Element>(ref: RefObject<T | null>, enabled = true): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled || visible || !ref.current) return;
    return observeNearViewport(ref.current, () => setVisible(true));
  }, [enabled, ref, visible]);
  return !enabled || visible;
}
