/**
 * Entrada escalonada del Home: el fade del background + reveal de la
 * información a los 2.5s ocurre SOLO al entrar recién a la app (arranque o
 * selección de perfil). Al volver al Home desde otra página todo aparece
 * al instante, sin animación.
 *
 * Se detecta por la ruta anterior en vez de un flag consumible: así es
 * determinista y seguro bajo StrictMode (solo lecturas puras durante el
 * render). App registra cada visita; Home/BigPicture consultan al montar.
 */

let lastVisitedPath: string | null = null;

export function recordRouteVisit(pathname: string): void {
  lastVisitedPath = pathname;
}

/** True si venimos de un arranque fresco (sin ruta previa, raíz, perfiles o quick-start). */
export function isFreshAppEntrance(): boolean {
  if (lastVisitedPath === null) return true;
  return (
    lastVisitedPath === "/" ||
    lastVisitedPath.startsWith("/profiles") ||
    lastVisitedPath.startsWith("/quick-start")
  );
}

export const FRESH_ENTRANCE_STATE = "freshEntrance" as const;

/**
 * La entrada escalonada se reproduce UNA sola vez: al remontar el Home
 * (p. ej. volver del detalle en Big Picture, donde el Home se desmonta)
 * no debe repetirse. Solo se resetea al cambiar de perfil.
 */
let entrancePlayed = false;

export function hasEntrancePlayed(): boolean {
  return entrancePlayed;
}

export function markEntrancePlayed(): void {
  entrancePlayed = true;
}

export function resetEntrancePlayed(): void {
  entrancePlayed = false;
}

/**
 * Entrada fresca al Home. La señal principal viaja en `location.state`
 * (la pone ProfileSelection al navegar): así no depende del momento en que
 * se monte el chunk lazy del Home. El tracker de rutas cubre recargas y
 * deep links directos a /home.
 */
export function isFreshHomeEntrance(location: { state?: unknown }): boolean {
  const state = location.state as Record<string, unknown> | null | undefined;
  if (state?.[FRESH_ENTRANCE_STATE] === true) return true;
  return isFreshAppEntrance();
}
