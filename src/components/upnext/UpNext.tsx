import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { gsap } from "../../utils/motion";
import { getUpNextMiniRect } from "../../utils/upnextMiniRect";

/* ------------------------------------------------------------------ *
 * Aetherio "Up Next" (recomendacion) - M.D philosophy.
 * Aparece al TERMINAR una pelicula o el ultimo episodio de una serie.
 *
 * El video nativo MPV (detras del webview transparente) SE ACHICA de verdad:
 * Player/index.tsx anima video-zoom/video-align hacia la caja mini usando la
 * MISMA getUpNextMiniRect() que este componente usa para dibujar el hueco del
 * backdrop y la caja mini. Al ser una sola fuente de verdad, hueco y video
 * nunca se desalinean, ni al maximizar ni al cambiar de resolucion/DPR.
 *
 * No hay: emojis, like, "Acabas de ver", ni boton volver.
 * ------------------------------------------------------------------ */

export interface UpNextRecommendation {
  title: string;
  logoUrl?: string | null;
  backdropUrl?: string | null;
  overview?: string | null;
  posterUrl?: string | null;
  year?: string | null;
  rating?: number | null;
  voteCount?: number | null;
  runtime?: number | null;
  genres?: string[] | null;
  mediaTypeLabel?: string | null;
}

export interface UpNextProps {
  recommendation: UpNextRecommendation;
  countdownSeconds?: number;
  onPlay?: () => void;
  onCountdownEnd?: () => void;
  onMiniClick?: () => void;
  /** Cuando true, la página se desvanece y achica de vuelta (antes de desmontar). */
  exiting?: boolean;
  /** Se llama cuando termina la animación de salida, para desmontar. */
  onExitComplete?: () => void;
}

