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
  if (!visible) return null;

  return (
    <div className="absolute inset-y-4 right-5 z-50 w-[410px] max-w-[calc(100vw-40px)]">
      <div
        className="liquid-glass-dark flex h-full flex-col rounded-[24px] p-5 shadow-[0_34px_90px_rgba(0,0,0,0.76)]"
        style={{
          backgroundColor: "rgba(0,0,0,0.72)",
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
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/16 bg-white/12 text-white/90 transition hover:bg-white/20"
            title="Cerrar panel"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="liquid-glass mb-4 rounded-2xl p-4">
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
              className="liquid-glass flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft size={16} />
              Anterior
            </button>
            <button
              onClick={() => onNavigateEpisode("next")}
              disabled={!canGoNextEpisode}
              className="liquid-glass flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/18 disabled:cursor-not-allowed disabled:opacity-35"
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
              className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-4 text-left transition ${
                item.active
                  ? "liquid-glass border-white/28 bg-white/16"
                  : "liquid-glass-dark border-white/14 hover:border-white/20 hover:bg-white/12"
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
