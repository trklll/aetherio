/**
 * Recuerda de qué modo salió el usuario (Big Picture o app normal) para
 * restaurar el mismo modo al volver a entrar.
 *
 * **El modo es de cada perfil, no de la app.** Si fosse global, entrar en el
 * perfil 2 arrastrando el modo del perfil 1 haria que dos personas en el mismo
 * dispositivo compartieran un ajuste que es de uso personal: la tele de uno se
 * pondria en modo mando por el hecho de que la otra dejara el raton.
 *
 * Clave por perfil `aetherio-last-app-mode-v1:<id>`. Sin perfil activo se cae
 * al global, que solo sirve como semilla de la migracion.
 */

import { getActiveProfileId } from "./localProfiles";

export type AppMode = "big-picture" | "normal";

const LAST_APP_MODE_KEY = "aetherio-last-app-mode-v1";

/** Prefijos de la app normal que consolidan el modo (rutas estables). */
const NORMAL_PREFIXES = [
  "/home",
  "/library",
  "/channels",
  "/addons",
  "/settings",
  "/catalog",
  "/detail",
  "/episode",
  "/streams",
  "/player",
  "/person",
  "/entity",
  "/search",
  "/genre",
] as const;

export function isBigPicturePath(pathname: string): boolean {
  return pathname === "/big-picture" || pathname.startsWith("/big-picture/");
}

function isNormalPath(pathname: string): boolean {
  return NORMAL_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Modo que consolida una ruta, o null si es transitoria (/, /profiles,
 * /quick-start, auth…) y no debe sobrescribir el último modo guardado.
 */
export function resolveAppModeForPath(pathname: string): AppMode | null {
  if (isBigPicturePath(pathname)) return "big-picture";
  if (isNormalPath(pathname)) return "normal";
  return null;
}

function scopeKey(profileId?: string | null) {
  const id = profileId ?? getActiveProfileId();
  return id ? `${LAST_APP_MODE_KEY}:${id}` : LAST_APP_MODE_KEY;
}

/**
 * Modo recordado de un perfil, o null si aun no tiene memoria propia.
 *
 * Sin memoria propia cae al valor global, que es de donde viene la migracion:
 * antes el modo se guardaba para toda la app, asi que ese valor es la mejor
 * semilla que se le puede dar a los perfiles que ya existian.
 */
export function getLastAppMode(profileId?: string | null): AppMode | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const scoped = localStorage.getItem(scopeKey(profileId));
    if (scoped === "big-picture" || scoped === "normal") return scoped;
    const legacy = localStorage.getItem(LAST_APP_MODE_KEY);
    return legacy === "big-picture" || legacy === "normal" ? legacy : null;
  } catch {
    return null;
  }
}

/**
 * Guarda el modo de un perfil. Sin perfil al que atribuírselo no se escribe:
 * el global es la semilla de la migracion y llenarlo lo contaminaría a todos
 * los perfiles que aun no tienen memoria propia.
 */
export function setLastAppMode(mode: AppMode, profileId?: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    const id = profileId ?? getActiveProfileId();
    if (!id) return;
    localStorage.setItem(scopeKey(id), mode);
  } catch {
    // Persistencia best-effort (modo privado, cuota llena…).
  }
}

export function shouldShowBigPictureBrandOnStartup(
  pathname: string,
  lastMode: AppMode | null,
  hasProfile: boolean,
): boolean {
  return pathname === "/" && lastMode === "big-picture" && hasProfile;
}
