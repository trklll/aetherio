/**
 * Ciclo de vida del servidor de posters.
 *
 * SpatialPosters viaja dentro de la app (Node + build standalone como recursos),
 * asi que Aetherio lo levanta solo al abrirse y lo apaga al cerrarse. Si no esta
 * corriendo, Aetherio sigue funcionando con los pósters de TMDB.
 */

import { invoke } from "@tauri-apps/api/core";

export interface PosterServerStatus {
  running: boolean;
  ready: boolean;
  pid: number | null;
  port: number;
  detail: string | null;
}

const isTauri = () =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

let started: Promise<PosterServerStatus | null> | null = null;

/**
 * Arranca el server una sola vez por sesion.
 *
 * Es idempotente en los dos lados: el comando Rust detecta que ya hay algo
 * escuchando en el puerto y no relanza nada. Si falla (recursos sin
 * empaquetar, por ejemplo) devuelve null en vez de romper el arranque: los
 * posters de Aetherio son un extra, no un requisito para abrir la app.
 */
export function ensurePosterServer(): Promise<PosterServerStatus | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!started) {
    started = invoke<PosterServerStatus>("start_posters_server").catch(error => {
      console.warn("[posters] no se pudo arrancar el servidor de posters:", error);
      return null;
    });
  }
  return started;
}

export async function stopPosterServer(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("stop_posters_server");
  } catch {
    // Si la app ya esta cerrando, el proceso muere igual con el Exit event.
  }
}

export async function posterServerStatus(): Promise<PosterServerStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<PosterServerStatus>("posters_server_status");
  } catch {
    return null;
  }
}
