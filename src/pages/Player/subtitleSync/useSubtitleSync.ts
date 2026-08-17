import { useCallback, useMemo, useRef, useState } from "react";
import { invokeCommand } from "../../../runtime/platform";
import {
  AUTO_SYNC_MAX_VISIBLE_CUES,
  AUTO_SYNC_REACTION_COMPENSATION_MS,
  AUTO_SYNC_VISIBLE_MARGIN_MS,
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS,
} from "./config";
import {
  parseSubtitleCuesFromText,
  selectAutoSyncVisibleCues,
  type SubtitleSyncCue,
} from "./parser";

export type SubtitleSyncStage = "waiting-for-sync" | "picking-line";

interface UseSubtitleSyncArgs {
  selectedSubtitleValue: string;
  streamUrl: string | null;
  streamHeaders: Record<string, string> | undefined;
  getPositionMs: () => Promise<number>;
  onApplyDelay: (delayMs: number) => void;
}

export function useSubtitleSync({
  selectedSubtitleValue,
  streamUrl,
  streamHeaders,
  getPositionMs,
  onApplyDelay,
}: UseSubtitleSyncArgs) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<SubtitleSyncCue[]>([]);
  const [capturedVideoMs, setCapturedVideoMs] = useState<number | null>(null);
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const closeSync = useCallback(() => {
    console.log("[sync-debug] closeSync called");
    loadGenerationRef.current++;
    setOpen(false);
    setLoading(false);
    setError(null);
    setCues([]);
    setCapturedVideoMs(null);
    setSelectedTrackKey(null);
  }, []);

  const openSync = useCallback(() => {
    const trackKey = selectedSubtitleValue;
    if (!trackKey.startsWith("ext:")) {
      loadGenerationRef.current++;
      setOpen(true);
      setLoading(false);
      setCues([]);
      setCapturedVideoMs(null);
      setSelectedTrackKey(null);
      setError("Selecciona un subtítulo de addon primero.");
      return;
    }

    const generation = ++loadGenerationRef.current;
    setOpen(true);
    setLoading(true);
    setError(null);
    setCues([]);
    setCapturedVideoMs(null);
    setSelectedTrackKey(trackKey);

    const subtitleUrl = trackKey.slice(4);
    void (async () => {
      try {
        const rawText = await invokeCommand<string>("fetch_subtitle_text", {
          url: subtitleUrl,
          streamUrl: streamUrl || null,
          headers: streamHeaders ?? null,
        });
        if (loadGenerationRef.current !== generation) return;
        const parsedCues = parseSubtitleCuesFromText(rawText, subtitleUrl).filter(cue => cue.text.trim().length > 0);
        if (loadGenerationRef.current !== generation) return;
        setLoading(false);
        setCues(parsedCues);
        setError(parsedCues.length === 0 ? "No se encontraron líneas en este subtítulo." : null);
      } catch (cause) {
        if (loadGenerationRef.current !== generation) return;
        setLoading(false);
        setCues([]);
        setError(String(cause) || "No se pudieron cargar las líneas del subtítulo.");
      }
    })();
  }, [selectedSubtitleValue, streamUrl, streamHeaders]);

  const capture = useCallback(async () => {
    if (!open || loading) return;
    try {
      const positionMs = Math.max(0, Math.round(await getPositionMs()));
      setCapturedVideoMs(positionMs);
      setError(null);
    } catch {
      setCapturedVideoMs(0);
      setError(null);
    }
  }, [open, loading, getPositionMs]);

  const applyCue = useCallback(
    (cueStartTimeMs: number) => {
      const captureMs = capturedVideoMs ?? 0;
      const newDelayMs = Math.max(
        SUBTITLE_DELAY_MIN_MS,
        Math.min(
          SUBTITLE_DELAY_MAX_MS,
          Math.round(captureMs - cueStartTimeMs - AUTO_SYNC_REACTION_COMPENSATION_MS),
        ),
      );
      onApplyDelay(newDelayMs);
      closeSync();
    },
    [capturedVideoMs, onApplyDelay, closeSync],
  );

  const visibleCues = useMemo(
    () => selectAutoSyncVisibleCues(cues, capturedVideoMs ?? 0, AUTO_SYNC_VISIBLE_MARGIN_MS, AUTO_SYNC_MAX_VISIBLE_CUES),
    [cues, capturedVideoMs],
  );

  const stage: SubtitleSyncStage | null = !open || loading || error ? null : capturedVideoMs === null ? "waiting-for-sync" : "picking-line";

  return {
    open,
    loading,
    error,
    cues,
    visibleCues,
    capturedVideoMs,
    stage,
    selectedTrackKey,
    openSync,
    closeSync,
    capture,
    applyCue,
  };
}