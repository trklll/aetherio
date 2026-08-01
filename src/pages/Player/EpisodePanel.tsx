import { ChevronLeft, ChevronRight, ListVideo } from "lucide-react";
import type { EpisodeOption, PlayerPanelItem } from "./types";
import PlayerSidePanel from "./PlayerSidePanel";

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
  return (
    <PlayerSidePanel
      visible={visible}
      title="Episodios"
      subtitle={title}
      icon={<ListVideo size={18} />}
      onClose={onClose}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="mb-4 min-h-8 shrink-0">
          {seriesLogoUrl ? (
            <img src={seriesLogoUrl} alt={streamName} className="max-h-12 w-auto object-contain" />
          ) : (
            <p className="truncate text-lg font-semibold text-white/92">{streamName}</p>
          )}
        </div>

        <div className="mb-4 shrink-0 rounded-2xl border border-white/[0.07] bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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
    </PlayerSidePanel>
  );
}
