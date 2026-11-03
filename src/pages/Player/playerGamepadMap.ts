import type { GamepadActionId } from "../../hooks/useGamepad.ts";

export interface PlayerGamepadContext {
  /** true = sin overlay (menú, panel lateral o sync cerrados): cruceta y A directos. */
  directMode: boolean;
  /** Party lobby u otro bloqueo: sin seek, play ni episodios (el volumen sigue vivo). */
  transportLocked: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  /** Y puede abrir la fila inline de episodios. */
  hasEpisodesPanel: boolean;
  /** Segmento de intro/resumen/outro visible y accionable (auto-foco). */
  skipAvailable: boolean;
  /** Barra en modo de navegación con D-pad/teclas: timeline, controles o episodios. */
  controlsMode: boolean;
  /** Zona activa de la barra: timeline, controles o fila de episodios. */
  zone: "timeline" | "buttons" | "episodes";
  /** Hay un destino temporal provisional esperando confirmación. */
  previewActive: boolean;
  /** El aviso de siguiente episodio tiene dos controles, fuera de la barra. */
  postPlayFocused?: boolean;
  postPlayAvailable?: boolean;
}

export type PlayerGamepadOutcome =
  | { type: "activate-post-play" }
  | { type: "dismiss-post-play" }
  | { type: "focus-post-play"; target: "play" | "cancel" }
  | { type: "toggle" }
  | { type: "seek"; offset: number }
  | { type: "preview-seek"; offset: number }
  | { type: "confirm-preview" }
  | { type: "cancel-preview" }
  | { type: "volume"; delta: number }
  | { type: "prev-episode" }
  | { type: "next-episode" }
  | { type: "open-subtitles" }
  | { type: "open-episodes" }
  | { type: "activate-focused" }
  | { type: "skip-segment" }
  | { type: "open-controls" }
  | { type: "exit-controls" }
  | { type: "zone-buttons" }
  | { type: "close-episode-row" }
  | { type: "zone-timeline" }
  | { type: "move-button"; dir: "prev" | "next" }
  | { type: "ignore" }
  | { type: "close-overlay" };

export const PLAYER_SEEK_STEP_S = 10;
export const PLAYER_SEEK_LONG_S = 30;
export const PLAYER_VOLUME_STEP = 0.05;

/** Flechas y Escape del teclado usan las mismas acciones que D-pad y B. */
export function playerGamepadActionForKeyboardKey(key: string): GamepadActionId | null {
  switch (key) {
    case "ArrowLeft": return "dpad-left";
    case "ArrowRight": return "dpad-right";
    case "ArrowUp": return "dpad-up";
    case "ArrowDown": return "open-controls";
    case "Escape": return "back";
    default: return null;
  }
}

/**
 * Mapa puro del mando en `/big-picture/player` (Big Picture PC).
 * Sin DOM ni efectos: decide qué hace cada botón según el contexto.
 */
