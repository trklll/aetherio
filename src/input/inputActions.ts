/**
 * Tabla única de equivalencias mando ↔ teclado.
 *
 * REGLA DEL PROYECTO: nunca programes `pad.buttons[N]` ni `e.key === "Escape"`
 * directamente. Declara la acción aquí y consúmela con `useBackAction` /
 * `useTextBackAction`. Así, si el código dice que el botón B retrocede, eso
 * implica automáticamente Esc y Borrar en teclado.
 *
 * Mapa implementado (los huecos libres quedan reservados, sin comportamiento):
 *
 * | Acción        | Mando                    | Teclado              |
 * |---------------|--------------------------|----------------------|
 * | back          | B (botón 1)              | Esc                  |
 * | delete-char   | X (botón 2) en contexto de texto¹ | Borrar/Backspace |
 * | toggle-kb-mode| Y (botón 3)              | —                    |
 * | confirm       | A (botón 0)              | Enter (Espacio cards)|
 * | move          | D-pad 12-15 + stick izq. | Flechas              |
 * | page          | LB/RB (botones 4/5)      | PageUp/PageDown      |
 * | toggle-mode   | Start (botón 9)          | F10                  |
 * | exit-request  | Guía (botón 16) x2       | —                    |
 * |---------------|--------------------------------------------------|
 * | RESERVADOS sin comportamiento: LT/RT(6/7), View(8),      |
 * | L3/R3(10/11), stick derecho.                               |
 * + Reproductor Big Picture: abajo (cruceta/stick izq.) abre la barra
 *   (`open-controls`); arriba no hace nada; LB/RB = volumen -/+.
 *   X = subtítulos, Y = episodios/fuentes (por eso ambos son contextuales).
 *
 * ¹ Regla de contexto: el borrado de carácter es de X y SOLO con un teclado
 *    en pantalla montado (Search/Party): con texto → `delete-char`. Fuera de
 *    un contexto de texto X no hace nada, para no robarle la acción al
 *    reproductor. B ya NO borra nunca: B es siempre `back`, igual que Esc.
 *    El borrado físico (Borrar/Backspace) sí borra cuando hay texto.
 */

import { useEffect, useRef } from "react";

export type InputOrigin = "gamepad" | "keyboard";

/** Botones del mando ya implementados (standard mapping). */
export const GAMEPAD_BUTTON = {
  CONFIRM: 0, // A
  BACK: 1, // B — siempre atrás, nunca borra
  DELETE_CHAR: 2, // X — borra solo en contexto de texto (Search/Party)
  TOGGLE_KB_MODE: 3, // Y — teclado en pantalla: alterna ABC <-> 123
  PAGE_UP: 4, // LB
  PAGE_DOWN: 5, // RB
  // LT(6), RT(7), View(8) reservados.
  TOGGLE_MODE: 9, // Start/Menu
  // L3(10), R3(11) reservados.
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  GUIDE: 16, // Guía/Xbox
} as const;

/** Eventos de acción. El `back` del mando llega aquí (cancelable). */
export const INPUT_BACK_EVENT = "aetherio-input:back";
export const INPUT_DELETE_CHAR_EVENT = "aetherio-input:delete-char";

export interface InputActionDetail {
  action: "back" | "delete-char";
  origin: InputOrigin;
}

// ---------------------------------------------------------------------------
// Helpers de teclado
// ---------------------------------------------------------------------------

export function isEscapeKey(event: KeyboardEvent): boolean {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape";
}

export function isBackspaceKey(event: KeyboardEvent): boolean {
  return event.key === "Backspace" || event.code === "Backspace";
}

function isNativeTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName);
}

/** ¿El evento es un Escape/Backspace de teclado físico (no sintético)? */
export function isPhysicalBackKey(event: KeyboardEvent): boolean {
  if (!event.isTrusted) return false;
  return isEscapeKey(event) || isBackspaceKey(event);
}

// ---------------------------------------------------------------------------
// Override de contexto de texto (Borrar vs atrás)
//
// Las pantallas con teclado en pantalla (Search, Party) registran si tienen
// un contexto de texto activo. Lo consultan dos cosas: el botón X del mando
// (borra el último carácter solo aquí) y el back exterior, que ignora la
// tecla Borrar para no navegar mientras se está escribiendo. El valor es
// `true`/`false` con contexto montado y `null` sin él. Lectura síncrona (sin
// depender del orden de listeners) para que no haya doble disparo.
// ---------------------------------------------------------------------------

let backDeleteOverride: boolean | null = null;

/** `true` = hay texto que borrar; `false`/`null` = B actúa como atrás. */
export function setBackDeleteOverride(hasText: boolean | null): void {
  backDeleteOverride = hasText;
}

export function getBackDeleteOverride(): boolean | null {
  return backDeleteOverride;
}

