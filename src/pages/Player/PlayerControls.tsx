import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { SelectOption, VideoScaleMode } from "./types";
import { formatTime } from "./utils";
import ContextMenu from "../../components/ui/ContextMenu";
import PartyPanel from "../../party/PartyPanel";
import type { PartyMedia } from "../../party/protocol";
import { getContextGlassStyle } from "../../components/ui/glassSurface";
import { gsap, springTo, prefersReducedMotion, anchorTransformOrigin } from "../../utils/motion";
import { sendNativePlaybackCommand, setNativeMpvControlsBlur } from "../../runtime/platform";
import { SUBTITLE_DELAY_STEP_MS } from "./subtitleSync/config";

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
  subtitleSyncOpen: boolean;
  showPanelToggle: boolean;
  activeSidePanel: "episodes" | "sources" | null;
  hasEpisodeOptions: boolean;
  controlsLocked: boolean;
  /** Sala de espera Party: bloquea transporte pero deja volumen y Party vivos. */
  lobbyMode: boolean;
  showPartyButton: boolean;
  partyConnected: boolean;
  partyPeerCount: number;
  partyPeerNames: string[];
  partyCurrentMedia: PartyMedia | null;
  partyCurrentTitle: string;
  partyStreamFailed: boolean;
  onPartyRetryStream: () => void;
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
  onOpenSubtitleSync: () => void;
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
  subtitleSyncOpen,
  showPanelToggle,
  activeSidePanel,
  hasEpisodeOptions,
  controlsLocked,
  lobbyMode,
  showPartyButton,
  partyConnected,
  partyPeerCount,
  partyPeerNames,
  partyCurrentMedia,
  partyCurrentTitle,
  partyStreamFailed,
  onPartyRetryStream,
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
  onOpenSubtitleSync,
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
  const pendingBlurCommandRef = useRef<{ enabled: boolean; rect?: MpvBlurGeometry; alpha?: { blurAlpha?: number; episodeBlurAlpha?: number; subtitleBlurAlpha?: number } } | null>(null);
  const blurCommandInFlightRef = useRef(false);
  const subtitlePositionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSubtitlePositionRef = useRef<number | null>(null);
  const blurHideTimerRef = useRef<number | null>(null);
  const blurSyncTimerRef = useRef<number | null>(null);
  const barAlphaRef = useRef({ v: 0 });
  const episodeAlphaRef = useRef({ v: 0 });
  const subtitleAlphaRef = useRef({ v: 0 });
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Lobby Party: el transporte lo gobierna el anfitrión; volumen y Party siguen vivos.
  const transportLocked = controlsLocked || lobbyMode;
  const subtitleBlurRefreshKey = useMemo(
    () => `${selectedSubtitleValue}|${subtitlesLoading ? "loading" : "ready"}|${subtitleOptions.map(option => option.value).join("\u0000")}`,
    [selectedSubtitleValue, subtitleOptions, subtitlesLoading],
  );

  // §3/§4/§14 Barra con spring críticamente amortiguado, interrumpible desde presentation value
  useEffect(() => {
    const el = controlsRef.current;
    if (!el) return;
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: active ? 1 : 0, y: 0, scale: 1, filter: "blur(0px)" });
      el.style.pointerEvents = active ? "auto" : "none";
      return;
    }
    if (active) {
      el.style.pointerEvents = "auto";
      // §3 Always animate from presentation value — gsap.set then springTo does it; no jump
      gsap.set(el, { opacity: 0, y: 14, scale: 0.97, filter: "blur(8px)" });
      springTo(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: 0.45 });
    } else {
      springTo(el, { opacity: 0, y: 8, scale: 0.985, filter: "blur(6px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: 0.32 });
      window.setTimeout(() => {
        if (el && !active) el.style.pointerEvents = "none";
      }, 340);
    }
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

  // Blur con alpha animado solo para la barra principal: el shader mezcla
  // original↔blur según aetherio_blur_alpha, por eso el blur desvanece
  // exactamente junto a la opacidad de la barra y no se queda flotando.
  // Paneles laterales/menús mantienen blur binario (menos notorio al ser pequeños).
  useEffect(() => {
    let disposed = false;
    let animationFrame = 0;

    const flushLatestBlurCommand = () => {
      const command = pendingBlurCommandRef.current;
      if (!command) {
        blurCommandInFlightRef.current = false;
        return;
      }
      pendingBlurCommandRef.current = null;
      const next = blurCommandQueueRef.current
        .catch(() => undefined)
        .then(() => setNativeMpvControlsBlur(command.enabled, command.rect, command.alpha));
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
      alpha?: { blurAlpha?: number; episodeBlurAlpha?: number; subtitleBlurAlpha?: number },
    ) => {
      pendingBlurCommandRef.current = { enabled, rect, alpha };
      if (blurCommandInFlightRef.current) return;
      blurCommandInFlightRef.current = true;
      flushLatestBlurCommand();
    };

    const buildGeometry = (): MpvBlurGeometry | null => {
      const glass = controlsGlassRef.current;
      if (!glass) return null;
      const rect = glass.getBoundingClientRect();
      const episodePanel = activeSidePanel
        ? document.querySelector<HTMLElement>("[data-player-episode-panel-glass]")
        : null;
      const episodeRect = episodePanel?.getBoundingClientRect();
      const floatingPanel = openMenu || subtitleSyncOpen
        ? (document.querySelector<HTMLElement>("[data-player-sync-dialog-glass]") ??
           document.querySelector<HTMLElement>("[data-player-floating-panel-glass]"))
        : null;
      const floatingRect = floatingPanel?.getBoundingClientRect();
      if ((openMenu || subtitleSyncOpen) && !floatingPanel) return null;
      const scale = window.devicePixelRatio || 1;
      const r = (v: number) => Math.round(v * scale);
      return {
        left: r(rect.left),
        top: r(rect.top),
        right: r(rect.right),
        bottom: r(rect.bottom),
        cornerRadius: Math.round(26 * scale),
        viewportWidth: r(window.innerWidth),
        viewportHeight: r(window.innerHeight),
        episodePanel: episodeRect
          ? {
              left: r(episodeRect.left),
              top: r(episodeRect.top),
              right: r(episodeRect.right),
              bottom: r(episodeRect.bottom),
              cornerRadius: Math.round(28 * scale),
            }
          : undefined,
        subtitlePanel: floatingRect
          ? {
              left: r(floatingRect.left),
              top: r(floatingRect.top),
              right: r(floatingRect.right),
              bottom: r(floatingRect.bottom),
              cornerRadius: Math.round(24 * scale),
            }
          : undefined,
      };
    };

    const commitBlur = () => {
      if (disposed) return;
      const geometry = buildGeometry();
      if (!geometry) {
        window.setTimeout(commitBlur, 32);
        return;
      }
      const alpha = {
        blurAlpha: barAlphaRef.current.v,
        episodeBlurAlpha: episodeAlphaRef.current.v,
        subtitleBlurAlpha: subtitleAlphaRef.current.v,
      };
      const key = JSON.stringify({ geometry, alpha });
      if (key === lastBlurGeometryRef.current) return;
      lastBlurGeometryRef.current = key;
      const shouldBeEnabled =
        alpha.blurAlpha > 0.01 ||
        alpha.episodeBlurAlpha > 0.01 ||
        alpha.subtitleBlurAlpha > 0.01 ||
        active ||
        !!activeSidePanel ||
        !!openMenu ||
        !!subtitleSyncOpen;
      queueBlurCommand(shouldBeEnabled, geometry, alpha);
      if (!shouldBeEnabled) {
        window.setTimeout(() => {
          lastBlurGeometryRef.current = "";
          queueBlurCommand(false);
        }, 80);
      }
    };

    const syncBlurGeometry = () => {
      if (blurSyncTimerRef.current !== null) window.clearTimeout(blurSyncTimerRef.current);
      blurSyncTimerRef.current = window.setTimeout(() => {
        blurSyncTimerRef.current = null;
        window.cancelAnimationFrame(animationFrame);
        animationFrame = window.requestAnimationFrame(commitBlur);
      }, 16);
    };

    // Barra exagerada (0.62/0.44) y menús con misma elegancia que nav (0.48/0.36)
    const targetBar = active && !controlsLocked ? 1 : 0;
    const targetEpisode = activeSidePanel ? 1 : 0;
    const targetSubtitle = openMenu || subtitleSyncOpen ? 1 : 0;

    gsap.killTweensOf(barAlphaRef.current);
    gsap.killTweensOf(episodeAlphaRef.current);
    gsap.killTweensOf(subtitleAlphaRef.current);

    // §4 Critically damped springs for blur alpha — interruptible, no bounce
    if (prefersReducedMotion()) {
      barAlphaRef.current.v = targetBar;
      episodeAlphaRef.current.v = targetEpisode;
      subtitleAlphaRef.current.v = targetSubtitle;
      commitBlur();
    } else {
      springTo(barAlphaRef.current as unknown as gsap.TweenTarget, {
        v: targetBar,
        onUpdate: commitBlur,
        onComplete: commitBlur,
      } as unknown as gsap.TweenVars, { damping: 1.0, duration: targetBar ? 0.45 : 0.32 });
      springTo(episodeAlphaRef.current as unknown as gsap.TweenTarget, {
        v: targetEpisode,
        onUpdate: commitBlur,
        onComplete: commitBlur,
      } as unknown as gsap.TweenVars, { damping: 1.0, duration: targetEpisode ? 0.38 : 0.28 });
      springTo(subtitleAlphaRef.current as unknown as gsap.TweenTarget, {
        v: targetSubtitle,
        onUpdate: commitBlur,
        onComplete: commitBlur,
      } as unknown as gsap.TweenVars, { damping: 1.0, duration: targetSubtitle ? 0.38 : 0.28 });
    }

    // Commit inicial inmediato para que el primer frame ya tenga blur si toca
    commitBlur();

    const observer = new ResizeObserver(syncBlurGeometry);
    if (controlsGlassRef.current) observer.observe(controlsGlassRef.current);
    const episodeEl = document.querySelector<HTMLElement>("[data-player-episode-panel-glass]");
    if (episodeEl) observer.observe(episodeEl);
    const floatingEl = document.querySelector<HTMLElement>("[data-player-floating-panel-glass]");
    if (floatingEl) observer.observe(floatingEl);
    const syncEl = document.querySelector<HTMLElement>("[data-player-sync-dialog-glass]");
    if (syncEl) observer.observe(syncEl);
    observer.observe(document.documentElement);

    const mutationObserver = new MutationObserver(syncBlurGeometry);
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });

    window.addEventListener("resize", syncBlurGeometry);
    window.visualViewport?.addEventListener("resize", syncBlurGeometry);
    return () => {
      disposed = true;
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", syncBlurGeometry);
      window.visualViewport?.removeEventListener("resize", syncBlurGeometry);
      window.cancelAnimationFrame(animationFrame);
      gsap.killTweensOf(barAlphaRef.current);
      if (blurSyncTimerRef.current !== null) {
        window.clearTimeout(blurSyncTimerRef.current);
        blurSyncTimerRef.current = null;
      }
      if (blurHideTimerRef.current !== null) {
        window.clearTimeout(blurHideTimerRef.current);
        blurHideTimerRef.current = null;
      }
    };
  }, [active, activeSidePanel, controlsLocked, openMenu, subtitleBlurRefreshKey, subtitleSyncOpen]);

  function runControlAction(action: () => void) {
    setOpenMenu(null);
    action();
  }

  return (
    <div
      ref={controlsRef}
      data-player-interactive
      className="absolute inset-x-0 bottom-0 z-40 px-4 pb-3 will-change-transform"
      style={{ opacity: 0, pointerEvents: active ? "auto" : "none", willChange: "transform, opacity, filter", transform: "translateZ(0)" }}
      onMouseEnter={onControlsEnter}
      onMouseLeave={onControlsLeave}
      onMouseMove={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <div
        ref={controlsGlassRef}
        data-player-controls-glass
        className="relative mx-auto w-full max-w-[1240px] overflow-hidden rounded-[26px] px-5 py-3.5 shadow-[0_30px_90px_rgba(0,0,0,0.76)] will-change-transform"
        style={{
          background: prefersReducedMotion() || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches)
            ? "rgba(28,28,30,0.94)"
            : "rgba(70, 70, 70, 0.22)",
          backdropFilter: (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) ? "none" : "blur(22px) saturate(180%)",
          WebkitBackdropFilter: (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) ? "none" : "blur(22px) saturate(180%)",
          border: "1px solid rgba(255,255,255,0.08)",
          willChange: "transform, backdrop-filter",
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
        }}
      >
        <div className="mb-2 flex items-center gap-3 text-xs text-white/72">
          <span className="max-w-[36ch] truncate text-base font-semibold tracking-[-0.015em] leading-[1.1] text-white/92" style={{ fontOpticalSizing: "auto" }}>{currentMetaTitle}</span>
          {title ? (
            <>
              <span className="h-1 w-1 rounded-full bg-white/45" />
              <span className="tracking-[0.01em] leading-[1.4]">{title}</span>
            </>
          ) : null}
          {partyConnected ? (
            <span className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/12 px-2.5 py-1 text-xs font-bold text-white/85">
              <Users size={13} className="shrink-0 text-white/70" />
              <span className="truncate">
                en Party {partyPeerNames.length > 0 ? `con ${partyPeerNames.slice(0, 4).join(", ")}${partyPeerNames.length > 4 ? ` y ${partyPeerNames.length - 4} más` : ""}` : ""}
              </span>
            </span>
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
            disabled={!duration || transportLocked}
            style={{
              pointerEvents: transportLocked ? "none" : "auto",
              opacity: transportLocked ? 0.42 : 1,
              "--player-progress": `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%`,
            } as CSSProperties}
            className="player-timeline flex-1 disabled:opacity-35"
          />
          <span className="w-12 text-xs text-white/84">{formatTime(duration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <IconButton label="Retroceder 10 segundos" disabled={transportLocked} onClick={() => runControlAction(() => onJump(-10))}>
              <RotateCcw size={19} />
            </IconButton>
            <IconButton label={playing ? "Pausar" : "Reproducir"} disabled={transportLocked} onClick={() => runControlAction(onTogglePlay)} large>
              {playing ? <Pause size={24} fill="white" /> : <Play size={24} fill="white" />}
            </IconButton>
            <IconButton label="Avanzar 10 segundos" disabled={transportLocked} onClick={() => runControlAction(() => onJump(10))}>
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
              disabled={transportLocked}
              onToggle={() => setOpenMenu(value => value === "audio" ? null : "audio")}
              onClose={() => setOpenMenu(null)}
            />
            <SubtitleMenu
              label={subtitlesLoading ? "Cargando subtítulos" : "Subtítulos"}
              selectedSubtitleValue={selectedSubtitleValue}
              subtitleOptions={[{ value: "", label: subtitlesLoading ? "Cargando subtítulos..." : "Apagado" }, ...subtitleOptions]}
              open={openMenu === "subtitles"}
              disabled={transportLocked}
              subtitleDelayMs={subtitleDelayMs}
              subtitleScalePercent={subtitleScalePercent}
              subtitleVerticalPercent={subtitleVerticalPercent}
              onToggle={() => setOpenMenu(value => value === "subtitles" ? null : "subtitles")}
              onClose={() => setOpenMenu(null)}
              onSubtitleChange={onSubtitleChange}
              onSubtitleDelayChange={onSubtitleDelayChange}
              onSubtitleScaleChange={onSubtitleScaleChange}
              onSubtitleVerticalChange={onSubtitleVerticalChange}
              onOpenSubtitleSync={onOpenSubtitleSync}
            />
            <IconMenu
              id="speed"
              label="Velocidad"
              icon={<TimerReset size={17} />}
              value={selectedSpeed}
              options={speedOptions.map(option => ({ value: option, label: `${option}x` }))}
              onChange={onSpeedChange}
              open={openMenu === "speed"}
              disabled={transportLocked}
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
              disabled={transportLocked}
              onToggle={() => setOpenMenu(value => value === "video-enhancements" ? null : "video-enhancements")}
              onClose={() => setOpenMenu(null)}
            />

            <IconButton
              label={videoScaleMode === "crop" ? "Recortar" : "Original"}
              disabled={transportLocked}
              onClick={() => runControlAction(onToggleVideoScale)}
            >
              <Crop size={18} />
            </IconButton>
            {canChangeSource ? (
              <IconButton
                label={activeSidePanel === "sources" ? "Cerrar fuentes" : "Fuentes"}
                disabled={transportLocked}
                onClick={() => runControlAction(onToggleSourcePanel)}
              >
                <Radio size={18} />
              </IconButton>
            ) : null}

            {showPanelToggle && (
              <button
                onClick={() => runControlAction(onToggleEpisodePanel)}
                disabled={transportLocked}
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
                  disabled={transportLocked || !canGoPrevEpisode}
                >
                  <ChevronLeft size={18} />
                </IconButton>
                <IconButton
                  label="Episodio siguiente"
                  onClick={() => runControlAction(() => onNavigateEpisode("next"))}
                  disabled={transportLocked || !canGoNextEpisode}
                >
                  <ChevronRight size={18} />
                </IconButton>
              </>
            )}

            {showPartyButton ? (
              <PartyMenu
                open={openMenu === "party"}
                onToggle={() => setOpenMenu(value => value === "party" ? null : "party")}
                onClose={() => setOpenMenu(null)}
                connected={partyConnected}
                peerCount={partyPeerCount}
                currentMedia={partyCurrentMedia}
                currentTitle={partyCurrentTitle}
                streamFailed={partyStreamFailed}
                onRetryStream={onPartyRetryStream}
              />
            ) : null}

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
  onOpenSubtitleSync,
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
  onOpenSubtitleSync: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = subtitleOptions.find(option => option.value === selectedSubtitleValue);
  const initialLanguage = selectedOption ? subtitleLanguageKey(selectedOption) : "off";
  const [selectedLanguage, setSelectedLanguage] = useState(initialLanguage);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (!open) return;
    setSelectedLanguage(initialLanguage);
  }, [initialLanguage, open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const el = menuRef.current;
    if (!el) {
      setMounted(false);
      return;
    }
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.to(el, { opacity: 0, duration: 0.18, ease: "power1.out", overwrite: "auto", onComplete: () => setMounted(false) });
      return;
    }
    // §3/§4 spring exit anchored, interruptible
    const anchor = buttonRef.current;
    if (anchor) {
      const aRect = anchor.getBoundingClientRect();
      const mRect = el.getBoundingClientRect();
      const origin = anchorTransformOrigin(aRect, mRect.left, mRect.top, mRect.width, mRect.height);
      gsap.set(el, { transformOrigin: origin });
    }
    springTo(el, {
      xPercent: -50,
      opacity: 0,
      y: 8,
      scale: 0.98,
      filter: "blur(6px)",
    } as unknown as gsap.TweenVars, { damping: 1.0, duration: 0.28 });
    gsap.delayedCall(0.30, () => { if (!open) setMounted(false); });
  }, [open]);

  useEffect(() => {
    if (!open || !mounted || !menuRef.current) return;
    const el = menuRef.current;
    // §7 anchor origin to trigger button
    const anchor = buttonRef.current;
    if (anchor) {
      const aRect = anchor.getBoundingClientRect();
      // position is centered left 50%, compute origin after mount
      const mRect = el.getBoundingClientRect();
      const origin = anchorTransformOrigin(aRect, mRect.left, mRect.top, mRect.width, mRect.height);
      gsap.set(el, { transformOrigin: origin });
    }
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { xPercent: -50, opacity: 0 });
      gsap.to(el, { xPercent: -50, opacity: 1, duration: 0.2, ease: "power1.out", overwrite: "auto" });
      return;
    }
    gsap.set(el, { xPercent: -50, opacity: 0, y: 10, scale: 0.98, filter: "blur(8px)" });
    springTo(el, { xPercent: -50, opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: 0.36 });
  }, [open, mounted]);

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
        onPointerDown={e => {
          if (disabled) return;
          gsap.killTweensOf(e.currentTarget);
          gsap.to(e.currentTarget, { scale: 0.96, duration: 0.1, ease: "power2.out", overwrite: "auto" });
        }}
        onPointerUp={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        onPointerLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition will-change-transform active:scale-[0.96] ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        style={{ transform: "translateZ(0)", willChange: "transform, background-color" }}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Captions size={17} />
      </button>
      {mounted && !disabled
        ? createPortal(
            <div
              ref={menuRef}
              data-player-subtitle-panel-glass
              data-player-floating-panel-glass
              role="dialog"
              aria-label="Subtítulos"
              className="fixed left-1/2 z-[60] flex w-[min(760px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[24px] text-white will-change-transform"
              style={{
                ...getContextGlassStyle(),
                bottom: "calc(100vh - var(--aetherio-player-controls-top, 80vh) + 12px)",
                height: "min(470px, calc(var(--aetherio-player-controls-top, 80vh) - var(--app-safe-top, 0px) - 86px))",
                minHeight: 300,
                willChange: "transform, opacity, filter",
                transform: "translateZ(0)",
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
                    onDecrease={() => onSubtitleDelayChange(subtitleDelayMs - SUBTITLE_DELAY_STEP_MS)}
                    onIncrease={() => onSubtitleDelayChange(subtitleDelayMs + SUBTITLE_DELAY_STEP_MS)}
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
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenSubtitleSync();
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs font-semibold text-white/84 gsap-transition hover:bg-white/[0.1] hover:text-white"
                >
                  <TimerReset size={13} />
                  Sincronizar línea
                </button>
              </div>
            </section>
            </div>
          </div>,
            document.body,
          )
        : null}
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
      onPointerDown={e => {
        if (disabled) return;
        // §1 Response on pointer-down instant
        gsap.killTweensOf(e.currentTarget);
        gsap.to(e.currentTarget, { scale: 0.96, duration: 0.1, ease: "power2.out", overwrite: "auto" });
      }}
      onPointerUp={e => {
        if (disabled) return;
        gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" });
      }}
      onPointerLeave={e => {
        gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" });
      }}
      className={`flex items-center justify-center rounded-full border border-white/[0.07] bg-white/10 text-white gsap-transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-35 active:scale-[0.96] will-change-transform ${
        large ? "h-11 w-11" : "h-10 w-10"
      }`}
      style={{ transform: "translateZ(0)", willChange: "transform, background-color" }}
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
        onPointerDown={e => {
          if (disabled) return;
          gsap.killTweensOf(e.currentTarget);
          gsap.to(e.currentTarget, { scale: 0.96, duration: 0.1, ease: "power2.out", overwrite: "auto" });
        }}
        onPointerUp={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        onPointerLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition will-change-transform active:scale-[0.96] ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        style={{ transform: "translateZ(0)", willChange: "transform, background-color" }}
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

function PartyMenu({
  open,
  onToggle,
  onClose,
  connected,
  peerCount,
  currentMedia,
  currentTitle,
  streamFailed,
  onRetryStream,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  connected: boolean;
  peerCount: number;
  currentMedia: PartyMedia | null;
  currentTitle: string;
  streamFailed: boolean;
  onRetryStream: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const MENU_WIDTH = 480;

  // §7 — anclado al botón (above-end, como los demás menús de la barra), nunca centrado.
  useEffect(() => {
    if (!open || !mounted || !buttonRef.current || !menuRef.current) return;
    const updatePosition = () => {
      const anchor = buttonRef.current;
      const el = menuRef.current;
      if (!anchor || !el) return;
      const aRect = anchor.getBoundingClientRect();
      const menuWidth = MENU_WIDTH;
      const menuHeight = el.offsetHeight || 440;
      const margin = 10;
      let left = aRect.right - menuWidth;
      if (left < margin) left = Math.min(window.innerWidth - menuWidth - margin, Math.max(margin, aRect.right - menuWidth));
      if (left + menuWidth > window.innerWidth - margin) left = window.innerWidth - menuWidth - margin;
      const controlsTop = document
        .querySelector<HTMLElement>("[data-player-controls-glass]")
        ?.getBoundingClientRect().top;
      const upperBoundary = controlsTop === undefined ? aRect.top : Math.min(aRect.top, controlsTop);
      const top = Math.max(margin, upperBoundary - menuHeight - 12);
      setPosition({ left, top });
    };
    updatePosition();
    const t = window.setTimeout(updatePosition, 40);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, mounted]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const el = menuRef.current;
    if (!el) {
      setMounted(false);
      return;
    }
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.to(el, { opacity: 0, duration: 0.18, ease: "power1.out", overwrite: "auto", onComplete: () => setMounted(false) });
      return;
    }
    // §3/§4 spring exit anchored, interruptible
    const anchor = buttonRef.current;
    if (anchor) {
      const aRect = anchor.getBoundingClientRect();
      const mRect = el.getBoundingClientRect();
      const origin = anchorTransformOrigin(aRect, mRect.left, mRect.top, mRect.width, mRect.height);
      gsap.set(el, { transformOrigin: origin });
    }
    springTo(el, {
      opacity: 0,
      y: 8,
      scale: 0.98,
      filter: "blur(6px)",
    } as unknown as gsap.TweenVars, { damping: 1.0, duration: 0.28 });
    gsap.delayedCall(0.30, () => { if (!open) setMounted(false); });
  }, [open]);

  useEffect(() => {
    if (!open || !mounted || !menuRef.current) return;
    const el = menuRef.current;
    // §7 anchor origin to trigger button
    const anchor = buttonRef.current;
    if (anchor) {
      const aRect = anchor.getBoundingClientRect();
      const mRect = el.getBoundingClientRect();
      const origin = anchorTransformOrigin(aRect, mRect.left, mRect.top, mRect.width, mRect.height);
      gsap.set(el, { transformOrigin: origin });
    }
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 0 });
      gsap.to(el, { opacity: 1, duration: 0.2, ease: "power1.out", overwrite: "auto" });
      return;
    }
    gsap.set(el, { opacity: 0, y: 10, scale: 0.98, filter: "blur(8px)" });
    springTo(el, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } as unknown as gsap.TweenVars, { damping: 1.0, duration: 0.36 });
  }, [open, mounted]);

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

  return (
    <div className="relative" data-player-menu data-menu-id="party">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        onPointerDown={e => {
          gsap.killTweensOf(e.currentTarget);
          gsap.to(e.currentTarget, { scale: 0.96, duration: 0.1, ease: "power2.out", overwrite: "auto" });
        }}
        onPointerUp={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        onPointerLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        className={`relative flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition will-change-transform active:scale-[0.96] ${
          open || connected ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15"
        }`}
        style={{ transform: "translateZ(0)", willChange: "transform, background-color" }}
        title={connected ? "Party: sala activa" : "Party: ver juntos"}
        aria-label={connected ? "Party: sala activa" : "Party: ver juntos"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Users size={17} />
        {connected && peerCount > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-black text-black">
            {peerCount}
          </span>
        ) : null}
      </button>
      {mounted
        ? createPortal(
            <div
              ref={menuRef}
              data-player-party-panel-glass
              data-player-floating-panel-glass
              role="dialog"
              aria-label="Party"
              className="fixed z-[60] flex w-[min(480px,calc(100vw-32px))] flex-col overflow-hidden rounded-[24px] text-white will-change-transform"
              style={{
                ...getContextGlassStyle(),
                left: position.left,
                top: position.top,
                width: "min(480px, calc(100vw - 32px))",
                maxHeight: "calc(var(--aetherio-player-controls-top, 80vh) - var(--app-safe-top, 0px) - 86px)",
                minHeight: 320,
                willChange: "transform, opacity, filter",
                transform: "translateZ(0)",
              }}
            >
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.08] px-5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Users size={18} className="shrink-0 text-white/72" />
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Party</h3>
                    <p className="truncate text-xs text-white/48">
                      {connected ? `${peerCount} en la sala` : (currentTitle || "Ver juntos")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/64 gsap-transition hover:bg-white/10 hover:text-white"
                  aria-label="Cerrar Party"
                  title="Cerrar"
                >
                  <X size={17} />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-5">
                <PartyPanel
                  currentMedia={currentMedia}
                  currentTitle={currentTitle}
                  streamFailed={streamFailed}
                  onRetryStream={onRetryStream}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
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
        onPointerDown={e => {
          if (disabled) return;
          gsap.killTweensOf(e.currentTarget);
          gsap.to(e.currentTarget, { scale: 0.96, duration: 0.1, ease: "power2.out", overwrite: "auto" });
        }}
        onPointerUp={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        onPointerLeave={e => gsap.to(e.currentTarget, { scale: 1, duration: 0.14, ease: "power2.out", overwrite: "auto" })}
        className={`flex h-10 w-10 items-center justify-center rounded-full border text-white gsap-transition will-change-transform active:scale-[0.96] ${
          open ? "border-white/[0.12] bg-white/18" : "border-white/[0.07] bg-white/10 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35"
        }`}
        style={{ transform: "translateZ(0)", willChange: "transform, background-color" }}
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
  if (option.sourceLabel?.trim()) {
    let s = option.sourceLabel.trim();
    // Sanea "captura" y artefactos "TO AI" que aparecen truncados en capturas
    s = s.replace(/\b(captura|capture|TO\s*AI|TO\s*AI\s*captura)\b/gi, "").trim();
    s = s.replace(/\s{2,}/g, " ").replace(/^[·\-–—\s]+|[·\-–—\s]+$/g, "");
    if (s) return s;
  }
  if (!option.value) return "Ninguno";
  if (option.value.startsWith("track:")) return "Embebido";
  return "Externo";
}

function clipSubtitleLabel(label: string) {
  let trimmed = label.trim();
  // Elimina fragmentos tipo "captura" y "TO AI" antes de truncar para no dejar letras huérfanas
  trimmed = trimmed.replace(/\b(captura|capture)\b/gi, "").replace(/\bTO\s*AI\b/gi, "").replace(/\s{2,}/g, " ").trim();
  // Limpia separadores huérfanos tipo " - - "
  trimmed = trimmed.replace(/\s*-\s*-\s*/g, " - ").replace(/^[·\-–—\s]+|[·\-–—\s]+$/g, "").trim();
  if (trimmed.length <= 34) return trimmed || "Subtítulo";
  // Trunca por palabra para no dejar tokens tipo "TO" "AI" aislados
  const slice = trimmed.slice(0, 34);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 18) return `${slice.slice(0, lastSpace).trim()}...`;
  return `${slice.trim()}...`;
}

function formatDelay(valueMs: number) {
  if (!valueMs) return "--";
  const seconds = valueMs / 1000;
  return `${seconds > 0 ? "+" : ""}${seconds.toFixed(2)}s`;
}
