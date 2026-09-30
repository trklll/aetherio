import type { GamepadActionId } from "../../hooks/useGamepad.ts";

export interface PlayerGamepadContext {
  /** true = sin overlay (menú, panel lateral o sync cerrados): cruceta y A directos. */
  directMode: boolean;
  /** Party lobby u otro bloqueo: sin seek, play ni episodios (el volumen sigue vivo). */
  transportLocked: boolean;
  canGoPrevEpisode: boolean;
  canGoNextEpisode: boolean;
  /** Y puede abrir el panel de episodios. */
  hasEpisodesPanel: boolean;
  /** Y puede abrir el panel de fuentes cuando no hay episodios. */
  hasSourcesPanel: boolean;
  /** Segmento de intro/resumen/outro visible y accionable (auto-foco). */
  skipAvailable: boolean;
  /**
   * Barra de reproducción abierta por el mando: el stick izquierdo/cruceta y
   * A pertenecen a la navegación espacial (no actúan); B sale de la barra.
   */
  controlsMode: boolean;
  /**
   * Zona de la barra: `timeline` (foco inicial; izquierda/derecha = seek,
   * A = play/pausa, bajar = ir a los botones) o `buttons` (navegación
   * exclusiva con wrap; arriba = volver al timeline, bajar = salir).
   */
  zone: "timeline" | "buttons";
}

export type PlayerGamepadOutcome =
  | { type: "toggle" }
  | { type: "seek"; offset: number }
  | { type: "volume"; delta: number }
  | { type: "prev-episode" }
  | { type: "next-episode" }
  | { type: "open-subtitles" }
  | { type: "open-episodes-or-sources" }
  | { type: "skip-segment" }
  | { type: "open-controls" }
  | { type: "exit-controls" }
  | { type: "zone-buttons" }
  | { type: "zone-timeline" }
  | { type: "move-button"; dir: "prev" | "next" }
  | { type: "ignore" }
  | { type: "close-overlay" };

export const PLAYER_SEEK_STEP_S = 10;
export const PLAYER_SEEK_LONG_S = 30;
export const PLAYER_VOLUME_STEP = 0.05;

/**
 * Mapa puro del mando en `/big-picture/player` (Big Picture PC).
 * Sin DOM ni efectos: decide qué hace cada botón según el contexto.
 */
export function resolvePlayerGamepadAction(
  id: GamepadActionId,
  ctx: PlayerGamepadContext,
): PlayerGamepadOutcome | null {
  // Con overlay abierto la cruceta y A vuelven a la navegación espacial
  // (el polling del mando los deja pasar como flechas/Enter). B cierra.
  if (!ctx.directMode) {
    if (id === "back") return { type: "close-overlay" };
    return null;
  }

  // Con segmento visible, A omite intro/resumen/outro (el botón ya tomó foco
  // solo); no alterna play/pausa. Bloqueado en lobby como el resto del transporte.
  if (id === "confirm" && ctx.skipAvailable && !ctx.transportLocked) {
    return { type: "skip-segment" };
  }

  // En la barra hay dos zonas explícitas (no dependen del foco DOM): el
  // timeline (foco inicial al bajar) y la row de botones (se llega bajando
  // otra vez). En el timeline, izquierda/derecha adelantan/retroceden y A
  // alterna play/pausa; en la row, izquierda/derecha navega con wrap
  // circular, arriba vuelve al timeline y bajar sale. B sale siempre.
  // X/Y/LB/RB/LT/RT siguen vivos en ambas zonas.
  if (ctx.controlsMode) {
    if (id === "back") return { type: "exit-controls" };
    if (ctx.zone === "timeline") {
      if (id === "dpad-left") {
        return ctx.transportLocked ? null : { type: "seek", offset: -PLAYER_SEEK_STEP_S };
      }
      if (id === "dpad-right") {
        return ctx.transportLocked ? null : { type: "seek", offset: PLAYER_SEEK_STEP_S };
      }
      if (id === "confirm") {
        return ctx.transportLocked ? null : { type: "toggle" };
      }
      if (id === "open-controls") return { type: "zone-buttons" };
      if (id === "dpad-up" || id === "dpad-down") return null;
      // X/Y/LT/RT/LB/RB caen al switch general (siguen vivos en el timeline).
    } else {
      if (id === "dpad-up") return { type: "zone-timeline" };
      if (id === "open-controls") return { type: "exit-controls" };
      if (id === "dpad-left") return { type: "move-button", dir: "prev" };
      if (id === "dpad-right") return { type: "move-button", dir: "next" };
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
      return ctx.hasEpisodesPanel || ctx.hasSourcesPanel
        ? { type: "open-episodes-or-sources" }
        : null;
    case "back":
      // Sin overlay, B sigue el flujo global (volver atrás).
      return null;
    default:
      return null;
  }
}