// ---------------------------------------------------------------------------
// Despacho de acciones
// ---------------------------------------------------------------------------

function dispatchActionEvent(type: string, origin: InputOrigin): boolean {
  if (typeof window === "undefined") return true;
  const event = new CustomEvent<InputActionDetail>(type, {
    bubbles: false,
    cancelable: true,
    detail: { action: type === INPUT_DELETE_CHAR_EVENT ? "delete-char" : "back", origin },
  });
  return window.dispatchEvent(event);
}

/** Emite `back` (cancelable: un modal puede consumirlo con preventDefault). */
export function dispatchBackAction(origin: InputOrigin): boolean {
  return dispatchActionEvent(INPUT_BACK_EVENT, origin);
}

/** Emite `delete-char` (borrar un carácter en el contexto de texto activo). */
export function dispatchDeleteCharAction(origin: InputOrigin): boolean {
  return dispatchActionEvent(INPUT_DELETE_CHAR_EVENT, origin);
}

/**
 * X del mando en un contexto de texto (teclado en pantalla de Search/Party):
 * emite `delete-char`. Devuelve false si no hay contexto de texto montado, en
 * cuyo caso X no debe hacer nada — es preferible a un no-op silencioso que a
 * degradar X en "atrás" (el reproductor ya usa X para los subtítulos).
 */
export function dispatchDeleteCharInTextContext(origin: InputOrigin): boolean {
  if (getBackDeleteOverride() === null) return false;
  return dispatchDeleteCharAction(origin);
}

/**
 * Escape sintético legacy para los handlers antiguos que escuchan
 * `keydown` Escape directo (modales, popups). Devuelve `false` si algún
 * listener lo consumió (preventDefault) — en ese caso NO se emite la
 * acción, igual que hoy el back de página no actúa encima del modal.
 */
export function dispatchSyntheticEscape(): boolean {
  if (typeof document === "undefined") return true;
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  return target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

// ---------------------------------------------------------------------------
// Hooks de consumo
// ---------------------------------------------------------------------------

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Consume la acción `back`: botón B del mando, Esc y Borrar del teclado.
 * Borrar se ignora cuando un contexto de texto reclama el borrado (él lo
 * gestiona con `useTextBackAction`). Los Escape sintéticos del mando se
 * ignoran aquí (ya llegan como acción `back`); solo se atiende teclado físico.
 */
export function useBackAction(onBack: () => void, disabled = false): void {
  const handlerRef = useLatest(onBack);
  const disabledRef = useLatest(disabled);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (disabledRef.current || !event.isTrusted) return;
      if (isBackspaceKey(event)) {
        // En contexto de texto con contenido, Borrar borra (no retrocede).
        if (getBackDeleteOverride() === true) return;
        const target = event.target as HTMLElement | null;
        if (isNativeTextTarget(target)) return;
        event.preventDefault();
        handlerRef.current();
        return;
      }
      if (!isEscapeKey(event)) return;
      const target = event.target as HTMLElement | null;
      if (isNativeTextTarget(target)) return;
      event.preventDefault();
      handlerRef.current();
    };
    const onAction = (event: Event) => {
      if (disabledRef.current || event.defaultPrevented) return;
      handlerRef.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(INPUT_BACK_EVENT, onAction);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(INPUT_BACK_EVENT, onAction);
    };
  }, [handlerRef, disabledRef]);
}

/**
 * Variante para pantallas con texto editable sin <input> nativo (teclado en
 * pantalla): Borrar físico y B del mando borran cuando `hasText`; Esc (y B
 * sin texto) siguen siendo `back` y los gestiona el `useBackAction` exterior.
 */
export function useTextBackAction(options: { hasText: boolean; onDeleteChar: () => void; disabled?: boolean }): void {
  const { hasText, onDeleteChar, disabled = false } = options;
  const deleteRef = useLatest(onDeleteChar);
  const hasTextRef = useLatest(hasText);
  const disabledRef = useLatest(disabled);

  useEffect(() => {
    setBackDeleteOverride(hasText);
    return () => setBackDeleteOverride(null);
  }, [hasText]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (disabledRef.current || !event.isTrusted) return;
      if (!isBackspaceKey(event)) return;
      const target = event.target as HTMLElement | null;
      if (isNativeTextTarget(target)) return;
      event.preventDefault();
      deleteRef.current();
    };
    const onAction = (event: Event) => {
      if (disabledRef.current || event.defaultPrevented) return;
      // Solo consume cuando hay texto; sin texto deja pasar al back exterior.
      if (!hasTextRef.current) return;
      event.preventDefault();
      deleteRef.current();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(INPUT_DELETE_CHAR_EVENT, onAction);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(INPUT_DELETE_CHAR_EVENT, onAction);
    };
  }, [deleteRef, hasTextRef, disabledRef]);
}