export function resolvePlayerGamepadAction(
  id: GamepadActionId,
  ctx: PlayerGamepadContext,
): PlayerGamepadOutcome | null {
  if (ctx.directMode && ctx.previewActive && id === "back") return { type: "cancel-preview" };

  // Con overlay abierto la cruceta y A vuelven a la navegación espacial
  // (el polling del mando los deja pasar como flechas/Enter). B cierra.
  if (!ctx.directMode) {
    if (id === "back") return { type: "close-overlay" };
    return null;
  }

  if (ctx.postPlayFocused) {
    if (id === "confirm") return ctx.transportLocked ? null : { type: "activate-post-play" };
    if (id === "back") return { type: "dismiss-post-play" };
    if (id === "dpad-left") return { type: "focus-post-play", target: "play" };
    if (id === "dpad-right") return { type: "focus-post-play", target: "cancel" };
    if (id === "dpad-up" || id === "dpad-down" || id === "open-controls") return { type: "open-controls" };
  }

  if (ctx.controlsMode && ctx.zone === "timeline" && ctx.previewActive && id === "confirm") {
    return { type: "confirm-preview" };
  }

  // Con segmento visible, A omite intro/resumen/outro (el botón ya tomó foco
  // solo); no alterna play/pausa. Bloqueado en lobby como el resto del transporte.
  if (id === "confirm" && ctx.skipAvailable && !ctx.transportLocked) {
    return { type: "skip-segment" };
  }

  // En timeline izquierda/derecha hacen seek, arriba enfoca controles y abajo
  // entra a episodios. En controles, arriba cierra la barra y abajo entra a
  // episodios. La fila se recorre horizontalmente; arriba o B la cierra.
  // X/Y/LB/RB/LT/RT siguen vivos en ambas zonas.
  if (ctx.controlsMode) {
    if (ctx.zone === "timeline") {
      if (id === "back") return { type: "exit-controls" };
      if (id === "dpad-left") {
        return ctx.transportLocked ? null : { type: "preview-seek", offset: -PLAYER_SEEK_STEP_S };
      }
      if (id === "dpad-right") {
        return ctx.transportLocked ? null : { type: "preview-seek", offset: PLAYER_SEEK_STEP_S };
      }
      if (id === "confirm") {
        return ctx.transportLocked ? null : { type: "toggle" };
      }
      if (id === "dpad-up") return { type: "zone-buttons" };
      // El polling normaliza la cruceta abajo como `open-controls`.
      if (id === "dpad-down" || id === "open-controls") return ctx.hasEpisodesPanel ? { type: "open-episodes" } : null;
      // X/Y/LT/RT/LB/RB caen al switch general (siguen vivos en el timeline).
    } else if (ctx.zone === "episodes") {
      // La fila vive dentro de la barra, así que arriba/B la colapsan en lugar
      // de salir; abajo se consume para no escapar a controles exteriores.
      if (id === "back") return { type: "close-episode-row" };
      if (id === "dpad-up") return { type: "close-episode-row" };
      if (id === "dpad-down" || id === "open-controls") return { type: "ignore" };
      if (id === "dpad-left") return { type: "move-button", dir: "prev" };
      if (id === "dpad-right") return { type: "move-button", dir: "next" };
      if (id === "confirm") return { type: "activate-focused" };
      return null;
    } else {
      if (id === "dpad-up") return { type: "exit-controls" };
      if (id === "dpad-down" || id === "open-controls") return ctx.hasEpisodesPanel ? { type: "open-episodes" } : null;
      if (id === "dpad-left") return { type: "move-button", dir: "prev" };
      if (id === "dpad-right") return { type: "move-button", dir: "next" };
      if (id === "back") return { type: "exit-controls" };
      return null;
    }
  }

  switch (id) {
    case "confirm":
      return ctx.transportLocked ? null : { type: "toggle" };
    case "open-controls":
      return ctx.transportLocked ? null : { type: "open-controls" };
    case "dpad-left":
      return ctx.transportLocked ? null : { type: "seek", offset: -PLAYER_SEEK_STEP_S };
    case "dpad-right":
      return ctx.transportLocked ? null : { type: "seek", offset: PLAYER_SEEK_STEP_S };
    // Arriba no hace nada (el volumen vive en LB/RB): se consume en silencio
    // para que no caiga una flecha sintética que movería el foco.
    case "dpad-up":
      return { type: "ignore" };
    case "lt":
      return ctx.transportLocked ? null : { type: "seek", offset: -PLAYER_SEEK_LONG_S };
    case "rt":
      return ctx.transportLocked ? null : { type: "seek", offset: PLAYER_SEEK_LONG_S };
    // Volumen solo con bumpers (sigue vivo en lobby como antes).
    case "lb":
      return { type: "volume", delta: -PLAYER_VOLUME_STEP };
    case "rb":
      return { type: "volume", delta: PLAYER_VOLUME_STEP };
    case "x":
      return { type: "open-subtitles" };
    case "y":
      return ctx.hasEpisodesPanel
        ? { type: "open-episodes" }
        : null;
    case "back":
      // Sin overlay, B sigue el flujo global (volver atrás).
      return null;
    default:
      return null;
  }
}
