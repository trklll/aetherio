import { useEffect, useRef } from "react";
import { GAMEPAD_ACTIVITY_EVENT } from "./useGamepad.ts";
import { holdCursorHidden, releaseCursorHidden } from "./useHiddenCursor.ts";

/** Motivo propio del onboarding: no comparte contador con Big Picture. */
const REASON = "onboarding-gamepad";

/**
 * Con el mando en la mano el cursor sobra: al moverlo se esconde, y vuelve con
 * el ratón o con una tecla real.
 *
 * El hook del mando sintetiza flechas/Enter/Escape con `new KeyboardEvent`
 * (isTrusted = false). Si el teclado se escuchara sin mirar eso, el primer stick
 * de la sesión traería el cursor de vuelta y la page se quedaría en modo mando
 * con el puntero delante.
 *
 * A diferencia de `useHiddenCursor("gamepad")` aquí no se autoesconde tras unos
 * segundos: el onboarding espera a que el usuario retome el ratón. El estado lo
 * lleva `useHiddenCursor` para que varias superficies puedan pedir el cursor
 * oculto a la vez sin pisarse.
 */
export function useHideCursorOnGamepad(callbacks?: {
  /** Actividad del mando: el cursor se esconde. */
  onGamepad?: () => void;
  /** Ratón o teclado real: el cursor vuelve. */
  onNormalInput?: () => void;
}) {
  // Ref para no reiniciar los listeners en cada render del page.
  const handlersRef = useRef(callbacks);
  handlersRef.current = callbacks;

  useEffect(() => {
    let holding = false;
    const onGamepad = () => {
      if (!holding) {
        holding = true;
        holdCursorHidden(REASON);
      }
      handlersRef.current?.onGamepad?.();
    };
    const onNormalInput = () => {
      if (holding) {
        holding = false;
        releaseCursorHidden(REASON);
      }
      handlersRef.current?.onNormalInput?.();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      onNormalInput();
    };

    window.addEventListener(GAMEPAD_ACTIVITY_EVENT, onGamepad);
    window.addEventListener("mousemove", onNormalInput, { passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener(GAMEPAD_ACTIVITY_EVENT, onGamepad);
      window.removeEventListener("mousemove", onNormalInput);
      window.removeEventListener("keydown", onKey, true);
      if (holding) {
        holding = false;
        releaseCursorHidden(REASON);
      }
    };
  }, []);
}