/**
 * VerificaciÃ³n offscreen de pÃ³sters SpatialPosters antes de mostrarlos.
 *
 * Contexto: la instancia de SpatialPosters genera los pÃ³sters bajo demanda y puede tardar segundos
 * (o fallar con 404/429 si no conoce el tÃ­tulo). Si el `<img>` visible apunta
 * directamente a la URL SpatialPosters, la card se queda en negro (fondo #1c1c1e) todo
 * ese tiempo. Para evitarlo, `useSpatialPoster` mantiene el pÃ³ster base (TMDB)
 * hasta que esta verificaciÃ³n confirma que la URL SpatialPosters carga: solo entonces
 * se hace el swap. Si falla o agota el presupuesto, se conserva el base.
 *
 * - `verifiedUrls`: las URLs que ya cargaron una vez no se re-verifican.
 * - `inFlight`: deduplica verificaciones concurrentes de la misma URL.
 * - `failedAt`: evita remachacar URLs muertas (TTL corto, luego se reintenta).
 */

export type PosterImageLoader = (url: string) => Promise<void>;

export const POSTER_PROBE_TIMEOUT_MS = 20_000;
export const POSTER_PROBE_FAIL_TTL_MS = 5 * 60 * 1000;
// Sin lÃ­mite, un arranque en frÃ­o dispara cientos de verificaciones a la vez
// y satura la conexiÃ³n (6 por host) y al propio la instancia de SpatialPosters: todo tarda mÃ¡s.
// Un solo punto de estrangulamiento para probes de cards y prewarm.
export const POSTER_PROBE_MAX_CONCURRENT = 6;

const verifiedUrls = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();
const failedAt = new Map<string, number>();
let verifyActive = 0;
const verifyQueue: Array<() => void> = [];

function verifyDrain() {
  while (verifyActive < POSTER_PROBE_MAX_CONCURRENT && verifyQueue.length) {
    verifyQueue.shift()?.();
  }
}

function defaultLoadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("image-unavailable"));
      return;
    }
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => {
      probe.onload = null;
      probe.onerror = null;
      resolve();
    };
    probe.onerror = () => {
      probe.onload = null;
      probe.onerror = null;
      reject(new Error("image-error"));
    };
    probe.src = url;
  });
}

function timeoutAsFalse(ms: number): Promise<boolean> {
  return new Promise(resolve => {
    globalThis.setTimeout(() => resolve(false), ms);
  });
}

/** Limpia todo el estado del mÃ³dulo. Pensado para tests; no usar en la app. */
export function resetPosterProbeState() {
  verifiedUrls.clear();
  inFlight.clear();
  failedAt.clear();
  verifyActive = 0;
  verifyQueue.length = 0;
}

/** Â¿Esta URL SpatialPosters ya demostrÃ³ que carga? (lectura sÃ­ncrona, sin red). */
export function isPosterVerified(url: string): boolean {
  return verifiedUrls.has(url);
}

export interface VerifyPosterOptions {
  /** Presupuesto mÃ¡ximo por verificaciÃ³n. Por defecto POSTER_PROBE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Cargador inyectable (tests). Por defecto un `Image` offscreen. */
  loadImage?: PosterImageLoader;
}

/**
 * Devuelve true si la URL carga (o ya habÃ­a cargado antes). Devuelve false
 * si falla, si agota `timeoutMs` o si fallÃ³ hace menos de
 * POSTER_PROBE_FAIL_TTL_MS. Nunca lanza.
 */
export function verifyPosterUrl(
  url: string | undefined | null,
  options?: VerifyPosterOptions,
): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  if (verifiedUrls.has(url)) return Promise.resolve(true);
  const failedTimestamp = failedAt.get(url);
  if (failedTimestamp != null) {
    if (Date.now() - failedTimestamp < POSTER_PROBE_FAIL_TTL_MS) {
      return Promise.resolve(false);
    }
    failedAt.delete(url);
  }
  const pending = inFlight.get(url);
  if (pending) return pending;

  const timeoutMs = options?.timeoutMs ?? POSTER_PROBE_TIMEOUT_MS;
  const load = options?.loadImage ?? defaultLoadImage;
  const task = new Promise<boolean>(resolve => {
    const run = () => {
      verifyActive += 1;
      let outcome: Promise<boolean>;
      try {
        // El presupuesto cubre la carga activa, no la espera en cola.
        outcome = Promise.race([
          load(url).then(() => true, () => false),
          timeoutAsFalse(timeoutMs),
        ]);
      } catch {
        outcome = Promise.resolve(false);
      }
      void outcome.then(
        ok => {
          if (ok) {
            verifiedUrls.add(url);
            failedAt.delete(url);
          } else {
            failedAt.set(url, Date.now());
          }
          resolve(ok);
        },
        () => {
          failedAt.set(url, Date.now());
          resolve(false);
        },
      ).finally(() => {
        verifyActive -= 1;
        if (inFlight.get(url) === task) inFlight.delete(url);
        verifyDrain();
      });
    };
    verifyQueue.push(run);
    verifyDrain();
  });
  inFlight.set(url, task);
  return task;
}
