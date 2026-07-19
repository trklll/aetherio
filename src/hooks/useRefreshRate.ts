import { useEffect, useMemo, useState } from "react";

const DEFAULT_REFRESH_RATE = 60;
const SAMPLE_COUNT = 32;

export function useRefreshRate() {
  const [refreshRate, setRefreshRate] = useState(DEFAULT_REFRESH_RATE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    let previous = 0;
    const deltas: number[] = [];

    const tick = (time: number) => {
      if (previous > 0) {
        const delta = time - previous;
        if (delta > 4 && delta < 50) deltas.push(delta);
      }
      previous = time;

      if (deltas.length >= SAMPLE_COUNT) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const measured = Math.round(1000 / median);
        if (Number.isFinite(measured) && measured >= 30 && measured <= 240) {
          setRefreshRate(measured);
        }
        return;
      }

      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return useMemo(() => ({
    refreshRate,
    frameMs: 1000 / refreshRate,
  }), [refreshRate]);
}
