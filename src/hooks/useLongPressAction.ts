import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Pulsación corta vs mantenida (`LongPressKeyTracker`, que usa
 * `ViewConfiguration.getLongPressTimeout()` = 500ms):
 * Enter/Espacio corto = onActivate (abrir), mantenido = onLongPress (opciones).
 *
 * El mando (useGamepad) emite down/up del botón A y el teclado da keydown
 * con repeat + keyup nativos; ambos convergen aquí.
 */
export const LONG_PRESS_MS = 500;

interface LongPressActions {
  onActivate: () => void;
  onLongPress: () => void;
}

type ClosestTarget = EventTarget & {
  closest?: (selectors: string) => Element | null;
};

export function isContextMenuTarget(target: EventTarget | null) {
  return Boolean((target as ClosestTarget | null)?.closest?.("[data-aetherio-context-menu]"));
}

function isContextMenuEvent(event: ReactKeyboardEvent<HTMLElement>) {
  return isContextMenuTarget(event.target);
}

export function useLongPressAction(
  enabled: boolean,
  actions: LongPressActions,
  delayMs = LONG_PRESS_MS,
) {
  const activateRef = useRef(actions.onActivate);
  activateRef.current = actions.onActivate;
  const longPressRef = useRef(actions.onLongPress);
  longPressRef.current = actions.onLongPress;
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      if (isContextMenuEvent(event)) return;
      event.preventDefault();
      if (event.repeat) return; // el timer ya corre desde el primer down
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        longPressRef.current();
      }, delayMs);
    },
    onKeyUp: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      if (isContextMenuEvent(event)) return;
      // Timer vivo = pulsación corta → activar. Si ya disparó el long-press
      // el timer es null y se consume sin abrir el detalle.
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        activateRef.current();
      }
    },
  };
}
