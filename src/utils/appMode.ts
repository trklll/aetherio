/**
 * Recuerda de qué modo salió el usuario (Big Picture o app normal) para
 * restaurar el mismo modo al volver a entrar.
 *
 * Persistencia global en localStorage (no por perfil: el modo es de la app).
 */

export type AppMode = "big-picture" | "normal";

const LAST_APP_MODE_KEY = "aetherio-last-app-mode-v1";

/** Prefijos de la app normal que consolidan el modo (rutas estables). */
const NORMAL_PREFIXES = [
  "/home",
  "/library",
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

export function getLastAppMode(): AppMode | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LAST_APP_MODE_KEY);
    return raw === "big-picture" || raw === "normal" ? raw : null;
  } catch {
    return null;
  }
}

export function setLastAppMode(mode: AppMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LAST_APP_MODE_KEY, mode);
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
