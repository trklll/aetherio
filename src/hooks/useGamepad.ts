import { useEffect, useRef } from "react";
import { dispatchBackAction, dispatchDeleteCharInTextContext, dispatchSyntheticEscape } from "../input/inputActions.ts";

/**
 * Hook de mando estilo Steam Big Picture para Aetherio.
 *
 * - Usa la Gamepad API standard (Xbox por cable primero, luego cualquier otro).
 * - D-pad + stick izquierdo = flechas, A = Enter, B = Escape.
 * - Start(9) solo = alternar Big Picture <-> app normal. Es la ÚNICA vía con
 *   mando para cambiar de modo: el botón Guía/Xbox (16) NUNCA navega entre
 *   modos (Chrome/WebView2 además lo filtra en buttons[16]).
 * - Solo actúa cuando la página tiene foco; el despertar desde tray/minimizado
 *   lo hará el hilo nativo Rust (fase 3) emitiendo `aetherio-gamepad-wake`.
 */

export interface GamepadNavCallbacks {
  /** @deprecated Usar onStart. Se mantiene por compatibilidad. */
  onCombo?: () => void;
  /** Start (botón 9) pulsado: alternar Big Picture <-> normal. */
  onStart?: () => void;
  /** Botón Guía/Xbox (16) pulsado: NUNCA cambia de modo (solo exit-request). */
  onGuide?: () => void;
  enabled?: boolean;
}

/**
 * Acción normalizada del mando, emitida como evento cancelable en `window`
 * ANTES de sintetizar teclado. Un contexto (p. ej. el reproductor de Big
 * Picture) la reclama con `preventDefault()` y el polling omite el
 * `dispatchKey`/`Enter`/`Escape` sintético correspondiente: así no hay doble
 * disparo ni la navegación espacial recibe flechas que ya se consumieron.
 */
export const GAMEPAD_ACTION_EVENT = "aetherio-gamepad-action";

/**
 * "El usuario está usando el mando ahora mismo" (stick/D-pad movido o botón
 * pulsado). Lo consumen las superficies que derivan el modo del dispositivo de
 * entrada activo (p. ej. selección de perfil: mover el mando -> Big Picture y
 * cursor oculto; ratón/teclado -> modo normal y cursor visible).
 */
export const GAMEPAD_ACTIVITY_EVENT = "aetherio-gamepad-activity";

function signalGamepadActivity() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GAMEPAD_ACTIVITY_EVENT));
}

export type GamepadActionId =
  | "dpad-up"
  | "dpad-down"
  | "dpad-left"
  | "dpad-right"
  | "confirm"
  | "back"
  | "x"
  | "y"
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "open-controls";

export interface GamepadActionDetail {
  id: GamepadActionId;
  /** true cuando es repetición por mantener la dirección (cruceta/stick). */
  repeat?: boolean;
}

/** Emite la acción y devuelve true si algún listener la reclamó (preventDefault). */
export function dispatchGamepadAction(id: GamepadActionId, repeat = false): boolean {
  if (typeof window === "undefined") return false;
  const event = new CustomEvent<GamepadActionDetail>(GAMEPAD_ACTION_EVENT, {
    bubbles: false,
    cancelable: true,
    detail: { id, repeat },
  });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Gatillos LT/RT: `pressed` solo llega al fondo; el valor analógico avisa antes. */
export function isTriggerEngaged(button?: { pressed?: boolean; value?: number } | null): boolean {
  if (!button) return false;
  if (button.pressed) return true;
  return typeof button.value === "number" && button.value > 0.5;
}

const AXIS_DEADZONE = 0.45;
const STICK_REPEAT_MS = 220;
// Al mantener dirección el repeat acelera hasta este suelo (recorrer rows).
const STICK_REPEAT_MIN_MS = 70;
const STICK_REPEAT_ACCEL_MS = 30;

type Dir = "up" | "down" | "left" | "right";

function pickGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || !("getGamepads" in navigator)) return null;
  const pads = Array.from(navigator.getGamepads?.() ?? []);
  if (!pads.length) return null;
  const usable = pads.filter((p): p is Gamepad => Boolean(p?.connected));
  if (!usable.length) return null;
  // Xbox por cable/USB primero (decisión del usuario), luego el resto.
  const xbox = usable.find(p => /xbox/i.test(p.id));
  return xbox ?? usable[0];
}

