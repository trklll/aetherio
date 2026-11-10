import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from "lucide-react";
import { prefersReducedMotion, springTo } from "../../utils/motion";

export type PlayerFeedbackKind = "play" | "pause" | "forward" | "rewind" | "volume";

export interface PlayerActionFeedbackData {
  id: number;
  kind: PlayerFeedbackKind;
  /** Segundos del salto (p. ej. 10 / -10). Solo para forward/rewind. */
  deltaSeconds?: number;
  /** Volumen 0..2 (100 = 100%). Solo para volume. */
  volume?: number;
}

interface Props {
  feedback: PlayerActionFeedbackData | null;
}

const FEEDBACK_FADE_OUT_MS = 280;
const REDUCED_MOTION_FADE_OUT_MS = 200;

/**
 * OSD de feedback (§1 Respuesta inmediata).
 *
 * play/pausa/seek: solo el icono, sin pastilla ni fondo. Aparece al
 * pausar/reanudar (espacio/click) o saltar, SIN despertar la barra de
 * controles y SIN números. Adelantar (→) sale a la derecha, retroceder
 * (←) a la izquierda, play/pausa al centro.
 * Volumen: HUD estilo macOS — pastilla de cristal esmerilado con icono
 * grande + barra de nivel continua (0..100%), centrada.
 * Sin números en pantalla (el porcentaje solo va al aria-label).
 * Cada retrigger anima desde el valor en pantalla (§3) con spring
 * críticamente amortiguado (damping 1.0, §4) — interrumpible y sin bounce.
 */
export default function PlayerActionFeedback({ feedback }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(feedback !== null);
  const [renderedFeedback, setRenderedFeedback] = useState(feedback);

  useEffect(() => {
    const el = cardRef.current;
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (!feedback) {
      if (!mounted || !el) {
        visibleRef.current = false;
        setRenderedFeedback(null);
        return;
      }

      visibleRef.current = false;
      const reduceMotion = prefersReducedMotion();
      springTo(el, reduceMotion ? { opacity: 0 } as never : { opacity: 0, scale: 0.92 } as never, {
        damping: 1.0,
        duration: reduceMotion ? 0.2 : FEEDBACK_FADE_OUT_MS / 1000,
      });
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setMounted(false);
        setRenderedFeedback(null);
      }, reduceMotion ? REDUCED_MOTION_FADE_OUT_MS : FEEDBACK_FADE_OUT_MS);
      return;
    }

    setRenderedFeedback(feedback);
    if (!mounted) {
      // El primer render no tiene nodo todavía. Montarlo y dejar que el efecto
      // vuelva a correr con la referencia ya disponible antes de animar.
      setMounted(true);
      return;
    }
    if (!el) return;

    visibleRef.current = true;
    if (prefersReducedMotion()) {
      // §14 cross-fade, sin slide/spring/parallax.
      springTo(el, { opacity: 1 } as never, { damping: 1.0, duration: 0.2 });
      return;
    }
    // §3 Animar siempre desde el valor actual en pantalla: overwrite:auto dentro
    // de springTo lo garantiza, así un seek repetido no pega saltos.
    springTo(el, { opacity: 1, scale: 1 } as never, {
      damping: 1.0,
      duration: 0.32,
    });
    // "Pop" sutil solo cuando el gesto trajo momentum (seek con flick, §4):
    // re-escala 1→1.06→1 sin bounce del contenedor.
    if (feedback.kind === "forward" || feedback.kind === "rewind") {
      springTo(el, { scale: 1.05 } as never, { damping: 0.8, duration: 0.18 });
      window.setTimeout(() => {
        if (visibleRef.current) springTo(el, { scale: 1 } as never, { damping: 1.0, duration: 0.3 });
      }, 180);
    }
  }, [feedback, mounted]);

  useEffect(() => () => {
    visibleRef.current = false;
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
  }, []);

  if (!mounted || !renderedFeedback) return null;

  const isVolume = renderedFeedback.kind === "volume";
  const volumePct = Math.round((renderedFeedback.volume ?? 0) * 100);
  const muted = (renderedFeedback.volume ?? 0) <= 0.001;
  const VolumeIcon = muted ? VolumeX : volumePct < 60 ? Volume1 : Volume2;
  // HUD macOS: barra de nivel continua 0..100% (el rango llega a 200% por
  // mpv, pero la barra se llena al 100%, como el OSD de Apple).
  const volumeLevelPct = muted ? 0 : Math.min(100, volumePct);

  // Adelantar → símbolo a la derecha; retroceder → símbolo a la izquierda;
  // resto centrado (§7 consistencia espacial: el icono sale hacia donde va el gesto).
  const wrapperAlign =
    renderedFeedback.kind === "forward"
      ? "justify-end pr-[12vw]"
      : renderedFeedback.kind === "rewind"
        ? "justify-start pl-[12vw]"
        : "justify-center";

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none absolute inset-0 z-[70] flex items-center ${wrapperAlign}`}
    >
      <div ref={cardRef} style={{ opacity: 0 }}>
        {renderedFeedback.kind === "play" ? (
          <Play
            size={64}
            className="fill-white text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.5}
          />
        ) : renderedFeedback.kind === "pause" ? (
          <Pause
            size={64}
            className="fill-white text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.5}
          />
        ) : renderedFeedback.kind === "forward" ? (
          <RotateCw
            size={60}
            className="text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.8}
          />
        ) : renderedFeedback.kind === "rewind" ? (
          <RotateCcw
            size={60}
            className="text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.8}
          />
        ) : isVolume ? (
          <div
            role="status"
            aria-label={muted ? "Volumen silenciado" : `Volumen ${Math.min(100, volumePct)} por ciento`}
            className="flex w-[208px] flex-col items-center gap-5 rounded-[28px] border border-white/10 bg-black/55 px-6 pb-6 pt-7 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-glass-lg"
          >
            <VolumeIcon size={52} className="text-white" strokeWidth={1.5} />
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25" aria-hidden="true">
              <div
                className="h-full rounded-full bg-white transition-[width] duration-150 ease-out"
                style={{ width: `${volumeLevelPct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
