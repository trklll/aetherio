import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SubtitleSource } from "../../../types/subtitle";
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
import { buildAutoSubtitleSyncPlan, type AutoSubtitleSyncPlan } from "./autoSync";
import {
  setAutoSyncTitleMode,
  shouldAutoSyncTitle,
  type AutoSyncGlobalMode,
} from "./autoSyncPreference";
import { fetchEmbeddedReferenceCues } from "./embeddedReference";

export type SubtitleSyncStage = "waiting-for-sync" | "picking-line";

interface UseSubtitleSyncArgs {
  selectedSubtitleValue: string;
  subtitleSources: SubtitleSource[];
  streamUrl: string | null;
  streamHeaders: Record<string, string> | undefined;
  localPath?: string | null;
  titleKey: string;
  autoSyncMode: AutoSyncGlobalMode;
  getPositionMs: () => Promise<number>;
  onApplyDelay: (delayMs: number) => void;
  onApplyPlan: (plan: AutoSubtitleSyncPlan) => Promise<void> | void;
}

function languageBase(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().split(/[-_.]/)[0];
}

async function fetchCues(
  url: string,
  streamUrl: string | null,
  streamHeaders: Record<string, string> | undefined,
): Promise<SubtitleSyncCue[]> {
  const rawText = await invokeCommand<string>("fetch_subtitle_text", {
    url,
    streamUrl: streamUrl || null,
    headers: streamHeaders ?? null,
  });
  return parseSubtitleCuesFromText(rawText, url).filter(cue => cue.text.trim().length > 0);
}

