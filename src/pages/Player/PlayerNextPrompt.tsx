import { useEffect, useRef, useState, type RefObject } from "react";
import { Play, X } from "lucide-react";
import { advancePostPlayCountdown, POST_PLAY_COUNTDOWN_MS } from "./postPlayPrompt";

interface PlayerNextPromptProps {
  rootRef: RefObject<HTMLDivElement | null>;
  label: string;
  autoPlay: boolean;
  running: boolean;
  onPlay: () => void;
  onCancel: () => void;
  onControls: () => void;
}

export default function PlayerNextPrompt({ rootRef, label, autoPlay, running, onPlay, onCancel, onControls }: PlayerNextPromptProps) {
  const [elapsed, setElapsed] = useState(0);
  const firedRef = useRef(false);
  const playRef = useRef(onPlay);
  playRef.current = onPlay;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest("[data-player-controls-glass]")) return;
      rootRef.current?.querySelector<HTMLButtonElement>("[data-post-play-action='play']")?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [rootRef]);

  useEffect(() => {
    if (!autoPlay || !running) return;
    let lastTick = performance.now();
    let frame = 0;
    const tick = () => {
      const now = performance.now();
      // A sleeping/backgrounded window must not consume the whole countdown.
      const delta = document.visibilityState === "visible" ? Math.min(250, now - lastTick) : 0;
      lastTick = now;
      if (delta > 0) setElapsed(value => advancePostPlayCountdown(value, delta, true));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [autoPlay, running]);

  useEffect(() => {
    if (!autoPlay || !running || elapsed < POST_PLAY_COUNTDOWN_MS || firedRef.current) return;
    firedRef.current = true;
    playRef.current();
  }, [autoPlay, elapsed, running]);

  const activate = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onPlay();
  };
  return (
    <div
      ref={rootRef}
      data-player-post-play
      data-player-interactive
      className="player-next-prompt"
      role="group"
      aria-label={label}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          event.stopPropagation();
          rootRef.current?.querySelector<HTMLButtonElement>(`[data-post-play-action='${event.key === "ArrowLeft" ? "play" : "cancel"}']`)?.focus({ preventScroll: true });
        } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          event.stopPropagation();
          onControls();
        } else if (event.key === " " || event.key === "Enter") {
          event.stopPropagation();
        }
      }}
    >
      <span className="sr-only" role="status">
        {autoPlay ? `${label} en 12 segundos. Puedes cancelar la reproducción automática.` : label}
      </span>
      <button
        type="button"
        data-post-play-action="play"
        data-countdown-active={autoPlay ? "true" : "false"}
        className="bp-skip-button player-next-prompt__play"
        onClick={activate}
        aria-label={autoPlay ? `${label}, en ${Math.ceil((POST_PLAY_COUNTDOWN_MS - elapsed) / 1000)} segundos` : label}
      >
        {autoPlay ? <span aria-hidden="true" className="player-next-prompt__progress" style={{ transform: `scaleX(${elapsed / POST_PLAY_COUNTDOWN_MS})` }} /> : null}
        <span className="player-next-prompt__content"><Play aria-hidden="true" fill="currentColor" /><span>{label}</span></span>
      </button>
      <button
        type="button"
        data-post-play-action="cancel"
        data-player-control-glass
        className="player-next-prompt__cancel"
        onClick={onCancel}
        aria-label="Cancelar y seguir viendo"
        title="Cancelar y seguir viendo"
      ><X aria-hidden="true" /></button>
    </div>
  );
}
