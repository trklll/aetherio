import { useEffect, useRef } from "react";
import { AETHERIO_AUTH_CHANGED_EVENT, AETHERIO_AUTH_ERROR_EVENT } from "./authClient";

/**
 * Detects when a social login (Google / AniList) is abandoned: the user closes
 * the browser window (the app regains focus without a completed callback) or
 * simply never finishes. In both cases the in-flight state is cancelled with a
 * clear message so the UI never stays stuck on "Abriendo …".
 */
export function useSocialLoginCancellation(busy: boolean, onCancelled: (message: string) => void) {
  const busyRef = useRef(busy);
  const completedRef = useRef(true);
  const onCancelledRef = useRef(onCancelled);

  useEffect(() => {
    onCancelledRef.current = onCancelled;
  }, [onCancelled]);

  useEffect(() => {
    busyRef.current = busy;
    if (busy) completedRef.current = false;
  }, [busy]);

  useEffect(() => {
    const markCompleted = () => {
      completedRef.current = true;
    };
    window.addEventListener(AETHERIO_AUTH_CHANGED_EVENT, markCompleted);
    window.addEventListener(AETHERIO_AUTH_ERROR_EVENT, markCompleted);
    return () => {
      window.removeEventListener(AETHERIO_AUTH_CHANGED_EVENT, markCompleted);
      window.removeEventListener(AETHERIO_AUTH_ERROR_EVENT, markCompleted);
    };
  }, []);

  useEffect(() => {
    if (!busy) return;

    let cancelled = false;
    let focusTimer: number | null = null;
    const maxTimer = window.setTimeout(() => cancel("El inicio de sesión tardó demasiado. Inténtalo de nuevo."), 5 * 60 * 1000);

    function cancel(message: string) {
      if (cancelled || completedRef.current || !busyRef.current) return;
      cancelled = true;
      clearTimers();
      onCancelledRef.current(message);
    }

    function clearTimers() {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      window.clearTimeout(maxTimer);
    }

    // When the browser opens, the app loses focus. Returning to the app
    // without an OAuth callback means the flow was abandoned.
    const onFocus = () => {
      if (focusTimer !== null) window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => {
        if (!cancelled) cancel("Se cerró la ventana del navegador o se canceló el inicio de sesión.");
      }, 3000);
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearTimers();
      window.removeEventListener("focus", onFocus);
    };
  }, [busy]);
}