/**
 * Ciclo de vida del servidor de posters.
 *
 * SpatialPosters viaja dentro de la app (Node + build standalone como recursos),
 * asi que Aetherio lo levanta solo al abrirse y lo apaga al cerrarse. Si no esta
 * corriendo, Aetherio sigue funcionando con los pósters de TMDB.
 */

import { invoke } from "@tauri-apps/api/core";

import { getEffectiveInstanceUrl, setPosterCacheUrl } from "../config/spatialPosters";
import type { SpatialPosterSettings } from "../config/spatialPosters";

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
 * Arranca el server de posters una sola vez por sesion.
 *
 * Es idempotente en los dos lados: el comando Rust detecta que ya hay algo
 * escuchando en el puerto y no relanza nada. Si falla (recursos sin
 * empaquetar, por ejemplo) devuelve null en vez de romper el arranque: los
 * posters de Aetherio son un extra, no un requisito para abrir la app.
 *
 * `configuredUrl` es lo que el usuario tiene en Ajustes. Rust lo usa para
 * decidir si pone su cache en medio: si la instancia se movio a otro lado, el
 * cache se aparta.
 */
export function ensurePosterServer(configuredUrl: string): Promise<PosterServerStatus | null> {
  if (!isTauri()) return Promise.resolve(null);
  if (!started) {
    started = invoke<PosterServerStatus>("start_posters_server", { configuredUrl })
      .catch(error => {
        console.warn("[posters] no se pudo arrancar el servidor de posters:", error);
        return null;
      });
  }
  return started;
}

/**
 * URL del proxy de cache, o null si no arranco.
 *
 * El puerto es efimero, asi que no puede estar escrito en los ajustes: se
 * consulta en vivo. Devolver null deja la app usando la instancia directa.
 */
export async function getPosterCacheUrl(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>("poster_cache_url");
  } catch {
    return null;
  }
}

/**
 * URL contra la que hay que pedir posters, con el server ya arrancado.
 *
 * Sondear antes de que arranque produce dos fallos encadenados: contra
 * `localhost:3000` da `ERR_CONNECTION_REFUSED`, y si despues se consulta la URL
 * del proxy sin esperar, se prueba un puerto efimero que todavia no escucha.
 * Por eso todo el que probea debe pasar por aqui y no por
 * `getEffectiveInstanceUrl` directo.
 *
 * Nunca rechaza: si el server no levanta, devuelve la instancia configurada y
 * que sea el sondeo el que diga que no hay posters.
 */
export async function resolvePosterEndpoint(
  settings: SpatialPosterSettings,
): Promise<string> {
  if (isTauri()) {
    const status = await ensurePosterServer(settings.instanceUrl);
    // Solo tiene sentido apuntar al proxy si Rust confirmo que hay algo
    // escuchando: `poster_cache_url` puede devolver el puerto aunque el cache
    // se haya quedado sin arrancar.
    if (status?.running) {
      setPosterCacheUrl(await getPosterCacheUrl());
    }
  }
  return getEffectiveInstanceUrl(settings);
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
