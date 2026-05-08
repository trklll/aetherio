import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AudioLines,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  ListVideo,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  TimerReset,
  Volume2,
} from "lucide-react";
import type { SelectOption, VideoScaleMode } from "./types";
import { formatTime } from "./utils";

interface PlayerControlsProps {
  active: boolean;
  currentMetaTitle: string;
  title: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  volume: number;
  selectedMpvAudio: string;
  selectedSubtitleValue: string;
  selectedSpeed: string;
  videoScaleMode: VideoScaleMode;
  audioOptions: SelectOption[];
  subtitleOptions: SelectOption[];
  speedOptions: string[];
  subtitlesLoading: boolean;
  showPanelToggle: boolean;
  showEpisodePanel: boolean;
  hasEpisodeOptions: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  onControlsEnter: () => void;
  onControlsLeave: () => void;
  onSeek: (value: number) => void;
  onJump: (offset: number) => void;
  onTogglePlay: () => void;
  onVolumeChange: (value: number) => void;
  onAudioChange: (value: string) => void;
  onSubtitleChange: (value: string) => void;
  onSpeedChange: (value: string) => void;
  onToggleVideoScale: () => void;
  onToggleEpisodePanel: () => void;
  onNavigateEpisode: (direction: "prev" | "next") => void;
}