export function useSubtitleSync({
  selectedSubtitleValue,
  subtitleSources,
  streamUrl,
  streamHeaders,
  localPath = null,
  titleKey,
  autoSyncMode,
  getPositionMs,
  onApplyDelay,
  onApplyPlan,
}: UseSubtitleSyncArgs) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canUseManual, setCanUseManual] = useState(false);
  const [cues, setCues] = useState<SubtitleSyncCue[]>([]);
  const [capturedVideoMs, setCapturedVideoMs] = useState<number | null>(null);
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const attemptedTitlesRef = useRef(new Set<string>());

  const closeSync = useCallback(() => {
    loadGenerationRef.current++;
    setOpen(false);
    setLoading(false);
    setError(null);
    setCanUseManual(false);
    setCues([]);
    setCapturedVideoMs(null);
    setSelectedTrackKey(null);
  }, []);

  // Nucleo compartido: el boton manual y el disparo automatico hacen exactamente
  // la misma busqueda de referencias. `announce` decide si el intento es visible
  // (abre el dialogo y ofrece el ajuste manual) o totalmente silencioso.
  const runAutoSync = useCallback(async (trackKey: string, announce: boolean) => {
    if (!trackKey.startsWith("ext:")) {
      if (!announce) return;
      loadGenerationRef.current++;
      setOpen(true);
      setLoading(false);
      setCues([]);
      setCapturedVideoMs(null);
      setSelectedTrackKey(null);
      setCanUseManual(false);
      setError("Selecciona un subtitulo de addon primero.");
      return;
    }

    const generation = ++loadGenerationRef.current;
    const subtitleUrl = trackKey.slice(4);
    const selectedSource = subtitleSources.find(source => source.url === subtitleUrl);
    const references = subtitleSources
      .filter(source => source.url !== subtitleUrl)
      .sort((left, right) => {
        const selectedLanguage = languageBase(selectedSource?.lang);
        const leftMatches = languageBase(left.lang) === selectedLanguage ? 1 : 0;
        const rightMatches = languageBase(right.lang) === selectedLanguage ? 1 : 0;
        return rightMatches - leftMatches;
      })
      .slice(0, 4);

    if (announce) {
      setOpen(true);
      setLoading(true);
      setError(null);
      setCanUseManual(false);
      setCues([]);
      setCapturedVideoMs(null);
      setSelectedTrackKey(trackKey);
    }

    try {
      const targetCues = await fetchCues(subtitleUrl, streamUrl, streamHeaders);
      if (loadGenerationRef.current !== generation) return;
      if (targetCues.length === 0) throw new Error("No se encontraron líneas en este subtítulo.");

      const referenceResults = await Promise.allSettled(
        references.map(source => fetchCues(source.url, streamUrl, streamHeaders)),
      );
      if (loadGenerationRef.current !== generation) return;
      const referenceCues = referenceResults
        .filter((result): result is PromiseFulfilledResult<SubtitleSyncCue[]> => result.status === "fulfilled")
        .map(result => result.value)
        .filter(value => value.length >= 3);
      // Sin otras traducciones descargadas, la pista que el propio archivo trae
      // sirve de referencia. Solo en lavia manual: leer el contenedor remoto
      // cuesta ancho de banda y no debe ocurrir sin que el usuario lo pida.
      if (referenceCues.length === 0 && announce) {
        const embedded = await fetchEmbeddedReferenceCues({
          url: streamUrl,
          localPath,
          streamUrl,
          headers: streamHeaders,
          language: selectedSource?.lang ?? null,
        });
        if (loadGenerationRef.current !== generation) return;
        if (embedded.length) referenceCues.push(embedded);
      }
      const plan = buildAutoSubtitleSyncPlan(targetCues, referenceCues);
      if (plan.confident) {
        try {
          await onApplyPlan(plan);
          // Un titulo que se sincroniza solo queda recordado para la proxima vez.
          if (titleKey) setAutoSyncTitleMode(titleKey, "on");
          if (announce && loadGenerationRef.current === generation) closeSync();
        } catch (cause) {
          if (loadGenerationRef.current !== generation || !announce) return;
          setLoading(false);
          setCues(targetCues);
          setCanUseManual(true);
          setError(String(cause) || "No se pudo aplicar la sincronización automática.");
        }
        return;
      }

      if (!announce) return;
      setLoading(false);
      setCues(targetCues);
      setCanUseManual(true);
      setError(`${plan.reason} El timing original no se modificó.`);
    } catch (cause) {
      if (loadGenerationRef.current !== generation || !announce) return;
      setLoading(false);
      setCues([]);
      setCanUseManual(false);
      setError(String(cause) || "No se pudieron cargar las líneas del subtítulo.");
    }
  }, [closeSync, onApplyPlan, streamHeaders, streamUrl, subtitleSources, titleKey]);

  // Al seleccionar un subtitulo de addon, los titulos ya sincronizados se
  // ajustan solos. Un fallo (red, referencia ausente) no molesta al usuario: el
  // titulo queda marcado como intentado durante esta sesion.
  useEffect(() => {
    if (!titleKey) return;
    if (!selectedSubtitleValue.startsWith("ext:")) return;
    if (!shouldAutoSyncTitle(autoSyncMode, titleKey, attemptedTitlesRef.current)) return;
    attemptedTitlesRef.current = new Set(attemptedTitlesRef.current).add(titleKey);
    void runAutoSync(selectedSubtitleValue, false);
  }, [autoSyncMode, runAutoSync, selectedSubtitleValue, titleKey]);

  const openSync = useCallback(() => {
    void runAutoSync(selectedSubtitleValue, true);
  }, [runAutoSync, selectedSubtitleValue]);

  const fallbackToManual = useCallback(() => {
    if (!open || loading) return;
    setError(null);
    setCanUseManual(false);
    setCapturedVideoMs(null);
  }, [loading, open]);

  const capture = useCallback(async () => {
    if (!open || loading || canUseManual) return;
    try {
      const positionMs = Math.max(0, Math.round(await getPositionMs()));
      setCapturedVideoMs(positionMs);
      setError(null);
    } catch {
      setCapturedVideoMs(null);
      setCanUseManual(true);
      setError("No se pudo leer la posicion del video. Intenta la sincronizacion manual otra vez.");
    }
  }, [canUseManual, getPositionMs, loading, open]);

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
    [capturedVideoMs, closeSync, onApplyDelay],
  );

  const visibleCues = useMemo(
    () => selectAutoSyncVisibleCues(cues, capturedVideoMs ?? 0, AUTO_SYNC_VISIBLE_MARGIN_MS, AUTO_SYNC_MAX_VISIBLE_CUES),
    [capturedVideoMs, cues],
  );

  const stage: SubtitleSyncStage | null = !open || loading || error
    ? null
    : capturedVideoMs === null
      ? "waiting-for-sync"
      : "picking-line";

  return {
    open,
    loading,
    error,
    canUseManual,
    cues,
    visibleCues,
    capturedVideoMs,
    stage,
    selectedTrackKey,
    openSync,
    closeSync,
    fallbackToManual,
    capture,
    applyCue,
  };
}
