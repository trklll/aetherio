import { useCallback, useEffect } from "react";

/**
 * Fullscreen de ventana.
 *
 * Antes se usaba `document.documentElement.requestFullscreen()`, que es el
 * fullscreen del WebView. En Windows eso maximiza solo la ventana y deja la
 * barra de tareas tapando el borde inferior, que es la franja negra que se
 * veía al pie de las posters. La barra de tareas no es parte de la pagina, no
 * hay CSS que la tape.
 *
 * La API del window manager de Tauri si maximiza de verdad y cubre toda la
 * pantalla. Se usa cuando se esta dentro de Tauri, y se mantiene el fullscreen
 * del navegador como fallback para el dev server en el navegador y para los
 * tests, donde no hay window manager.
 */
async function getTauriWindow() {
  if (typeof window === "undefined") return null;
  if (!("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) return null;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    // Sin la API de ventana (por ejemplo en tests jsdom) se cae al fullscreen
    // del navegador, que es lo unico disponible ahi.
    return null;
  }
}

export function useFullscreen() {
  const toggle = useCallback(() => {
    void (async () => {
      const appWindow = await getTauriWindow();
      if (appWindow) {
        try {
          await appWindow.toggleMaximize();
          return;
        } catch {
          // Si el window manager falla, se intenta igual el del navegador antes
          // de dejar al usuario sin opcion de alternar.
        }
      }
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void document.documentElement.requestFullscreen();
      }
    })();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle]);
}
