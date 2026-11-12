import { useEffect, useLayoutEffect, useRef } from "react";
import { Film } from "lucide-react";
import { getPlayerGlassSurface } from "../../components/ui/glassSurface";
import { gsap, prefersReducedMotion, springTo } from "../../utils/motion";

interface PlayerInfoOverlayProps {
  visible: boolean;
  title: string;
  episodeLabel?: string;
  seriesTitle?: string;
  overview: string;
  posterUrl?: string | null;
  nativeSurfaceVisible: boolean;
  onClose: () => void;
}

export default function PlayerInfoOverlay({
  visible,
  title,
  seriesTitle,
  overview,
  posterUrl,
  nativeSurfaceVisible,
  onClose,
}: PlayerInfoOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!visible) return;
    const panel = panelRef.current;
    if (!panel) return;

    panel.focus({ preventScroll: true });
    gsap.killTweensOf(panel);
    if (prefersReducedMotion()) {
      gsap.set(panel, { opacity: 0 });
      gsap.to(panel, { opacity: 1, duration: 0.2, ease: "power1.out", overwrite: "auto" });
      return;
    }

    gsap.set(panel, { opacity: 0, y: 10, scale: 0.985, filter: "blur(8px)" });
    springTo(panel, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }, { duration: 0.38, damping: 1.0 });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc" && event.code !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, visible]);

  if (!visible) return null;

  const glassStyle = getPlayerGlassSurface();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center px-[clamp(12px,2.5vw,40px)] pb-[clamp(16px,5.1vh,46px)]"
      data-spatial-modal="true"
      onPointerDown={event => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onClick={event => event.stopPropagation()}
    >
      <div
        ref={panelRef}
        id="player-info-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`Información de ${title}`}
        tabIndex={-1}
        data-player-floating-panel-glass
        data-player-episode-panel-glass
        onKeyDown={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
        className="flex w-full max-w-[1680px] items-center gap-[clamp(14px,1.5vw,24px)] overflow-hidden rounded-[24px] border p-[clamp(12px,1.4vw,22px)] text-white outline-none"
        style={{
          ...glassStyle,
          ...(nativeSurfaceVisible ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : {}),
          willChange: "transform, opacity, filter",
          transform: "translateZ(0)",
        }}
      >
        <div className="relative flex w-[clamp(88px,8.25vw,132px)] shrink-0 aspect-[2/3] items-center justify-center overflow-hidden rounded-xl bg-black/24 shadow-[0_8px_24px_rgba(0,0,0,0.36)]">
          {posterUrl ? (
            <img src={posterUrl} alt={`Póster de ${seriesTitle || title}`} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <Film size={28} className="text-white/50" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1 py-1">
          <p className="mt-[clamp(7px,0.8vw,12px)] line-clamp-3 text-[clamp(15px,1.5vw,24px)] font-medium leading-[1.35] text-white/90">
            {overview || "No hay una descripción disponible para este contenido."}
          </p>
        </div>
      </div>
    </div>
  );
}