export default function PlayerControls({
  active,
  currentMetaTitle,
  title,
  currentTime,
  duration,
  playing,
  volume,
  selectedMpvAudio,
  selectedSubtitleValue,
  selectedSpeed,
  videoScaleMode,
  audioOptions,
  subtitleOptions,
  speedOptions,
  subtitlesLoading,
  showPanelToggle,
  showEpisodePanel,
  hasEpisodeOptions,
  canGoPrevEpisode,
  canGoNextEpisode,
  onControlsEnter,
  onControlsLeave,
  onSeek,
  onJump,
  onTogglePlay,
  onVolumeChange,
  onAudioChange,
  onSubtitleChange,
  onSpeedChange,
  onToggleVideoScale,
  onToggleEpisodePanel,
  onNavigateEpisode,
}: PlayerControlsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && controlsRef.current?.contains(target)) return;
      setOpenMenu(null);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [openMenu]);

  function runControlAction(action: () => void) {
    setOpenMenu(null);
    action();
  }

  return (
    <div
      ref={controlsRef}
      data-player-interactive
      className="absolute inset-x-0 bottom-0 z-40 px-4 pb-3 transition-opacity duration-300"
      style={{ opacity: active ? 1 : 0, pointerEvents: active ? "auto" : "none" }}
      onMouseEnter={onControlsEnter}
      onMouseLeave={onControlsLeave}
      onMouseMove={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        className="liquid-glass-dark mx-auto w-full max-w-[1240px] rounded-[24px] px-5 py-3.5 shadow-[0_30px_90px_rgba(0,0,0,0.76)]"
        style={{
          backgroundColor: "rgba(0,0,0,0.72)",
        }}
      >
        <div className="mb-2 flex items-center gap-3 text-xs text-white/72">
          <span className="max-w-[36ch] truncate text-base font-semibold text-white/92">{currentMetaTitle}</span>
          {title ? (
            <>
              <span className="h-1 w-1 rounded-full bg-white/45" />
              <span>{title}</span>
            </>
          ) : null}
        </div>

        <div className="mb-3.5 flex items-center gap-3">
          <span className="w-12 text-right text-xs text-white/84">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(currentTime, duration || currentTime)}
            onChange={event => onSeek(Number(event.target.value))}
            disabled={!duration}
            className="h-1.5 flex-1 accent-white disabled:opacity-35"
          />
          <span className="w-12 text-xs text-white/84">{formatTime(duration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <IconButton label="Retroceder 10 segundos" onClick={() => runControlAction(() => onJump(-10))}>
              <RotateCcw size={19} />
            </IconButton>
            <IconButton label={playing ? "Pausar" : "Reproducir"} onClick={() => runControlAction(onTogglePlay)} large>
              {playing ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
            </IconButton>
            <IconButton label="Avanzar 10 segundos" onClick={() => runControlAction(() => onJump(10))}>
              <RotateCw size={19} />
            </IconButton>
            <div className="flex items-center gap-3 rounded-full border border-white/14 bg-white/14 px-3.5 py-2.5">
              <Volume2 size={17} className="text-white/84" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={event => onVolumeChange(Number(event.target.value))}
                className="h-1 w-32 accent-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <IconMenu
              id="audio"
              label="Audio"
              icon={<AudioLines size={17} />}
              value={selectedMpvAudio}
              options={[{ value: "", label: "Sin audio" }, ...audioOptions]}
              onChange={onAudioChange}
              open={openMenu === "audio"}
              onToggle={() => setOpenMenu(value => value === "audio" ? null : "audio")}
              onClose={() => setOpenMenu(null)}
            />

            <IconMenu
              id="subtitles"
              label={subtitlesLoading ? "Cargando subtitulos" : "Subtitulos"}
              icon={<Captions size={17} />}
              value={selectedSubtitleValue}
              options={[{ value: "", label: subtitlesLoading ? "Cargando subtitulos..." : "Sin subtitulos" }, ...subtitleOptions]}
              onChange={onSubtitleChange}
              open={openMenu === "subtitles"}
              onToggle={() => setOpenMenu(value => value === "subtitles" ? null : "subtitles")}
              onClose={() => setOpenMenu(null)}
            />

            <IconMenu
              id="speed"
              label="Velocidad"
              icon={<TimerReset size={17} />}
              value={selectedSpeed}
              options={speedOptions.map(option => ({ value: option, label: `${option}x` }))}
              onChange={onSpeedChange}
              open={openMenu === "speed"}
              onToggle={() => setOpenMenu(value => value === "speed" ? null : "speed")}
              onClose={() => setOpenMenu(null)}
            />

            <IconButton
              label={videoScaleMode === "crop" ? "Recortar" : "Original"}
              onClick={() => runControlAction(onToggleVideoScale)}
            >
              <Crop size={18} />
            </IconButton>

            {showPanelToggle && (
              <button
                onClick={() => runControlAction(onToggleEpisodePanel)}
                className={`flex h-10 w-10 items-center justify-center rounded-full border text-white transition ${
                  showEpisodePanel
                    ? "border-white/18 bg-white/20 text-white"
                    : "border-white/12 bg-white/12 text-white/90 hover:bg-white/18"
                }`}
                title="Episodios"
                aria-label="Episodios"
              >
                <ListVideo size={16} />
              </button>
            )}

            {hasEpisodeOptions && (
              <>
                <IconButton
                  label="Episodio anterior"
                  onClick={() => runControlAction(() => onNavigateEpisode("prev"))}
                  disabled={!canGoPrevEpisode}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Episodio siguiente"
                  onClick={() => runControlAction(() => onNavigateEpisode("next"))}
                  disabled={!canGoNextEpisode}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  large = false,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  large?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center rounded-full border border-white/12 bg-white/12 text-white transition hover:bg-white/22 disabled:cursor-not-allowed disabled:opacity-35 ${
        large ? "h-11 w-11" : "h-10 w-10"
      }`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function IconMenu({
  id,
  icon,
  label,
  value,
  options,
  onChange,
  open,
  onToggle,
  onClose,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white transition ${
          open ? "border-white/24 bg-white/22" : "border-white/12 bg-white/12 hover:bg-white/20"
        }`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
      >
        {icon}
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="menu"
          className="absolute bottom-[calc(100%+10px)] right-0 z-50 max-h-72 min-w-56 overflow-y-auto rounded-2xl border border-white/18 p-1.5 shadow-[0_22px_70px_rgba(0,0,0,0.72)]"
          style={{
            backgroundColor: "rgba(12,12,12,0.86)",
            backdropFilter: "blur(42px) saturate(190%)",
            WebkitBackdropFilter: "blur(42px) saturate(190%)",
          }}
        >
          {options.map(option => {
            const active = option.value === value;
            return (
              <button
                key={option.value || "empty"}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChange(option.value);
                  onClose();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                  active ? "bg-white/18 text-white" : "text-white/76 hover:bg-white/12 hover:text-white"
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {active ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
