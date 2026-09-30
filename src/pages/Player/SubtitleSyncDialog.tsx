import { useEffect, useMemo, useRef } from "react";
import { Captions, Loader2, TimerReset } from "lucide-react";
import { getContextGlassStyle } from "../../components/ui/glassSurface";
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
  canUseManual: boolean;
  stage: SubtitleSyncStage | null;
  cues: SubtitleSyncCue[];
  capturedVideoMs: number | null;
  trackLabel: string;
  bigPicture?: boolean;
  embedded?: boolean;
  onClose: () => void;
  onCapture: () => void;
  onApplyCue: (cueStartTimeMs: number) => void;
  onUseManualSync: () => void;
  /** Olvida la preferencia de este titulo para no volver a intentar solos. */
  onForgetTitle?: () => void;
  /** Volver a la selecciA3n de pista (el menA� de subtA-tulos sigue debajo). */
  onPickTrack?: () => void;
}

export default function SubtitleSyncDialog({
  open,
  loading,
  error,
  canUseManual,
  stage,
  cues,
  capturedVideoMs,
  trackLabel,
  bigPicture,
  embedded = false,
  onClose,
  onCapture,
  onApplyCue,
  onUseManualSync,
  onForgetTitle,
  onPickTrack,
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
      if (event.key !== "Escape") return;
      // Consumir para que B del mando no dispare además el "volver" global.
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onClose]);

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

  useEffect(() => {
    if (!open || loading) return;
    // El foco entra en la acción principal de cada estado, no en el borde del panel.
    if (stage === "waiting-for-sync") {
      const target = panelRef.current?.querySelector<HTMLButtonElement>("[data-subtitle-sync-capture]");
      target?.focus({ preventScroll: true });
      return;
    }
    if (error) {
      panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      return;
    }
    if (stage !== "picking-line") return;
    // Se enfoca la línea más cercana al momento capturado, no la primera.
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button");
    const target = (buttons && nearestIndex >= 0 ? buttons[nearestIndex] : null)
      ?? listRef.current?.querySelector<HTMLButtonElement>("button");
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [open, loading, error, stage, nearestIndex]);

  // El portal se reconcilia desde document.activeElement, no desde el último
  // evento recibido: cada ciclo elimina cualquier marca vieja y deja una sola.
  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    if (!root) return;
    const clearPanelFocus = () => {
      root.querySelectorAll<HTMLElement>("[data-bp-focus], .spatial-focus").forEach(element => {
        element.removeAttribute("data-bp-focus");
        element.classList.remove("spatial-focus");
      });
    };
    const getActiveButton = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
      const button = active.matches("button:not([disabled])")
        ? active
        : active.closest<HTMLElement>("button:not([disabled])");
      return button && root.contains(button) ? button : null;
    };
    const reconcile = () => {
      const activeButton = getActiveButton();
      clearPanelFocus();
      activeButton?.setAttribute("data-bp-focus", "true");
    };

    root.addEventListener("focusin", reconcile);
    root.addEventListener("focusout", reconcile);
    reconcile();
    const veilTimer = window.setInterval(reconcile, 100);
    return () => {
      root.removeEventListener("focusin", reconcile);
      root.removeEventListener("focusout", reconcile);
      window.clearInterval(veilTimer);
      clearPanelFocus();
    };
  }, [open]);

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

  if (!open) return null;

  const isPickingLine = !loading && !error && stage === "picking-line";
  // El diálogo de captura es compacto y el de selección es ancho.
  const panelWidthClass = bigPicture && isPickingLine
    ? "w-[min(760px,calc(100vw-32px))]"
    : bigPicture
      ? "w-[min(560px,calc(100vw-32px))]"
      : "w-[min(500px,calc(100vw-32px))]";

  return (
    <div
      className={embedded ? "contents" : "fixed inset-0 z-[60] flex items-center justify-center p-4"}
      data-player-interactive
      onKeyDown={stopGlobalPlayerShortcuts}
    >
      {!embedded ? (
        <div
          className="absolute inset-0"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      <div
        ref={panelRef}
        role={embedded ? "region" : "dialog"}
        aria-label="Sincronizar subtítulos"
        data-player-sync-dialog-glass
        {...(bigPicture ? { "data-spatial-modal": "true" } : {})}
        className={embedded
          ? "relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-white"
          : `relative flex max-h-[calc(100vh-48px)] ${panelWidthClass} flex-col overflow-hidden rounded-[24px] text-white`}
        style={embedded ? { opacity: 0 } : { ...getContextGlassStyle(), opacity: 0 }}
      >
        {!embedded ? <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <TimerReset size={18} className="shrink-0 text-white/72" />
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Auto Sync</h3>
              <p className="truncate text-xs text-white/48">{trackLabel || "Subtítulos"}</p>
            </div>
          </div>
          {/* Sin X: en TV se sale con B/Escape y se vuelve al menú de subtítulos. */}
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        </div> : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-5">
          {loading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10">
              <Loader2 size={22} className="gsap-spin text-white/64" />
              <p className="text-sm font-medium text-white/64">Analizando subtítulos y referencias locales…</p>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
              <Captions size={22} className="text-white/44" />
              <p className="max-w-[320px] text-sm font-medium leading-relaxed text-white/70">{error}</p>
              <p className="max-w-[320px] text-xs leading-relaxed text-white/44">
                El ajuste automático necesita las líneas del archivo: solo disponible con subtítulos de addon.
              </p>
              {canUseManual ? (
                <button
                  type="button"
                  onClick={onUseManualSync}
                  className="rounded-full bg-white px-5 py-2 text-sm font-black text-black shadow-[0_18px_56px_rgba(0,0,0,0.4)] gsap-transition hover:scale-[1.04]"
                >
                  Sincronizar manualmente
                </button>
              ) : null}
              {onPickTrack ? (
                <button
                  type="button"
                  onClick={onPickTrack}
                  className="rounded-full bg-white px-5 py-2 text-sm font-black text-black shadow-[0_18px_56px_rgba(0,0,0,0.4)] gsap-transition hover:scale-[1.04]"
                >
                  Elegir subtA-tulo de addon
                </button>
              ) : null}
              {onForgetTitle ? (
                <button
                  type="button"
                  data-subtitle-sync-forget
                  onClick={onForgetTitle}
                  className="rounded-full border border-white/[0.07] bg-white/10 px-4 py-2 text-sm font-bold text-white gsap-transition hover:bg-white/16"
                >
                  No intentar más en este título
                </button>
              ) : null}
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
                data-subtitle-sync-capture
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
                      aria-current={index === nearestIndex ? "true" : undefined}
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
