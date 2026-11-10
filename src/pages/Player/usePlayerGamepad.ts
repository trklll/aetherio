import { useEffect, useRef } from "react";
import {
  GAMEPAD_ACTION_EVENT,
  type GamepadActionId,
} from "../../hooks/useGamepad.ts";
import {
  resolvePlayerGamepadAction,
} from "./playerGamepadMap.ts";
import type { PlayerFeedbackKind } from "./PlayerActionFeedback";

interface UsePlayerGamepadOptions {
  enabled?: boolean;
  transportLocked: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  hasEpisodesPanel: boolean;
  volume: number;
  playing: boolean;
  /** true cuando no hay menú, panel lateral ni diálogo de sync abiertos. */
  isDirectMode: () => boolean;
  /** Barra abierta por el mando: cruceta y A navegan, B sale de la barra. */
  controlsMode: boolean;
  /** Zona enfocada en la barra de Big Picture. */
  barZone: "timeline" | "buttons" | "episodes";
  previewActive: boolean;
  postPlay?: {
    focused: () => boolean;
    activate: () => void;
    dismiss: () => void;
    focus: (target: "play" | "cancel") => void;
  };
  /** true cuando hay un segmento de intro/resumen/outro accionable. */
  skipAvailable: () => boolean;
  skipSegment: () => void;
  openControls: () => void;
  exitControls: () => void;
  focusBarTimeline: () => void;
  focusBarButtons: () => void;
  closeEpisodeRow: () => void;
  moveBarButton: (dir: "prev" | "next") => void;
  activateFocusedControl: () => void;
  togglePlay: () => void;
  jump: (offset: number) => void;
  previewSeek: (offset: number) => void;
  confirmPreview: () => void;
  cancelPreview: () => void;
  applyVolume: (value: number) => void;
  flash: (kind: PlayerFeedbackKind, extra?: { deltaSeconds?: number; volume?: number }) => void;
  navigateEpisode: (direction: "prev" | "next") => void;
  openSubtitles: () => void;
  openEpisodesOrSources: () => void;
  /** Cierra el overlay superior; devuelve true si cerró algo. */
  closeTopOverlay: () => boolean;
}

function isBigPicturePlayerPath(): boolean {
  try {
    return window.location.pathname.startsWith("/big-picture/player");
  } catch {
    return false;
  }
}

/**
 * Control específico del mando en `/big-picture/player`.
 * Reclama la acción normalizada del mando (preventDefault) antes de que el
 * polling la convierta en teclado sintético; fuera de Big Picture o con un
 * overlay abierto (salvo B) deja pasar el flujo global existente.
 */
export function usePlayerGamepad(options: UsePlayerGamepadOptions) {
  const ref = useRef(options);
  ref.current = options;

  useEffect(() => {
    const onAction = (event: Event) => {
      const current = ref.current;
      if (current.enabled === false) return;
      if (!isBigPicturePlayerPath()) return;
      const custom = event as CustomEvent<{ id?: GamepadActionId }>;
      const id = custom.detail?.id;
      if (!id) return;

      const outcome = resolvePlayerGamepadAction(id, {
        directMode: current.isDirectMode(),
        transportLocked: current.transportLocked,
        canGoPrevEpisode: current.canGoPrevEpisode,
        canGoNextEpisode: current.canGoNextEpisode,
        hasEpisodesPanel: current.hasEpisodesPanel,
        skipAvailable: current.skipAvailable(),
        controlsMode: current.controlsMode,
        zone: current.barZone,
        previewActive: current.previewActive,
        postPlayFocused: current.postPlay?.focused() ?? false,
      });
      if (!outcome) return;

      switch (outcome.type) {
        case "activate-post-play":
          current.postPlay?.activate();
          event.preventDefault();
          return;
        case "dismiss-post-play":
          current.postPlay?.dismiss();
          event.preventDefault();
          return;
        case "focus-post-play":
          current.postPlay?.focus(outcome.target);
          event.preventDefault();
          return;
        case "toggle": {
          const wasPlaying = current.playing;
          current.togglePlay();
          current.flash(wasPlaying ? "pause" : "play");
          event.preventDefault();
          return;
        }
        case "seek": {
          current.jump(outcome.offset);
          current.flash(outcome.offset >= 0 ? "forward" : "rewind", {
            deltaSeconds: outcome.offset,
          });
          event.preventDefault();
          return;
        }
        case "preview-seek":
          current.previewSeek(outcome.offset);
          event.preventDefault();
          return;
        case "confirm-preview":
          current.confirmPreview();
          event.preventDefault();
          return;
        case "cancel-preview":
          current.cancelPreview();
          event.preventDefault();
          return;
        case "volume": {
          const next = Math.min(2, Math.max(0, current.volume + outcome.delta));
          current.applyVolume(next);
          current.flash("volume", { volume: next });
          event.preventDefault();
          return;
        }
        case "prev-episode":
          current.navigateEpisode("prev");
          event.preventDefault();
          return;
        case "next-episode":
          current.navigateEpisode("next");
          event.preventDefault();
          return;
        case "open-subtitles":
          current.openSubtitles();
          event.preventDefault();
          return;
        case "open-episodes":
          current.openEpisodesOrSources();
          event.preventDefault();
          return;
        case "skip-segment":
          current.skipSegment();
          current.flash("forward");
          event.preventDefault();
          return;
        case "open-controls":
          current.openControls();
          event.preventDefault();
          return;
        case "exit-controls":
          current.exitControls();
          event.preventDefault();
          return;
        case "zone-buttons":
          current.focusBarButtons();
          event.preventDefault();
          return;
        case "close-episode-row":
          current.closeEpisodeRow();
          event.preventDefault();
          return;
        case "zone-timeline":
          current.focusBarTimeline();
          event.preventDefault();
          return;
        case "move-button":
          current.moveBarButton(outcome.dir);
          event.preventDefault();
          return;
        case "activate-focused":
          current.activateFocusedControl();
          event.preventDefault();
          return;
        case "ignore":
          // Consumida en silencio: sin acción y sin flecha sintética.
          event.preventDefault();
          return;
        case "close-overlay":
          if (current.closeTopOverlay()) event.preventDefault();
          return;
        default:
          return;
      }
    };

    window.addEventListener(GAMEPAD_ACTION_EVENT, onAction);
    return () => window.removeEventListener(GAMEPAD_ACTION_EVENT, onAction);
  }, []);
}
