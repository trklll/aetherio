import type { SpatialPosterSettings } from "../config/spatialPosters";
import { verifyPosterUrl } from "./posterProbe";

/**
 * Caché de verificación de pósters de SpatialPosters.
 *
 * Ya no se guarda el blob en CacheStorage: SpatialPosters hornea los badges en
 * el servidor, así que solo hace falta saber si la URL carga. El caché HTTP del
 * navegador se encarga del almacenamiento real.
 *
 * El limitador de concurrencia vive en `posterProbe` y es esencial: con un
 * SpatialPosters autoalojado, `sharp` es CPU-bound y un arranque en frío que
 * lance cientos de renders simultáneos satura la instancia (y la conexión al
 * host, que limita a 6 conexiones).
 */
const readyPosters = new Map<string, string>();
const failedPosters = new Set<string>();
const pendingPosters = new Map<string, Promise<string | null>>();

/**
 * Clave de caché de un póster. La firma de ajustes se antepone para que cambiar
 * estilos/badges/región fuerce el reprocesado de lo ya verificado (SpatialPosters
 * hornea en el servidor, así que la URL cambia con cada ajuste).
 */
export function posterArtworkKey(src: string, _settings?: SpatialPosterSettings, signature?: string): string {
  return signature ? `${signature}::${src}` : src;
}

export function getReadyPosterArtwork(
  src: string,
  settings: SpatialPosterSettings,
  signature?: string,
): string | undefined {
  return readyPosters.get(posterArtworkKey(src, settings, signature));
}

export function isPosterArtworkFailed(
  src: string,
  settings: SpatialPosterSettings,
  signature?: string,
): boolean {
  return failedPosters.has(posterArtworkKey(src, settings, signature));
}

/**
 * Verifica que la URL de póster de SpatialPosters carga de verdad. Resuelve la
 * propia URL cuando funciona, `null` cuando falla (para que el consumidor caiga
 * al póster original de TMDB).
 */
export function preloadPosterArtwork(
  src: string,
  settings: SpatialPosterSettings,
  signature?: string,
): Promise<string | null> {
  if (!src) return Promise.resolve(null);
  const key = posterArtworkKey(src, settings, signature);
  const ready = readyPosters.get(key);
  if (ready) return Promise.resolve(ready);
  const pending = pendingPosters.get(key);
  if (pending) return pending;

  const task = verifyPosterUrl(src).then(ok => (ok ? src : null));
  pendingPosters.set(key, task);
  void task.then(result => {
    if (result) {
      readyPosters.set(key, result);
      failedPosters.delete(key);
    } else {
      failedPosters.add(key);
    }
  }).finally(() => {
    if (pendingPosters.get(key) === task) pendingPosters.delete(key);
  });
  return task;
}

/**
 * Precarga una imagen arbitraria (póster de fondo, logo). No participates del
 * registro de estado: es best-effort y no controla el fallback.
 */
export function preloadArtworkImage(src: string): Promise<boolean> {
  if (!src) return Promise.resolve(false);
  return verifyPosterUrl(src);
}
