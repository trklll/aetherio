/**
 * Verificación de trailers de YouTube antes de pintar la fila.
 *
 * Contexto: los addons pueden devolver claves de YouTube caducadas o privadas,
 * y TMDB a veces trae teasers que ya no existen. El `<img>` de la card carga
 * entonces el placeholder gris de YouTube (120x90) sin disparar `onError`, así
 * que la fila "Tráilers" queda con una card rota.
 *
 * Aquí se sonda el thumbnail `hqdefault.jpg`: YouTube responde 404 para IDs
 * inexistentes y sirve una imagen real (480x360) para los válidos. El ancho se
 * usa como segunda barrera por si la CDN devolviera el placeholder con 200.
 *
 * - `verifiedKeys`: las claves que ya cargaron no se vuelven a sondear.
 * - `inFlight`: deduplica sondeos concurrentes de la misma clave.
 * - `failedAt`: evita remachar claves muertas (TTL corto, luego se reintenta).
 */

export type TrailerImageLoader = (url: string) => Promise<{ width: number; height: number }>;

export const TRAILER_PROBE_TIMEOUT_MS = 6_000;
export const TRAILER_PROBE_FAIL_TTL_MS = 5 * 60 * 1000;
/** Un thumbnail real de YouTube mide al menos 320 px; el placeholder mide 120. */
export const TRAILER_PROBE_MIN_WIDTH = 200;

const YOUTUBE_KEY_RE = /^[A-Za-z0-9_-]{8,}$/;

const verifiedKeys = new Set<string>();
const failedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<boolean>>();

export function youtubeTrailerThumbnail(key: string, quality: "maxres" | "hq" = "maxres"): string {
  const file = quality === "maxres" ? "maxresdefault" : "hqdefault";
  return `https://img.youtube.com/vi/${encodeURIComponent(key)}/${file}.jpg`;
}

export function isYoutubeTrailerKey(key: string | undefined | null): key is string {
  return typeof key === "string" && YOUTUBE_KEY_RE.test(key.trim());
}

function defaultLoadImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("image-unavailable"));
      return;
    }
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => {
      const size = { width: probe.naturalWidth, height: probe.naturalHeight };
      probe.onload = null;
      probe.onerror = null;
      resolve(size);
    };
    probe.onerror = () => {
      probe.onload = null;
      probe.onerror = null;
      reject(new Error("image-error"));
    };
    probe.src = url;
  });
}

/** Limpia todo el estado del módulo. Pensado para tests; no usar en la app. */
export function resetTrailerProbeState() {
  verifiedKeys.clear();
  failedAt.clear();
  inFlight.clear();
}

/** Olvida el fallo registrado de una clave para volver a sondearla. */
export function forgetTrailerFailure(key: string) {
  if (typeof key !== "string") return;
  failedAt.delete(key.trim());
}

export interface TrailerProbeOptions {
  timeoutMs?: number;
  loadImage?: TrailerImageLoader;
}

/**
 * Devuelve true si la clave de YouTube corresponde a un video con thumbnail
 * real. Nunca lanza: fallo, timeout o placeholder devuelven false.
 */
export function probeTrailerKey(
  key: string | undefined | null,
  options?: TrailerProbeOptions,
): Promise<boolean> {
  const clean = typeof key === "string" ? key.trim() : "";
  if (!isYoutubeTrailerKey(clean)) return Promise.resolve(false);
  if (verifiedKeys.has(clean)) return Promise.resolve(true);
  const failedTimestamp = failedAt.get(clean);
  if (failedTimestamp != null) {
    if (Date.now() - failedTimestamp < TRAILER_PROBE_FAIL_TTL_MS) return Promise.resolve(false);
    failedAt.delete(clean);
  }
  const pending = inFlight.get(clean);
  if (pending) return pending;

  const timeoutMs = options?.timeoutMs ?? TRAILER_PROBE_TIMEOUT_MS;
  const load = options?.loadImage ?? defaultLoadImage;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const task = new Promise<boolean>(resolve => {
    const timeout = new Promise<null>(done => {
      timer = setTimeout(() => done(null), timeoutMs);
    });
    Promise.race([
      load(youtubeTrailerThumbnail(clean, "hq")),
      timeout,
    ])
      .then(size => Boolean(size && size.width >= TRAILER_PROBE_MIN_WIDTH), () => false)
      .then(ok => {
        if (ok) {
          verifiedKeys.add(clean);
          failedAt.delete(clean);
        } else {
          failedAt.set(clean, Date.now());
        }
        resolve(ok);
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        inFlight.delete(clean);
      });
  });
  inFlight.set(clean, task);
  return task;
}

/**
 * Filtra los trailers que no se pueden reproducir. Los trailers sin `key`
 * (streams de addon) se conservan: no hay thumbnail de YouTube que validar.
 */
export async function filterPlayableTrailers<T extends { key?: string }>(
  trailers: readonly T[],
  options?: TrailerProbeOptions,
): Promise<T[]> {
  const checks = await Promise.all(
    trailers.map(trailer => (
      typeof trailer.key === "string" && trailer.key.trim()
        ? probeTrailerKey(trailer.key, options)
        : Promise.resolve(true)
    )),
  );
  return trailers.filter((_, index) => checks[index]);
}
