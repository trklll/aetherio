import { useCallback, useEffect, useRef, useState } from "react";
import { invokeCommand } from "../../../runtime/platform";
import {
  clampPreviewTime,
  getAdaptivePreviewPlan,
  getPreviewCacheSlotMs,
  getPreviewRequestTimeSeconds,
} from "./previewPolicy";

interface NativePreviewFrame {
  dataUrl: string;
}

interface PendingRequest {
  timeSeconds: number;
  generation: number;
  sessionGeneration: number;
  display: boolean;
}

interface UseNativeSeekPreviewOptions {
  sessionKey: string;
  enabled: boolean;
  durationSeconds: number;
  currentTimeSeconds: number;
  playing: boolean;
  buffering: boolean;
  previewActive: boolean;
  mediaSizeBytes?: number | null;
}

const MAX_MEMORY_CACHE_ITEMS = 256;
const REQUEST_INTERVAL_MS = 0;

export function useNativeSeekPreview({
  sessionKey,
  enabled,
  durationSeconds,
  currentTimeSeconds,
  playing,
  buffering,
  previewActive,
  mediaSizeBytes,
}: UseNativeSeekPreviewOptions) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new Map<number, NativePreviewFrame>());
  const generationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const previewErrorLoggedRef = useRef(false);
  const pendingRef = useRef<PendingRequest | null>(null);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const inFlightRequestRef = useRef<PendingRequest | null>(null);
  const inFlightSlotRef = useRef<number | null>(null);
  const displayedSlotRef = useRef<number | null>(null);
  const lastStartedAtRef = useRef(0);
  const latestRef = useRef({ currentTimeSeconds, previewActive });
  latestRef.current = { currentTimeSeconds, previewActive };

  useEffect(() => {
    sessionGenerationRef.current += 1;
    generationRef.current += 1;
    previewErrorLoggedRef.current = false;
    pendingRef.current = null;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    cacheRef.current.clear();
    displayedSlotRef.current = null;
    inFlightRequestRef.current = null;
    inFlightSlotRef.current = null;
    setFrameUrl(null);
    setLoading(false);
  }, [sessionKey]);

  const schedule = useCallback(() => {
    if (timerRef.current !== null || !pendingRef.current) return;
    const delay = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastStartedAtRef.current));
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      // The active request's finally block will resume the queue. Rescheduling
      // here with a zero delay would busy-loop for the entire decode duration.
      if (inFlightRef.current) return;
      const request = pendingRef.current;
      pendingRef.current = null;
      if (!request || !enabled) return;
      const key = getPreviewCacheSlotMs(request.timeSeconds);
      const cached = cacheRef.current.get(key);
      if (cached) {
        cacheRef.current.delete(key);
        cacheRef.current.set(key, cached);
        if (request.display && request.generation === generationRef.current) {
          displayedSlotRef.current = key;
          setFrameUrl(cached.dataUrl);
          setLoading(false);
        }
        schedule();
        return;
      }

      inFlightRef.current = true;
      inFlightRequestRef.current = request;
      inFlightSlotRef.current = key;
      lastStartedAtRef.current = Date.now();
      void invokeCommand<NativePreviewFrame>("seek_preview_frame", { timeSeconds: request.timeSeconds })
        .then(frame => {
          if (request.sessionGeneration === sessionGenerationRef.current) {
            cacheRef.current.set(getPreviewCacheSlotMs(request.timeSeconds), frame);
            while (cacheRef.current.size > MAX_MEMORY_CACHE_ITEMS) {
              const oldest = cacheRef.current.keys().next();
              if (oldest.done) break;
              cacheRef.current.delete(oldest.value);
            }
          }
          if (request.display && request.generation === generationRef.current) {
            previewErrorLoggedRef.current = false;
            displayedSlotRef.current = key;
            setFrameUrl(frame.dataUrl);
          }
        })
        .catch(error => {
          if (request.display && request.generation === generationRef.current) {
            if (!previewErrorLoggedRef.current) {
              console.warn("No se pudo cargar el preview nativo.", error);
              previewErrorLoggedRef.current = true;
            }
            setFrameUrl(null);
            displayedSlotRef.current = null;
          }
        })
        .finally(() => {
          inFlightRef.current = false;
          inFlightRequestRef.current = null;
          inFlightSlotRef.current = null;
          if (request.display && request.generation === generationRef.current) setLoading(false);
          schedule();
        });
    }, delay);
  }, [enabled]);

  const enqueue = useCallback((timeSeconds: number, display: boolean) => {
    if (!enabled || !Number.isFinite(timeSeconds) || durationSeconds <= 0) return;
    const nextTime = clampPreviewTime(timeSeconds, durationSeconds);
    const requestTimeSeconds = getPreviewRequestTimeSeconds(nextTime, durationSeconds);
    const key = getPreviewCacheSlotMs(requestTimeSeconds);
    const cached = cacheRef.current.get(key);
    const generation = display ? ++generationRef.current : generationRef.current;
    if (display && displayedSlotRef.current === key) return;
    if (cached && display) {
      cacheRef.current.delete(key);
      cacheRef.current.set(key, cached);
      displayedSlotRef.current = key;
      if (pendingRef.current?.display) pendingRef.current = null;
      setFrameUrl(cached.dataUrl);
      setLoading(false);
      return;
    }
    if (display) {
      displayedSlotRef.current = null;
      setFrameUrl(null);
      setLoading(true);
    }

    if (display && inFlightSlotRef.current === key && inFlightRequestRef.current) {
      // Promote an in-progress prefetch instead of extracting the same zone twice.
      Object.assign(inFlightRequestRef.current, {
        generation,
        sessionGeneration: sessionGenerationRef.current,
        display: true,
      });
      return;
    }

    const pending = pendingRef.current;
    if (display && pending?.display && getPreviewCacheSlotMs(pending.timeSeconds) === key) {
      pending.generation = generation;
      pending.sessionGeneration = sessionGenerationRef.current;
      return;
    }
    // Visible scrub requests always replace background work; a prefetch never
    // replaces the latest user-requested frame.
    if (display || !pending?.display) {
      pendingRef.current = {
        timeSeconds: requestTimeSeconds,
        generation,
        sessionGeneration: sessionGenerationRef.current,
        display,
      };
    }
    schedule();
  }, [durationSeconds, enabled, schedule]);

  const requestFrame = useCallback((timeSeconds: number) => enqueue(timeSeconds, true), [enqueue]);
  const prefetchFrame = useCallback((timeSeconds: number) => enqueue(timeSeconds, false), [enqueue]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current?.display) pendingRef.current = null;
    displayedSlotRef.current = null;
    setLoading(false);
    setFrameUrl(null);
  }, []);

  useEffect(() => {
    if (!enabled || !playing || buffering || previewActive || durationSeconds <= 0) return;
    const plan = getAdaptivePreviewPlan(mediaSizeBytes, false);
    if (plan.strideSeconds <= 0) return;
    const timer = window.setInterval(() => {
      const current = latestRef.current;
      if (current.previewActive) return;
      const aheadSeconds = plan.maximumAheadSeconds > 0
        ? Math.min(plan.strideSeconds, plan.maximumAheadSeconds)
        : plan.strideSeconds;
      const target = clampPreviewTime(current.currentTimeSeconds + aheadSeconds, durationSeconds);
      if (target < durationSeconds && !cacheRef.current.has(getPreviewCacheSlotMs(target))) {
        prefetchFrame(target);
      }
    }, Math.max(5_000, plan.strideSeconds * 1_000));
    return () => window.clearInterval(timer);
  }, [buffering, durationSeconds, enabled, mediaSizeBytes, playing, prefetchFrame, previewActive]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return { frameUrl, loading, requestFrame, cancel };
}