function dispatchKey(key: string) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const init: KeyboardEventInit = { key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", init));
}

/**
 * Botón A con semántica de pulsación (down/up) en vez de Enter instantáneo:
 * la card destino decide entre abrir (corto) y opciones (mantenido 500ms,
 * estilo LongPressKeyTracker). La marca aetherioGamepadHold hace que
 * el motor espacial no clickee en el down (las cards lo gestionan).
 */
function dispatchGamepadKey(type: "keydown" | "keyup", key: string) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
  (event as KeyboardEvent & { aetherioGamepadHold?: boolean }).aetherioGamepadHold = true;
  target.dispatchEvent(event);
}

function isContextMenuOpen() {
  return typeof document !== "undefined"
    && document.querySelector("[data-aetherio-context-menu]") !== null;
}

export function isBigPictureActive() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("aetherio-big-picture");
}

export function useGamepad({ onCombo, onStart, onGuide, enabled = true }: GamepadNavCallbacks = {}) {
  const comboRef = useRef(onCombo);
  comboRef.current = onCombo;
  const startRef = useRef(onStart);
  startRef.current = onStart;
  const guideRef = useRef(onGuide);
  guideRef.current = onGuide;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let lastDir: Dir | null = null;
    let lastDirAt = 0;
    let dirHoldCount = 0;
    const prevButtons = new Map<number, boolean>();

    const pressedEdge = (pad: Gamepad, index: number) => {
      const raw = pad.buttons[index];
      const now = index === 6 || index === 7
        ? isTriggerEngaged(raw)
        : Boolean(raw?.pressed);
      const was = prevButtons.get(index) ?? false;
      prevButtons.set(index, now);
      const edge = now && !was;
      if (edge) signalGamepadActivity();
      return edge;
    };

    // A consumida por un contexto (reproductor): su keyup no debe clicar.
    let confirmConsumed = false;
    // Si el menú aparece durante el hold de A, el keyup pertenece a la
    // pulsación que lo abrió y no debe activar su primer elemento.
    let confirmMenuOpenAtDown = false;

    const poll = () => {
      raf = requestAnimationFrame(poll);
      if (!enabledRef.current) return;
      const pad = pickGamepad();
      if (!pad) {
        lastDir = null;
        return;
      }

      const now = performance.now();
      const btn = (i: number) => {
        if (i === 6 || i === 7) return isTriggerEngaged(pad.buttons[i]);
        return Boolean(pad.buttons[i]?.pressed);
      };
      const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];

      // Direcciones: D-pad (12-15) + stick izquierdo con deadzone.
      let dir: Dir | null = null;
      if (btn(12) || ay < -AXIS_DEADZONE) dir = "up";
      else if (btn(13) || ay > AXIS_DEADZONE) dir = "down";
      else if (btn(14) || ax < -AXIS_DEADZONE) dir = "left";
      else if (btn(15) || ax > AXIS_DEADZONE) dir = "right";

      if (dir) {
        // Un cambio de dirección (o la primera) es "el usuario está moviendo el
        // mando": lo consumen las superficies que derivan el modo del
        // dispositivo de entrada activo.
        if (dir !== lastDir) signalGamepadActivity();
        // Movimiento rápido al mantener: el intervalo baja de 220ms a 70ms
        // mientras se sostiene la misma dirección (recorrer rows enteras).
        const interval = dir === lastDir
          ? Math.max(STICK_REPEAT_MIN_MS, STICK_REPEAT_MS - dirHoldCount * STICK_REPEAT_ACCEL_MS)
          : 0;
        if (dir !== lastDir || now - lastDirAt > interval) {
          const repeat = dir === lastDir;
          if (repeat) dirHoldCount += 1;
          else dirHoldCount = 0;
          lastDir = dir;
          lastDirAt = now;
          // Abajo abre la barra del reproductor (el player la reclama en
          // modo directo; en la barra se deja pasar como flecha para navegar).
          // Arriba/izquierda/derecha mantienen su acción normalizada.
          const actionId: GamepadActionId =
            dir === "up" ? "dpad-up" : dir === "down" ? "open-controls" : dir === "left" ? "dpad-left" : "dpad-right";
          // El reproductor reclama sus acciones en modo directo; fuera de él
          // se mantiene el comportamiento actual (flechas sintéticas).
          if (dispatchGamepadAction(actionId, repeat)) return;
          const key = dir === "up" ? "ArrowUp" : dir === "down" ? "ArrowDown" : dir === "left" ? "ArrowLeft" : "ArrowRight";
          dispatchKey(key);
        }
      } else {
        lastDir = null;
        dirHoldCount = 0;
      }

      // A(0) = confirmar con down/up (corto = abrir, mantenido = opciones).
      // B(1) = atrás (acción central inputActions: implica Esc + Borrar
      // según contexto). Primero el Escape sintético legacy: si un modal lo
      // consume (preventDefault), no se emite la acción. Flanco, sin repeat.
      const aNow = btn(0);
      const aWas = prevButtons.get(0) ?? false;
      if (aNow && !aWas) {
        confirmMenuOpenAtDown = isContextMenuOpen();
        confirmConsumed = dispatchGamepadAction("confirm");
        if (!confirmConsumed) dispatchGamepadKey("keydown", "Enter");
      } else if (!aNow && aWas) {
        const menuOpenedDuringConfirm = !confirmMenuOpenAtDown && isContextMenuOpen();
        if (confirmConsumed) {
          confirmConsumed = false;
        } else if (!menuOpenedDuringConfirm) {
          dispatchGamepadKey("keyup", "Enter");
        }
        confirmMenuOpenAtDown = false;
      }
      prevButtons.set(0, aNow);
      if (pressedEdge(pad, 1)) {
        // B ya NO borra nunca: es siempre `back` (el borrado de carácter es
        // de X). Primero el Escape sintético legacy: si un modal lo consume
        // (preventDefault), no se emite la acción. Flanco, sin repeat.
        if (dispatchGamepadAction("back")) return;
        const notConsumed = dispatchSyntheticEscape();
        if (notConsumed) dispatchBackAction("gamepad");
      }
      // LB(4)/RB(5) como PageUp/PageDown para filas largas (útil en Home desktop).
      // En el reproductor Big Picture se reclaman como volumen -/+.
      if (pressedEdge(pad, 4)) {
        if (!dispatchGamepadAction("lb")) dispatchKey("PageUp");
      }
      if (pressedEdge(pad, 5)) {
        if (!dispatchGamepadAction("rb")) dispatchKey("PageDown");
      }
      // X(2) borra el último carácter SOLO con un teclado en pantalla montado
      // (Search/Party); fuera de él no hace nada. Antes de eso, la acción
      // normalizada la pueden reclamar otros contextos (reproductor: X =
      // subtítulos). Y(3) alterna ABC/123 en ese mismo teclado.
      // Gatillos LT(6)/RT(7): sin comportamiento global. Flanco.
      if (pressedEdge(pad, 2)) {
        if (!dispatchGamepadAction("x")) dispatchDeleteCharInTextContext("gamepad");
      }
      if (pressedEdge(pad, 3)) dispatchGamepadAction("y");
      if (pressedEdge(pad, 6)) dispatchGamepadAction("lt");
      if (pressedEdge(pad, 7)) dispatchGamepadAction("rt");
      // Start(9) solo (flanco) = ÚNICA vía para alternar Big Picture <->
      // app normal. No confirma, no repite al mantener.
      // View(8) solo no hace nada para no chocar con "atrás".
      if (pressedEdge(pad, 9)) {
        startRef.current?.();
        // Compat: los oyentes viejos de "combo" también alternan.
        comboRef.current?.();
        window.dispatchEvent(new CustomEvent("aetherio-gamepad-start"));
        window.dispatchEvent(new CustomEvent("aetherio-gamepad-combo"));
      }

      // Botón Guía/Xbox (16) best-effort: NUNCA cambia de modo.
      // Solo avisa para el exit-request (doble pulsación = salir de la app).
      if (pressedEdge(pad, 16)) {
        guideRef.current?.();
      }
    };

    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}

/** Lee el estado actual una vez (para la pantalla de verificación). */
export function readGamepadsSnapshot() {
  if (typeof navigator === "undefined" || !("getGamepads" in navigator)) return [];
  return Array.from(navigator.getGamepads?.() ?? [])
    .filter((p): p is Gamepad => Boolean(p))
    .map(p => ({
      id: p.id,
      index: p.index,
      mapping: p.mapping,
      connected: p.connected,
      buttons: p.buttons.length,
      axes: p.axes.length,
      guideExposed: p.buttons[16] !== undefined,
      guidePressed: Boolean(p.buttons[16]?.pressed),
    }));
}
