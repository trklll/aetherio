import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useGamepad } from "../../hooks/useGamepad.ts";
import {
  listenGamepadWake,
  showAndFocusWindow,
} from "../../runtime/platform.ts";
import {
  getModeTransitionPhase,
  transitionToMode,
} from "../../utils/bigPictureTransition.ts";

/**
 * Oyente global del mando. Vive siempre (dentro de PartyProvider en App).
 * - Polling Gamepad API: D-pad/stick -> flechas, A -> Enter, B -> Escape.
 * - Start (botón 9) = ÚNICA vía con mando para alternar modos:
 *   en normal entra a Big Picture, en Big Picture vuelve a la app normal.
 *   El botón Guía/Xbox NUNCA navega entre modos.
 * - Evento Tauri `aetherio-gamepad-wake` (hilo nativo futuro) -> lo mismo que Start.
 */
export default function GamepadWakeListener() {
  const navigate = useNavigate();
  const location = useLocation();
  // Doble pulsación de Guía dentro de Big Picture = salir de la app
  // (estilo Steam). Nunca navega a modo normal.
  const lastGuideAtRef = useRef(0);

  const toggleMode = useCallback(async () => {
    // Transición cinematográfica GSAP (dip-to-black simétrico): cubre con el
    // velo, navega debajo, espera al destino y revela. Durante cover/hold se
    // ignora el re-spam para no duplicar entradas en el historial; en reveal
    // se puede revertir (el timeline parte del valor de presentación).
    if (getModeTransitionPhase() === "cover") return;
    const entering = !location.pathname.startsWith("/big-picture");
    if (entering) {
      // Solo trae la ventana al frente; el fullscreen exclusivo lo posee la
      // página BigPicture (lo pone al montar y lo quita al salir).
      try {
        await showAndFocusWindow();
      } catch {
        // Ventana best-effort; la navegación funciona igual en web.
      }
      transitionToMode("enter", () => navigate("/big-picture"));
      return;
    }
    // En Big Picture, Start = ÚNICA salida a la app normal.
    transitionToMode("exit", () => navigate("/home"));
  }, [location.pathname, navigate]);

  const requestExit = useCallback(() => {
    // Solo tiene sentido dentro de Big Picture; fuera se ignora.
    if (!window.location.pathname.startsWith("/big-picture")) return;
    const now = Date.now();
    if (now - lastGuideAtRef.current < 900) {
      lastGuideAtRef.current = 0;
      window.dispatchEvent(new CustomEvent("aetherio-bp-exit-request"));
    } else {
      lastGuideAtRef.current = now;
    }
  }, []);

  useGamepad({ onStart: () => void toggleMode(), onGuide: () => requestExit() });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenGamepadWake(() => void toggleMode()).then(next => {
      unlisten = next;
    });
    const onWebStart = () => void toggleMode();
    // Atajo de teclado para probar sin mando: F10 alterna como Start.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        void toggleMode();
      }
    };
    window.addEventListener("aetherio-gamepad-start", onWebStart);
    window.addEventListener("aetherio-gamepad-combo", onWebStart);
    window.addEventListener("keydown", onKey);
    return () => {
      unlisten?.();
      window.removeEventListener("aetherio-gamepad-start", onWebStart);
      window.removeEventListener("aetherio-gamepad-combo", onWebStart);
      window.removeEventListener("keydown", onKey);
    };
  }, [toggleMode, requestExit]);

  return null;
}