export default function UpNext({
  recommendation,
  countdownSeconds = 12,
  onPlay,
  onCountdownEnd,
  onMiniClick,
  exiting = false,
  onExitComplete,
}: UpNextProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(countdownSeconds);
  const countdownEndedRef = useRef(false);
  const exitRanRef = useRef(false);
  const [, setResizeTick] = useState(0);

  // Re-render (y por tanto recalcular hueco/caja) al cambiar el tamaño de la
  // ventana, para mantenerse sincronizado con el achique de MPV.
  useEffect(() => {
    const onResize = () => setResizeTick(t => t + 1);
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  // Fuente unica de verdad: la misma caja que usa MPV en Player/index.tsx.
  const mini = getUpNextMiniRect();
  const { x: x1, y: y1, w, h } = mini;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x2 = x1 + w;
  const y2 = y1 + h;
  // Hueco con clip-path: path(...) con DOS subtrayectos (M..Z M..Z). Un
  // polygon(evenodd) de 8 vértices en UNA sola ruta se auto-intersecta (pinwheel)
  // y deja un hilito transparente por donde se ve el video. Con dos subtrayectos
  // separados el hueco queda limpio, sin auto-intersección. (La mask SVG no la
  // renderiza el WebView2 de esta build, por eso no puede usarse.)
  const clipHole = `path(evenodd, "M${-8} ${-8}H${vw + 8}V${vh + 8}H${-8}Z M${x1} ${y1}H${x2}V${y2}H${x1}Z")`;

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const backdrop = root.querySelector<HTMLElement>("[data-upnext-backdrop]");
    const panel = root.querySelector<HTMLElement>("[data-upnext-panel]");
    const miniEl = root.querySelector<HTMLElement>("[data-upnext-mini]");
    const ctx = gsap.context(() => {
      // El achique REAL lo hace el video nativo (tween de MPV en Player). Aqui
      // solo se desvela el UI despues de que el video ya se asento en la caja.
      // Ease expo.out: desvanecido premium y fluido, con un leve blur que se
      // disuelve para que entre con elegancia (tipo Netflix).
      if (backdrop) gsap.fromTo(
        backdrop,
        { opacity: 0 },
        { opacity: 1, duration: 0.9, ease: "expo.out", delay: 0.25 },
      );
      if (miniEl) gsap.fromTo(
        miniEl,
        { opacity: 0, scale: 0.985, filter: "blur(6px)" },
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.85, ease: "expo.out", delay: 0.25 },
      );
      if (panel) gsap.fromTo(
        panel,
        { opacity: 0, x: 28, filter: "blur(8px)" },
        { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.9, ease: "expo.out", delay: 0.45 },
      );
    }, root);
    return () => ctx.revert();
  }, []);

  // Animación de salida elegante: se desvanece y achica antes de desmontar.
  useEffect(() => {
    if (!exiting || exitRanRef.current) return;
    exitRanRef.current = true;
    const root = rootRef.current;
    if (!root) {
      onExitComplete?.();
      return;
    }
    const backdrop = root.querySelector<HTMLElement>("[data-upnext-backdrop]");
    const panel = root.querySelector<HTMLElement>("[data-upnext-panel]");
    const miniEl = root.querySelector<HTMLElement>("[data-upnext-mini]");
    const done = () => onExitComplete?.();
    const tl = gsap.timeline({ onComplete: done });
    if (miniEl) tl.to(miniEl, { opacity: 0, scale: 0.98, filter: "blur(6px)", duration: 0.4, ease: "power2.in" }, 0);
    if (panel) tl.to(panel, { opacity: 0, x: 24, filter: "blur(6px)", duration: 0.4, ease: "power2.in" }, 0.02);
    if (backdrop) tl.to(backdrop, { opacity: 0, duration: 0.5, ease: "power2.in" }, 0.1);
    tl.call(done);
  }, [exiting, onExitComplete]);

  useEffect(() => {
    setCount(countdownSeconds);
    countdownEndedRef.current = false;
  }, [countdownSeconds, recommendation.logoUrl, recommendation.backdropUrl]);

  useEffect(() => {
    if (!onCountdownEnd) return;
    if (count <= 0) {
      if (!countdownEndedRef.current) {
        countdownEndedRef.current = true;
        onCountdownEnd?.();
      }
      return;
    }
    const t = window.setTimeout(() => setCount((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [count, onCountdownEnd]);

  return (
    <div ref={rootRef} data-player-interactive className="absolute inset-0 z-40 isolate overflow-hidden bg-transparent">
      {/* Backdrop z-0: arte de la recomendación. Con hueco redondeado para que el VIDEO VIVO nativo
          (detrás del webview, achicado a la caja mini por MPV) se vea a través. */}
      <div
        data-upnext-backdrop
        className="absolute inset-0 z-0 overflow-hidden"
        style={{
          // Base 100% opaca: fuera de la caja mini el video nativo de mpv (detrás
          // del webview) NO debe verse.
          background: "#101014",
          // Hueco con clip-path:path (dos subtrayectos, sin pinwheel). Nada de mask.
          clipPath: clipHole,
          WebkitClipPath: clipHole,
        } as any}
      >
        {recommendation.backdropUrl ? (
          <img
            src={recommendation.backdropUrl}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
          />
        ) : (
          <div className="absolute inset-0 bg-[#141418]" />
        )}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.42) 26%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.04) 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: "linear-gradient(to right, rgba(0,0,0,0.30) 0%, transparent 58%)",
          }}
        />
      </div>

      {/* Caja mini z-20: hueco transparente (misma posicion que el video MPV achicado).
          Click vuelve a la pelicula (dismiss). */}
      <div
        data-upnext-mini
        className="absolute z-20 cursor-pointer overflow-hidden rounded-2xl bg-transparent shadow-[0_18px_52px_rgba(0,0,0,0.55),0_2px_20px_rgba(0,0,0,0.35)] gsap-transition"
        style={{ left: x1, top: y1, width: w, height: h, opacity: 0 }}
        onClick={onMiniClick}
        role={onMiniClick ? "button" : undefined}
        tabIndex={onMiniClick ? 0 : undefined}
        onKeyDown={e => { if (onMiniClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onMiniClick(); } }}
        title={onMiniClick ? "Volver a la película" : undefined}
      />

      <div
        data-upnext-panel
        className="absolute z-10 flex flex-col justify-center gap-4 overflow-y-auto px-8 py-8 md:px-10"
        style={{
          right: "var(--app-safe-x)",
          top: "calc(var(--app-safe-top) + 48px)",
          bottom: "24px",
          width: "min(440px, 38vw)",
          maxHeight: "calc(100vh - var(--app-safe-top) - 72px)",
        } as any}
      >
        <div className="flex gap-4 items-start">
          {recommendation.posterUrl ? (
            <img
              src={recommendation.posterUrl}
              alt=""
              className="h-[132px] w-[88px] shrink-0 rounded-xl object-cover shadow-[0_8px_24px_rgba(0,0,0,0.45)] md:h-[156px] md:w-[104px]"
            />
          ) : null}
          <div className="min-w-0 flex-1 pt-1">
            {recommendation.logoUrl ? (
              <img
                src={recommendation.logoUrl}
                alt={recommendation.title}
                className="max-h-[48px] md:max-h-[56px] w-auto max-w-full object-contain object-left drop-shadow-[0_4px_20px_rgba(0,0,0,0.65)]"
              />
            ) : (
              <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.65)] leading-tight line-clamp-3">
                {recommendation.title}
              </h1>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-medium text-white/70">
              {recommendation.year ? <span>{recommendation.year}</span> : null}
              {recommendation.mediaTypeLabel ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <span>{recommendation.mediaTypeLabel}</span>
                </>
              ) : null}
              {typeof recommendation.rating === "number" ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <span className="inline-flex items-center gap-1">★ {recommendation.rating.toFixed(1)}</span>
                </>
              ) : null}
              {typeof recommendation.runtime === "number" && recommendation.runtime > 0 ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/35" />
                  <span>{Math.floor(recommendation.runtime / 60)}h {String(recommendation.runtime % 60).padStart(2, "0")}m</span>
                </>
              ) : null}
            </div>
            {recommendation.genres?.length ? (
              <p className="mt-1.5 text-xs leading-4 text-white/55 line-clamp-1">{recommendation.genres.join(" • ")}</p>
            ) : null}
          </div>
        </div>

        {recommendation.overview ? (
          <p className="text-[13px] md:text-sm leading-5 md:leading-6 text-white/80 line-clamp-5 drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">{recommendation.overview}</p>
        ) : null}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            data-player-interactive
            onClick={onPlay}
            className="flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-white px-7 py-3 text-[15px] font-bold text-black shadow-[0_8px_24px_rgba(0,0,0,0.35)] gsap-transition hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Play size={19} strokeWidth={2.6} fill="currentColor" />
            Reproducir
          </button>
        </div>
      </div>
    </div>
  );
}
