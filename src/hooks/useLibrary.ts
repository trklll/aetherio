import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

interface HorizontalVirtualWindowOptions {
  itemCount: number;
  itemWidth: number;
  gap: number;
  overscan?: number;
}

interface VirtualRange {
  start: number;
  end: number;
}

export function useHorizontalVirtualWindow({
  itemCount,
  itemWidth,
  gap,
  overscan = 4,
}: HorizontalVirtualWindowOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const stride = itemWidth + gap;
  const [range, setRange] = useState<VirtualRange>(() => ({
    start: 0,
    end: Math.min(itemCount, Math.max(1, overscan * 2)),
  }));

  const updateRange = useCallback(() => {
    const element = scrollRef.current;
    if (!element || itemCount <= 0) {
      setRange({ start: 0, end: 0 });
      return;
    }

    const viewportWidth = element.clientWidth || window.innerWidth || stride;
    const start = Math.max(0, Math.floor(element.scrollLeft / stride) - overscan);
    const visibleCount = Math.ceil(viewportWidth / stride) + overscan * 2 + 1;
    const end = Math.min(itemCount, start + visibleCount);
    setRange(current => current.start === start && current.end === end ? current : { start, end });
  }, [itemCount, overscan, stride]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateRange();
    });
  }, [updateRange]);

  useLayoutEffect(() => {
    updateRange();
    const element = scrollRef.current;
    if (!element) return;

    element.addEventListener("scroll", scheduleUpdate, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(element);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      element.removeEventListener("scroll", scheduleUpdate);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleUpdate, updateRange]);

  const beforeWidth = range.start * stride;
  const renderedCount = Math.max(0, range.end - range.start);
  const renderedWidth = renderedCount > 0 ? renderedCount * itemWidth + Math.max(0, renderedCount - 1) * gap : 0;
  const totalWidth = itemCount > 0 ? itemCount * itemWidth + Math.max(0, itemCount - 1) * gap : 0;
  const afterWidth = Math.max(0, totalWidth - beforeWidth - renderedWidth);

  return useMemo(() => ({
    scrollRef,
    start: range.start,
    end: range.end,
    beforeWidth,
    afterWidth,
    scheduleUpdate,
  }), [afterWidth, beforeWidth, range.end, range.start, scheduleUpdate]);
}
