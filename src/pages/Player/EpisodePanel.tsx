import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ListVideo } from "lucide-react";
import type { EpisodeOption, PlayerPanelItem } from "./types";

interface EpisodePanelProps {
  visible: boolean;
  title: string;
  streamName: string;
  seriesLogoUrl: string | null;
  currentEpisode: EpisodeOption | null;
  currentOverview: string;
  items: PlayerPanelItem[];
  hasEpisodeOptions: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  onClose: () => void;
  onNavigateEpisode: (direction: "prev" | "next") => void;
}

export default function EpisodePanel({
  visible,
  title,
  streamName,
  seriesLogoUrl,
  currentEpisode,
  currentOverview,
  items,
  hasEpisodeOptions,
  canGoPrevEpisode,
  canGoNextEpisode,
  onClose,
  onNavigateEpisode,
}: EpisodePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && panelRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      className="absolute z-40 w-[390px] max-w-[calc(100vw-40px)]"
      style={{ top: "calc(var(--app-safe-top) + 62px)", right: "var(--app-safe-x)", bottom: 126 }}
    >
      <div
        className="flex h-full flex-col rounded-[28px] border border-white/[0.075] p-5 shadow-[0_34px_90px_rgba(0,0,0,0.76)]"
        style={{
          background: "linear-gradient(135deg, rgba(64,64,64,0.52), rgba(28,28,30,0.74))",
          backdropFilter: "blur(24px) saturate(190%)",
          WebkitBackdropFilter: "blur(24px) saturate(190%)",
          boxShadow: "0 34px 90px rgba(0,0,0,0.76), inset 0 1px 0 rgba(255,255,255,0.055)",
        }}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[30px] font-black leading-none text-white">
              {seriesLogoUrl ? <img src={seriesLogoUrl} alt={streamName} className="max-h-16 w-auto object-contain" /> : streamName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.075] bg-white/[0.075] text-white/90 gsap-transition hover:bg-white/13"
            title="Cerrar panel"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-white/[0.065] bg-black/18 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="mb-2 flex items-center justify-between text-white/75">
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-sm">{currentEpisode?.airDate ?? ""}</span>
          </div>
          <p className="line-clamp-4 text-sm leading-6 text-white/80">{currentOverview}</p>
        </div>

        {hasEpisodeOptions && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => onNavigateEpisode("prev")}
              disabled={!canGoPrevEpisode}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.065] bg-white/[0.065] px-4 py-3 text-sm font-semibold text-white gsap-transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft size={16} />
              Anterior
            </button>
            <button
              onClick={() => onNavigateEpisode("next")}
              disabled={!canGoNextEpisode}
              className="flex items-center justify-center gap-2 rounded-2xl border border-white/[0.065] bg-white/[0.065] px-4 py-3 text-sm font-semibold text-white gsap-transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-35"
            >
              Siguiente
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="space-y-3 overflow-y-auto pr-1">
          {items.map(item => (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-4 text-left gsap-transition ${
                item.active
                  ? "border-white/[0.12] bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "border-white/[0.06] bg-white/[0.045] hover:border-white/[0.095] hover:bg-white/[0.08]"
              }`}
            >
              <div className="relative h-28 w-48 overflow-hidden rounded-xl">
                {item.image ? (
                  <>
                    <img src={item.image} alt="" className="h-28 w-48 object-cover" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/86 via-black/28 to-transparent" />
                  </>
                ) : (
                  <div className="flex h-28 w-48 items-center justify-center bg-white/10 text-white/60">
                    <ListVideo size={18} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight text-white">{item.title}</p>
                <p className="mt-1 text-sm text-white/72">{item.subtitle}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
