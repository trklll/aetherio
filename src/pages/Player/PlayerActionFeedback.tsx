import { useEffect, useRef } from "react";
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

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (!feedback) {
      if (!visibleRef.current) return;
      visibleRef.current = false;
      // Solo icono: salida por el mismo camino (opacidad + escala, §7).
      springTo(el, { opacity: 0, scale: 0.92 } as never, {
        damping: 1.0,
        duration: 0.28,
      });
      return;
    }

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
  }, [feedback]);

  if (!feedback) return null;

  const isVolume = feedback.kind === "volume";
  const volumePct = Math.round((feedback.volume ?? 0) * 100);
  const muted = (feedback.volume ?? 0) <= 0.001;
  const VolumeIcon = muted ? VolumeX : volumePct < 60 ? Volume1 : Volume2;
  // HUD macOS: barra de nivel continua 0..100% (el rango llega a 200% por
  // mpv, pero la barra se llena al 100%, como el OSD de Apple).
  const volumeLevelPct = muted ? 0 : Math.min(100, volumePct);

  // Adelantar → símbolo a la derecha; retroceder → símbolo a la izquierda;
  // resto centrado (§7 consistencia espacial: el icono sale hacia donde va el gesto).
  const wrapperAlign =
    feedback.kind === "forward"
      ? "justify-end pr-[12vw]"
      : feedback.kind === "rewind"
        ? "justify-start pl-[12vw]"
        : "justify-center";

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none absolute inset-0 z-[70] flex items-center ${wrapperAlign}`}
    >
      <div ref={cardRef} style={{ opacity: 0 }}>
        {feedback.kind === "play" ? (
          <Play
            size={64}
            className="fill-white text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.5}
          />
        ) : feedback.kind === "pause" ? (
          <Pause
            size={64}
            className="fill-white text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.5}
          />
        ) : feedback.kind === "forward" ? (
          <RotateCw
            size={60}
            className="text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.8}
          />
        ) : feedback.kind === "rewind" ? (
          <RotateCcw
            size={60}
            className="text-white [filter:drop-shadow(0_4px_20px_rgba(0,0,0,0.65))]"
            strokeWidth={1.8}
          />
        ) : isVolume ? (
          <div
            role="status"
            aria-label={muted ? "Volumen silenciado" : `Volumen ${Math.min(100, volumePct)} por ciento`}
            className="flex w-[208px] flex-col items-center gap-5 rounded-[28px] border border-white/10 bg-black/55 px-6 pb-6 pt-7 shadow-[0_16px_48px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
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
