import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  AudioLines,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Crop,
  Minus,
  ListVideo,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  RotateCw,
  Sparkles,
  TimerReset,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { SelectOption, VideoScaleMode } from "./types";
import { formatTime } from "./utils";
import ContextMenu from "../../components/ui/ContextMenu";
import { CONTEXT_GLASS_STYLE } from "../../components/ui/glassSurface";
import { tweenTo } from "../../utils/motion";
import { sendNativePlaybackCommand, setNativeMpvControlsBlur } from "../../runtime/platform";

type MpvBlurGeometry = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  cornerRadius: number;
  viewportWidth: number;
  viewportHeight: number;
  episodePanel?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    cornerRadius: number;
  };
  subtitlePanel?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    cornerRadius: number;
  };
};

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
  selectedVideoProfile: string;
  videoScaleMode: VideoScaleMode;
  audioOptions: SelectOption[];
  subtitleOptions: SelectOption[];
  speedOptions: string[];
  videoProfileOptions: SelectOption[];
  subtitlesLoading: boolean;
  subtitleDelayMs: number;
  subtitleScalePercent: number;
  subtitleVerticalPercent: number;
  showPanelToggle: boolean;
  activeSidePanel: "episodes" | "sources" | null;
  hasEpisodeOptions: boolean;
  controlsLocked: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  canChangeSource: boolean;
  onControlsEnter: () => void;
  onControlsLeave: () => void;
  onSeek: (value: number) => void;
  onJump: (offset: number) => void;
  onTogglePlay: () => void;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
  onAudioChange: (value: string) => void;
  onSubtitleChange: (value: string) => void;
  onSubtitleDelayChange: (next: number) => void;
  onSubtitleScaleChange: (next: number) => void;
  onSubtitleVerticalChange: (next: number) => void;
  onSpeedChange: (value: string) => void;
  onVideoProfileChange: (value: string) => void;
  onToggleVideoScale: () => void;
  onToggleSourcePanel: () => void;
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
  selectedVideoProfile,
  videoScaleMode,
  audioOptions,
  subtitleOptions,
  speedOptions,
  videoProfileOptions,
  subtitlesLoading,
  subtitleDelayMs,
  subtitleScalePercent,
  subtitleVerticalPercent,
  showPanelToggle,
  activeSidePanel,
  hasEpisodeOptions,
  controlsLocked,
  canGoPrevEpisode,
  canGoNextEpisode,
  canChangeSource,
  onControlsEnter,
  onControlsLeave,
  onSeek,
  onJump,
  onTogglePlay,
  onVolumeChange,
  onToggleMute,
  onAudioChange,
  onSubtitleChange,
  onSubtitleDelayChange,
  onSubtitleScaleChange,
  onSubtitleVerticalChange,
  onSpeedChange,
  onVideoProfileChange,
  onToggleVideoScale,
  onToggleSourcePanel,
  onToggleEpisodePanel,
  onNavigateEpisode,
}: PlayerControlsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const controlsGlassRef = useRef<HTMLDivElement>(null);
  const lastBlurGeometryRef = useRef("");
  const blurErrorLoggedRef = useRef(false);
  const blurCommandQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingBlurCommandRef = useRef<{ enabled: boolean; rect?: MpvBlurGeometry } | null>(null);
  const blurCommandInFlightRef = useRef(false);
  const subtitlePositionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSubtitlePositionRef = useRef<number | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const subtitleBlurRefreshKey = useMemo(
    () => `${selectedSubtitleValue}|${subtitlesLoading ? "loading" : "ready"}|${subtitleOptions.map(option => option.value).join("\u0000")}`,
    [selectedSubtitleValue, subtitleOptions, subtitlesLoading],
  );

  useEffect(() => {
    tweenTo(controlsRef.current, { opacity: active ? 1 : 0 }, 0.3);
  }, [active]);

  useEffect(() => {
    const syncControlsTop = () => {
      const glass = controlsGlassRef.current;
      if (!glass) return;
      document.documentElement.style.setProperty(
        "--aetherio-player-controls-top",
        `${glass.getBoundingClientRect().top}px`,
      );
    };
    syncControlsTop();
    const observer = new ResizeObserver(syncControlsTop);
    if (controlsGlassRef.current) observer.observe(controlsGlassRef.current);
    observer.observe(document.documentElement);
    window.addEventListener("resize", syncControlsTop);
    window.visualViewport?.addEventListener("resize", syncControlsTop);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncControlsTop);
      window.visualViewport?.removeEventListener("resize", syncControlsTop);
    };
  }, []);

  useEffect(() => () => {
    document.documentElement.style.removeProperty("--aetherio-player-controls-top");
    void setNativeMpvControlsBlur(false);
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const configuredPosition = Math.max(0, Math.min(150, 100 - subtitleVerticalPercent));

    const syncSubtitlePosition = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        let nextPosition = configuredPosition;
        const controlsGlass = controlsGlassRef.current;
        if (active && controlsGlass) {
          const controlsTop = controlsGlass.getBoundingClientRect().top;
          const positionAboveControls = ((controlsTop - 18) / Math.max(1, window.innerHeight)) * 100;
          nextPosition = Math.min(configuredPosition, Math.max(0, positionAboveControls));
        }
        nextPosition = Number(nextPosition.toFixed(2));
        if (lastSubtitlePositionRef.current === nextPosition) return;
        lastSubtitlePositionRef.current = nextPosition;
        const next = subtitlePositionQueueRef.current
          .catch(() => undefined)
          .then(() => sendNativePlaybackCommand(["set_property", "sub-pos", nextPosition]));
        subtitlePositionQueueRef.current = next;
        void next.catch(error => {
          lastSubtitlePositionRef.current = null;
          console.warn("[PlayerControls] No se pudo ajustar la posición de los subtítulos.", error);
        });
      });
    };

    syncSubtitlePosition();
    const observer = new ResizeObserver(syncSubtitlePosition);
    if (controlsGlassRef.current) observer.observe(controlsGlassRef.current);
    window.addEventListener("resize", syncSubtitlePosition);
    window.visualViewport?.addEventListener("resize", syncSubtitlePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSubtitlePosition);
      window.visualViewport?.removeEventListener("resize", syncSubtitlePosition);
      window.cancelAnimationFrame(animationFrame);
      lastSubtitlePositionRef.current = configuredPosition;
      const restore = subtitlePositionQueueRef.current
        .catch(() => undefined)
        .then(() => sendNativePlaybackCommand(["set_property", "sub-pos", configuredPosition]));
      subtitlePositionQueueRef.current = restore;
      void restore.catch(() => undefined);
    };
  }, [active, subtitleVerticalPercent]);

  useEffect(() => {
    let disposed = false;
    let animationFrame = 0;
    let resizeSettleTimers: number[] = [];
    const subtitleRefreshTimers: number[] = [];

    const flushLatestBlurCommand = () => {
      const command = pendingBlurCommandRef.current;
      if (!command) {
        blurCommandInFlightRef.current = false;
        return;
      }
      pendingBlurCommandRef.current = null;
      const next = blurCommandQueueRef.current
        .catch(() => undefined)
        .then(() => setNativeMpvControlsBlur(command.enabled, command.rect));
      blurCommandQueueRef.current = next;
      void next.then(
        () => {
          blurErrorLoggedRef.current = false;
          flushLatestBlurCommand();
        },
        error => {
          lastBlurGeometryRef.current = "";
          if (!blurErrorLoggedRef.current) {
            blurErrorLoggedRef.current = true;
            console.warn("[PlayerControls] No se pudo activar el blur GPU de MPV.", error);
          }
          flushLatestBlurCommand();
        },
      );
    };
    const queueBlurCommand = (
      enabled: boolean,
      rect?: MpvBlurGeometry,
    ) => {
      pendingBlurCommandRef.current = { enabled, rect };
      if (blurCommandInFlightRef.current) return;
      blurCommandInFlightRef.current = true;
      flushLatestBlurCommand();
    };
    const disableBlur = () => {
      lastBlurGeometryRef.current = "";
      queueBlurCommand(false);
    };
    if (!active || controlsLocked) {
      disableBlur();
      return;
    }

    const syncBlurGeometry = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (disposed) return;
        const glass = controlsGlassRef.current;
        if (!glass) return;
        const rect = glass.getBoundingClientRect();
        const episodePanel = activeSidePanel
          ? document.querySelector<HTMLElement>("[data-player-episode-panel-glass]")
          : null;
        const episodeRect = episodePanel?.getBoundingClientRect();
        const subtitlePanel = openMenu
          ? document.querySelector<HTMLElement>("[data-player-floating-panel-glass]")
          : null;
        const subtitleRect = subtitlePanel?.getBoundingClientRect();
        const scale = window.devicePixelRatio || 1;
        const geometry = {
          left: rect.left * scale,
          top: rect.top * scale,
          right: rect.right * scale,
          bottom: rect.bottom * scale,
          cornerRadius: 26 * scale,
          viewportWidth: window.innerWidth * scale,
          viewportHeight: window.innerHeight * scale,
          episodePanel: episodeRect
            ? {
                left: episodeRect.left * scale,
                top: episodeRect.top * scale,
                right: episodeRect.right * scale,
                bottom: episodeRect.bottom * scale,
                cornerRadius: 28 * scale,
              }
            : undefined,
          subtitlePanel: subtitleRect
            ? {
                left: subtitleRect.left * scale,
                top: subtitleRect.top * scale,
                right: subtitleRect.right * scale,
                bottom: subtitleRect.bottom * scale,
                cornerRadius: 24 * scale,
              }
            : undefined,
        };
        const geometryKey = JSON.stringify(geometry);
        if (geometryKey === lastBlurGeometryRef.current) return;
        lastBlurGeometryRef.current = geometryKey;
        queueBlurCommand(true, geometry);
      });
    };
    const syncBlurAfterResize = () => {
      resizeSettleTimers.forEach(timer => window.clearTimeout(timer));
      resizeSettleTimers = [];
      syncBlurGeometry();
      for (const delay of [50, 120, 250, 500]) {
        resizeSettleTimers.push(window.setTimeout(syncBlurGeometry, delay));
      }
    };

    const forceBlurGeometryRefresh = () => {
      lastBlurGeometryRef.current = "";
      syncBlurGeometry();
    };

    forceBlurGeometryRefresh();
    for (const delay of [100, 300, 750, 1500, 3000]) {
      subtitleRefreshTimers.push(window.setTimeout(forceBlurGeometryRefresh, delay));
    }
    const observer = new ResizeObserver(syncBlurAfterResize);
    if (controlsGlassRef.current) observer.observe(controlsGlassRef.current);
    const episodePanel = document.querySelector<HTMLElement>("[data-player-episode-panel-glass]");
    if (episodePanel) observer.observe(episodePanel);
    const subtitlePanel = document.querySelector<HTMLElement>("[data-player-floating-panel-glass]");
    if (subtitlePanel) observer.observe(subtitlePanel);
    observer.observe(document.documentElement);
    window.addEventListener("resize", syncBlurAfterResize);
    window.visualViewport?.addEventListener("resize", syncBlurAfterResize);
    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", syncBlurAfterResize);
      window.visualViewport?.removeEventListener("resize", syncBlurAfterResize);
      window.cancelAnimationFrame(animationFrame);
      resizeSettleTimers.forEach(timer => window.clearTimeout(timer));
      subtitleRefreshTimers.forEach(timer => window.clearTimeout(timer));
    };
  }, [active, activeSidePanel, controlsLocked, openMenu, subtitleBlurRefreshKey]);

  function runControlAction(action: () => void) {
    setOpenMenu(null);
    action();
  }

  return (
    <div
      ref={controlsRef}
      data-player-interactive
      className="absolute inset-x-0 bottom-0 z-40 px-4 pb-3"
      style={{ opacity: 1, pointerEvents: active ? "auto" : "none" }}
      onMouseEnter={onControlsEnter}
      onMouseLeave={onControlsLeave}
      onMouseMove={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        ref={controlsGlassRef}
        data-player-controls-glass
        className="relative mx-auto w-full max-w-[1240px] overflow-hidden rounded-[26px] px-5 py-3.5 shadow-[0_30px_90px_rgba(0,0,0,0.76)]"
        style={{
          background: "rgba(70, 70, 70, 0.22)",
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
            style={{
              pointerEvents: controlsLocked ? "none" : "auto",
              opacity: controlsLocked ? 0.42 : 1,
              "--player-progress": `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
            } as CSSProperties}
            className="player-timeline flex-1 disabled:opacity-35"
          />
          <span className="w-12 text-xs text-white/84">{formatTime(duration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <IconButton label="Retroceder 10 segundos" disabled={controlsLocked} onClick={() => runControlAction(() => onJump(-10))}>
              <RotateCcw size={19} />
            </IconButton>
            <IconButton label={playing ? "Pausar" : "Reproducir"} disabled={controlsLocked} onClick={() => runControlAction(onTogglePlay)} large>
              {playing ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
            </IconButton>
            <IconButton label="Avanzar 10 segundos" disabled={controlsLocked} onClick={() => runControlAction(() => onJump(10))}>
              <RotateCw size={19} />
            </IconButton>
            <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/12 px-2.5 py-2">
              <button
                type="button"
                onClick={() => runControlAction(onToggleMute)}
                disabled={controlsLocked}
                className="flex h-7 w-7 items-center justify-center rounded-full text-white/84 gsap-transition hover:bg-white/12 hover:text-white disabled:opacity-35"
                title={volume === 0 ? "Restaurar volumen" : "Silenciar"}
                aria-label={volume === 0 ? "Restaurar volumen" : "Silenciar"}
              >
                {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={volume}
                onChange={event => onVolumeChange(Number(event.target.value))}
                disabled={controlsLocked}
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
              disabled={controlsLocked}
              onToggle={() => setOpenMenu(value => value === "audio" ? null : "audio")}
              onClose={() => setOpenMenu(null)}
            />
            <SubtitleMenu
              label={subtitlesLoading ? "Cargando subtítulos" : "Subtítulos"}
              selectedSubtitleValue={selectedSubtitleValue}
              subtitleOptions={[{ value: "", label: subtitlesLoading ? "Cargando subtítulos..." : "Apagado" }, ...subtitleOptions]}
              open={openMenu === "subtitles"}
              disabled={controlsLocked}
              subtitleDelayMs={subtitleDelayMs}
              subtitleScalePercent={subtitleScalePercent}
              subtitleVerticalPercent={subtitleVerticalPercent}
              onToggle={() => setOpenMenu(value => value === "subtitles" ? null : "subtitles")}
              onClose={() => setOpenMenu(null)}
              onSubtitleChange={onSubtitleChange}
              onSubtitleDelayChange={onSubtitleDelayChange}
              onSubtitleScaleChange={onSubtitleScaleChange}
              onSubtitleVerticalChange={onSubtitleVerticalChange}
            />
            <IconMenu
              id="speed"
              label="Velocidad"
              icon={<TimerReset size={17} />}
              value={selectedSpeed}
              options={speedOptions.map(option => ({ value: option, label: `${option}x` }))}
              onChange={onSpeedChange}
              open={openMenu === "speed"}
              disabled={controlsLocked}
              onToggle={() => setOpenMenu(value => value === "speed" ? null : "speed")}
              onClose={() => setOpenMenu(null)}
            />
            <VideoEnhancementMenu
              label="Mejoras de video"
              icon={<Sparkles size={17} />}
              value={selectedVideoProfile}
              options={videoProfileOptions}
              onChange={onVideoProfileChange}
              open={openMenu === "video-enhancements"}
              disabled={controlsLocked}
              onToggle={() => setOpenMenu(value => value === "video-enhancements" ? null : "video-enhancements")}
              onClose={() => setOpenMenu(null)}
            />

            <IconButton
              label={videoScaleMode === "crop" ? "Recortar" : "Original"}
              disabled={controlsLocked}
              onClick={() => runControlAction(onToggleVideoScale)}
            >
              <Crop size={18} />
            </IconButton>
            {canChangeSource ? (
              <IconButton
                label={activeSidePanel === "sources" ? "Cerrar fuentes" : "Fuentes"}
                disabled={controlsLocked}
                onClick={() => runControlAction(onToggleSourcePanel)}
              >
                <Radio size={18} />
              </IconButton>
            ) : null}

            {showPanelToggle && (
              <button
                onClick={() => runControlAction(onToggleEpisodePanel)}
                disabled={controlsLocked}
                className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
                  activeSidePanel === "episodes"
                    ? "border-white/[0.11] bg-white/18 text-white"
                    : "border-white/[0.07] bg-white/10 text-white/90 hover:bg-white/14"
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
                  disabled={controlsLocked || !canGoPrevEpisode}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Episodio siguiente"
                  onClick={() => runControlAction(() => onNavigateEpisode("next"))}
                  disabled={controlsLocked || !canGoNextEpisode}
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

function SubtitleMenu({
  label,
  selectedSubtitleValue,
  subtitleOptions,
  open,
  disabled,
  subtitleDelayMs,
  subtitleScalePercent,
  subtitleVerticalPercent,
  onToggle,
  onClose,
  onSubtitleChange,
  onSubtitleDelayChange,
  onSubtitleScaleChange,
  onSubtitleVerticalChange,
}: {
  label: string;
  selectedSubtitleValue: string;
  subtitleOptions: SelectOption[];
  open: boolean;
  disabled?: boolean;
  subtitleDelayMs: number;
  subtitleScalePercent: number;
  subtitleVerticalPercent: number;
  onToggle: () => void;
  onClose: () => void;
  onSubtitleChange: (value: string) => void;
  onSubtitleDelayChange: (next: number) => void;
  onSubtitleScaleChange: (next: number) => void;
  onSubtitleVerticalChange: (next: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = subtitleOptions.find(option => option.value === selectedSubtitleValue);
  const initialLanguage = selectedOption ? subtitleLanguageKey(selectedOption) : "off";
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage);

  useEffect(() => {
    if (!open) return;
    setSelectedLanguage(initialLanguage);
  }, [initialLanguage, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onClose, open]);

  const languageEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries = [{ key: "off", label: "Apagado" }];
    for (const option of subtitleOptions) {
      if (!option.value || option.value === "") continue;
      const key = subtitleLanguageKey(option);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, label: subtitleLanguageLabel(option) });
    }
    return entries;
  }, [subtitleOptions]);

  const variantOptions = useMemo(() => {
    if (selectedLanguage === "off") return [];
    return subtitleOptions.filter(option => subtitleLanguageKey(option) === selectedLanguage);
  }, [selectedLanguage, subtitleOptions]);

  return (
    <div className="relative" data-player-menu data-menu-id="subtitles">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Captions size={17} />
      </button>
      {open && !disabled ? (
        <div
          ref={menuRef}
          data-player-subtitle-panel-glass
          data-player-floating-panel-glass
          role="dialog"
          aria-label="Subtítulos"
          className="fixed left-1/2 z-[45] flex w-[min(760px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[24px] text-white"
          style={{
            ...CONTEXT_GLASS_STYLE,
            bottom: "calc(100vh - var(--aetherio-player-controls-top, 80vh) + 12px)",
            height: "min(470px, calc(var(--aetherio-player-controls-top, 80vh) - var(--app-safe-top) - 86px))",
            minHeight: 300,
          }}
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Captions size={18} className="shrink-0 text-white/72" />
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Subtítulos</h3>
                <p className="truncate text-xs text-white/48">{selectedOption?.label || "Apagados"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/64 gsap-transition hover:bg-white/10 hover:text-white"
              aria-label="Cerrar subtítulos"
              title="Cerrar"
            >
              <X size={17} />
            </button>
          </div>

          <div
            className="grid min-h-0 flex-1"
            style={{ gridTemplateColumns: "minmax(160px, 0.72fr) minmax(0, 1.6fr)" }}
          >
            <section className="flex min-h-0 flex-col border-r border-white/[0.08] bg-black/[0.08] p-3">
              <h4 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/42">Idioma</h4>
              <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
                {languageEntries.map(entry => (
                  <SubtitleItemButton
                    key={entry.key}
                    active={selectedLanguage === entry.key}
                    label={entry.label}
                    onClick={() => {
                      setSelectedLanguage(entry.key);
                      if (entry.key === "off") onSubtitleChange("");
                      else {
                        const first = subtitleOptions.find(option => subtitleLanguageKey(option) === entry.key);
                        if (first) onSubtitleChange(first.value);
                      }
                    }}
                  />
                ))}
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="flex min-h-0 flex-1 flex-col p-3">
                <h4 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/42">Pista</h4>
                <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
                  {selectedLanguage === "off" ? (
                    <p className="px-2 py-3 text-sm text-white/42">Subtítulos desactivados.</p>
                  ) : variantOptions.length ? (
                    variantOptions.map(option => (
                      <SubtitleVariantButton
                        key={option.value}
                        option={option}
                        active={option.value === selectedSubtitleValue}
                        onClick={() => onSubtitleChange(option.value)}
                      />
                    ))
                  ) : (
                    <p className="px-2 py-3 text-sm text-white/42">No hay pistas disponibles.</p>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-white/[0.08] bg-black/[0.06] p-3">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/42">Ajustes</h4>
                  <button
                    type="button"
                    onClick={() => {
                      onSubtitleDelayChange(0);
                      onSubtitleScaleChange(100);
                      onSubtitleVerticalChange(5);
                    }}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold text-white/58 gsap-transition hover:bg-white/[0.08] hover:text-white"
                  >
                    Restablecer
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <SubtitleStepper
                    label="Atraso"
                    value={formatDelay(subtitleDelayMs)}
                    onDecrease={() => onSubtitleDelayChange(subtitleDelayMs - 250)}
                    onIncrease={() => onSubtitleDelayChange(subtitleDelayMs + 250)}
                  />
                  <SubtitleStepper
                    label="Tamaño"
                    value={`${subtitleScalePercent}%`}
                    onDecrease={() => onSubtitleScaleChange(subtitleScalePercent - 5)}
                    onIncrease={() => onSubtitleScaleChange(subtitleScalePercent + 5)}
                  />
                  <SubtitleStepper
                    label="Posición vertical"
                    value={`${subtitleVerticalPercent}%`}
                    onDecrease={() => onSubtitleVerticalChange(subtitleVerticalPercent - 5)}
                    onIncrease={() => onSubtitleVerticalChange(subtitleVerticalPercent + 5)}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
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
      className={`flex items-center justify-center rounded-full border border-white/[0.07] bg-white/10 text-white gsap-transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-35 ${
        large ? "h-11 w-11" : "h-10 w-10"
      }`}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

const VIDEO_FILTER_CATEGORIES = [
  {
    id: "anime4k",
    label: "Anime4K",
    description: "Upscaling y restauración para animación",
    matches: (value: string) => value.startsWith("fast:") || value.startsWith("hq:"),
  },
  {
    id: "fsr",
    label: "AMD FSR",
    description: "Escalado espacial FidelityFX",
    matches: (value: string) => value.startsWith("fsr:"),
  },
  {
    id: "hardware",
    label: "Super Resolution",
    description: "Mejoras aceleradas por la GPU",
    matches: (value: string) => value.startsWith("vsr:"),
  },
  {
    id: "scalers",
    label: "Escaladores MPV",
    description: "Algoritmos de escalado de alta calidad",
    matches: (value: string) => value.startsWith("scaler:"),
  },
  {
    id: "processing",
    label: "Procesamiento MPV",
    description: "Limpieza y reducción de banding",
    matches: (value: string) => value.startsWith("deband:"),
  },
] as const;

function VideoEnhancementMenu({
  icon,
  label,
  value,
  options,
  onChange,
  open,
  onToggle,
  onClose,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setCategoryId(null);
  }, [open]);

  const category = VIDEO_FILTER_CATEGORIES.find(item => item.id === categoryId);
  const uncategorizedOptions = options.filter(option =>
    option.value === "" || !VIDEO_FILTER_CATEGORIES.some(item => item.matches(option.value)),
  );
  const categoryOptions = category ? options.filter(option => category.matches(option.value)) : [];
  const items = category
    ? [
        {
          label: category.label,
          description: "Volver a las categorías",
          icon: <ChevronLeft size={15} />,
          closeOnSelect: false,
          onSelect: () => setCategoryId(null),
        },
        ...categoryOptions.map(option => ({
          label: option.label,
          description: option.description,
          icon: option.value === value ? <Check size={14} /> : undefined,
          onSelect: () => onChange(option.value),
        })),
      ]
    : [
        ...uncategorizedOptions.map(option => ({
          label: option.label,
          description: option.description,
          icon: option.value === value ? <Check size={14} /> : undefined,
          onSelect: () => onChange(option.value),
        })),
        ...VIDEO_FILTER_CATEGORIES.map(item => {
          const count = options.filter(option => item.matches(option.value)).length;
          return {
            label: item.label,
            description: `${item.description} · ${count} ${count === 1 ? "filtro" : "filtros"}`,
            icon: <ChevronRight size={15} />,
            closeOnSelect: false,
            onSelect: () => setCategoryId(item.id),
          };
        }),
      ];

  return (
    <div className="relative" data-player-menu data-menu-id="video-enhancements">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
      </button>
      <ContextMenu
        open={open && !disabled}
        anchorRef={buttonRef}
        onClose={onClose}
        width={340}
        maxHeight={420}
        placement="above-end"
        items={items}
      />
    </div>
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
  disabled = false,
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
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative" data-player-menu data-menu-id={id}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {icon}
      </button>
      <ContextMenu
        open={open && !disabled}
        anchorRef={buttonRef}
        onClose={onClose}
        width={id === "video-enhancements" ? 340 : 224}
        maxHeight={id === "video-enhancements" ? 380 : 288}
        placement="above-end"
        items={options.map(option => ({
          label: option.label,
          description: option.description,
          icon: option.value === value ? <Check size={14} /> : undefined,
          onSelect: () => onChange(option.value),
        }))}
      />
    </div>
  );
}

function SubtitleItemButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-sm font-semibold gsap-transition ${
        active
          ? "border-white/22 bg-white/14 text-white"
          : "border-transparent bg-white/[0.04] text-white/76 hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {active ? <Check size={14} className="shrink-0" /> : null}
    </button>
  );
}

function SubtitleVariantButton({
  option,
  active,
  onClick,
}: {
  option: SelectOption;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 w-full items-center gap-3 rounded-md border px-3 py-2 text-left gsap-transition ${
        active
          ? "border-white/22 bg-white/14 text-white"
          : "border-transparent bg-white/[0.04] text-white/84 hover:bg-white/[0.08]"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{clipSubtitleLabel(option.label)}</span>
        <span className="mt-0.5 block truncate text-xs font-medium text-white/48">{subtitleVariantSourceLabel(option)}</span>
      </span>
      {active ? <Check size={15} className="shrink-0" /> : null}
    </button>
  );
}

function SubtitleStepper({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 truncate px-1 text-xs font-semibold text-white/56" title={label}>{label}</p>
      <div className="grid h-10 min-w-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-1">
        <button
          type="button"
          onClick={onDecrease}
          style={stepperButtonStyle}
          aria-label={`Disminuir ${label.toLowerCase()}`}
        >
          <Minus size={16} />
        </button>
        <span className="truncate text-center text-sm font-bold text-white/94">{value}</span>
        <button
          type="button"
          onClick={onIncrease}
          style={stepperButtonStyle}
          aria-label={`Aumentar ${label.toLowerCase()}`}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}

const stepperButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: "none",
  background: "rgba(255,255,255,0.07)",
  color: "rgba(255,255,255,0.95)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

function subtitleLanguageKey(option: SelectOption) {
  if (option.languageKey?.trim()) return option.languageKey.trim().toLowerCase();
  if (!option.value) return "off";
  const label = option.label.trim().toLowerCase();
  if (!label) return "other";
  const langQuery = label.match(/(?:^|[?&])(?:lang|lang_code|language)=([a-z-]{2,12})/i);
  if (langQuery?.[1]) return langQuery[1].toLowerCase();
  const token = label.split(" - ")[0]?.trim() ?? label;
  if (!token) return "other";
  return token;
}

function subtitleLanguageLabel(option: SelectOption) {
  if (option.languageLabel?.trim()) return option.languageLabel.trim();
  const label = option.label.trim();
  const token = label.split(" - ")[0]?.trim() ?? label;
  if (!token) return "Otro";
  if (/^es$|spa|spanish|espanol|español/i.test(token)) return "Español";
  if (/^en$|eng|english/i.test(token)) return "English";
  return token.length <= 18 ? token : token.slice(0, 18);
}

function subtitleVariantSourceLabel(option: SelectOption) {
  if (option.sourceLabel?.trim()) return option.sourceLabel.trim();
  if (!option.value) return "Ninguno";
  if (option.value.startsWith("track:")) return "Embebido";
  return "Externo";
}

function clipSubtitleLabel(label: string) {
  const trimmed = label.trim();
  if (trimmed.length <= 34) return trimmed;
  return `${trimmed.slice(0, 33)}...`;
}

function formatDelay(valueMs: number) {
  if (!valueMs) return "--";
  const seconds = valueMs / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(2)}s`;
}
