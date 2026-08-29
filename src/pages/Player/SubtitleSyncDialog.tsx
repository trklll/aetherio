import { useEffect, useMemo, useRef } from "react";
import { Captions, Loader2, TimerReset, X } from "lucide-react";
import { CONTEXT_GLASS_STYLE } from "../../components/ui/glassSurface";
import { tweenTo } from "../../utils/motion";
import {
  formatAutoSyncTimestamp,
  sanitizeCuePreviewText,
  type SubtitleSyncCue,
} from "./subtitleSync/parser";
import type { SubtitleSyncStage } from "./subtitleSync/useSubtitleSync";

interface SubtitleSyncDialogProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  stage: SubtitleSyncStage | null;
  cues: SubtitleSyncCue[];
  capturedVideoMs: number | null;
  trackLabel: string;
  onClose: () => void;
  onCapture: () => void;
  onApplyCue: (cueStartTimeMs: number) => void;
}

export default function SubtitleSyncDialog({
  open,
  loading,
  error,
  stage,
  cues,
  capturedVideoMs,
  trackLabel,
  onClose,
  onCapture,
  onApplyCue,
}: SubtitleSyncDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (panelRef.current) {
      // Solo opacidad: panel seguido por la máscara de blur GPU de MPV.
      tweenTo(panelRef.current, { opacity: 1 }, 0.26);
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || loading || error || stage !== "picking-line") return;
    const firstButton = listRef.current?.querySelector<HTMLButtonElement>("button");
    firstButton?.focus({ preventScroll: true });
  }, [open, loading, error, stage]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const topAtPoint = document.elementFromPoint(event.clientX, event.clientY);
      console.log("[sync-debug] pointerdown", {
        stage,
        target: target?.tagName,
        className: String(target?.className).slice(0, 60),
        isX: Boolean(target?.closest('button[aria-label="Cerrar sincronización"]')),
        inPanel: Boolean(panelRef.current?.contains(target)),
        topAtPoint: topAtPoint?.tagName,
        topIsX: Boolean(topAtPoint?.closest('button[aria-label="Cerrar sincronización"]')),
      });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, stage]);

  const stopGlobalPlayerShortcuts = (event: React.KeyboardEvent) => {
    if (
      event.key === " " ||
      event.code === "Space" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight"
    ) {
      event.stopPropagation();
    }
  };

  const nearestIndex = useMemo(() => {
    if (capturedVideoMs === null || cues.length === 0) return -1;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    cues.forEach((cue, index) => {
      const distance = Math.abs(cue.startTimeMs - capturedVideoMs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [cues, capturedVideoMs]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      data-player-interactive
      onKeyDown={stopGlobalPlayerShortcuts}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Sincronizar subtítulos"
        data-player-sync-dialog-glass
        className="relative flex max-h-[calc(100vh-48px)] w-[min(500px,calc(100vw-32px))] flex-col overflow-hidden rounded-[24px] text-white"
        style={{ ...CONTEXT_GLASS_STYLE, opacity: 0 }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <TimerReset size={18} className="shrink-0 text-white/72" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Sincronizar línea</h3>
              <p className="truncate text-xs text-white/48">{trackLabel || "Subtítulos"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              console.log("[sync-debug] X onClick fired, stage =", stage);
              onClose();
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/64 gsap-transition hover:bg-white/10 hover:text-white"
            aria-label="Cerrar sincronización"
            title="Cerrar"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-5">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10">
              <Loader2 size={22} className="gsap-spin text-white/64" />
              <p className="text-sm font-medium text-white/64">Cargando líneas de subtítulos…</p>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
              <Captions size={22} className="text-white/44" />
              <p className="max-w-[320px] text-sm font-medium leading-relaxed text-white/70">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/[0.07] bg-white/10 px-4 py-2 text-sm font-bold text-white gsap-transition hover:bg-white/16"
              >
                Cerrar
              </button>
            </div>
          ) : stage === "waiting-for-sync" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
              <div className="flex flex-col items-center gap-3">
                <TimerReset size={30} className="text-white/84" />
                <p className="max-w-[340px] text-[15px] font-medium leading-relaxed text-white/84">
                  Presiona <span className="font-bold text-white">Sync</span> cuando escuches una línea de diálogo.
                </p>
                <p className="text-xs text-white/44">La línea elegida quedará alineada con el momento del vídeo.</p>
              </div>
              <button
                type="button"
                onClick={onCapture}
                className="rounded-full bg-white px-7 py-2.5 text-sm font-black text-black shadow-[0_18px_56px_rgba(0,0,0,0.4)] gsap-transition hover:scale-[1.04]"
              >
                Sync
              </button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between px-1">
                <p className="text-sm font-semibold text-white/84">
                  Capturado en{" "}
                  <span className="font-black text-white">{formatAutoSyncTimestamp(capturedVideoMs ?? 0)}</span>
                </p>
                <p className="text-xs text-white/44">Elige la línea que estabas escuchando</p>
              </div>
              <div ref={listRef} className="min-h-0 min-w-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                {cues.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-white/42">No hay líneas cercanas a este momento.</p>
                ) : (
                  cues.map((cue, index) => (
                    <button
                      key={`${cue.startTimeMs}-${index}`}
                      type="button"
                      onClick={() => onApplyCue(cue.startTimeMs)}
                      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left gsap-transition ${
                        index === nearestIndex
                          ? "border-white/22 bg-white/15"
                          : "border-transparent bg-white/[0.04] hover:bg-white/[0.09]"
                      }`}
                    >
                      <span className="w-[64px] shrink-0 font-mono text-xs font-bold text-white/72">
                        {formatAutoSyncTimestamp(cue.startTimeMs)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/92">
                        {sanitizeCuePreviewText(cue.text)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {!loading && !error && stage === "picking-line" ? (
          <div className="flex shrink-0 items-center justify-between border-t border-white/[0.08] bg-black/[0.06] px-5 py-3">
            <p className="text-xs text-white/44">Elige la línea para aplicar el ajuste automático.</p>
            <button
              type="button"
              onClick={onCapture}
              className="rounded-full border border-white/[0.07] bg-white/10 px-4 py-2 text-xs font-bold text-white gsap-transition hover:bg-white/16"
            >
              Volver a capturar
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}