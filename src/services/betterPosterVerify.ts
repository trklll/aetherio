/**
 * Verificación offscreen de pósters BTTTR antes de mostrarlos.
 *
 * Contexto: btttr.cc genera los pósters bajo demanda y puede tardar segundos
 * (o fallar con 404/429 si no conoce el título). Si el `<img>` visible apunta
 * directamente a la URL BTTTR, la card se queda en negro (fondo #1c1c1e) todo
 * ese tiempo. Para evitarlo, `useBetterPoster` mantiene el póster base (TMDB)
 * hasta que esta verificación confirma que la URL BTTTR carga: solo entonces
 * se hace el swap. Si falla o agota el presupuesto, se conserva el base.
 *
 * - `verifiedUrls`: las URLs que ya cargaron una vez no se re-verifican.
 * - `inFlight`: deduplica verificaciones concurrentes de la misma URL.
 * - `failedAt`: evita remachacar URLs muertas (TTL corto, luego se reintenta).
 */

export type PosterImageLoader = (url: string) => Promise<void>;

export const VERIFY_POSTER_TIMEOUT_MS = 20_000;
export const VERIFY_POSTER_FAIL_TTL_MS = 5 * 60 * 1000;
// Sin límite, un arranque en frío dispara cientos de verificaciones a la vez
// y satura la conexión (6 por host) y al propio btttr.cc: todo tarda más.
// Un solo punto de estrangulamiento para probes de cards y prewarm.
export const VERIFY_POSTER_MAX_CONCURRENT = 6;

const verifiedUrls = new Set<string>();
const inFlight = new Map<string, Promise<boolean>>();
const failedAt = new Map<string, number>();
let verifyActive = 0;
const verifyQueue: Array<() => void> = [];

function verifyDrain() {
  while (verifyActive < VERIFY_POSTER_MAX_CONCURRENT && verifyQueue.length) {
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

/** Limpia todo el estado del módulo. Pensado para tests; no usar en la app. */
export function resetBetterPosterVerifyState() {
  verifiedUrls.clear();
  inFlight.clear();
  failedAt.clear();
  verifyActive = 0;
  verifyQueue.length = 0;
}

/** ¿Esta URL BTTTR ya demostró que carga? (lectura síncrona, sin red). */
export function isBetterPosterVerified(url: string): boolean {
  return verifiedUrls.has(url);
}

export interface VerifyBetterPosterOptions {
  /** Presupuesto máximo por verificación. Por defecto VERIFY_POSTER_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Cargador inyectable (tests). Por defecto un `Image` offscreen. */
  loadImage?: PosterImageLoader;
}

/**
 * Devuelve true si la URL carga (o ya había cargado antes). Devuelve false
 * si falla, si agota `timeoutMs` o si falló hace menos de
 * VERIFY_POSTER_FAIL_TTL_MS. Nunca lanza.
 */
export function verifyBetterPosterUrl(
  url: string | undefined | null,
  options?: VerifyBetterPosterOptions,
): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  if (verifiedUrls.has(url)) return Promise.resolve(true);
  const failedTimestamp = failedAt.get(url);
  if (failedTimestamp != null) {
    if (Date.now() - failedTimestamp < VERIFY_POSTER_FAIL_TTL_MS) {
      return Promise.resolve(false);
    }
    failedAt.delete(url);
  }
  const pending = inFlight.get(url);
  if (pending) return pending;

  const timeoutMs = options?.timeoutMs ?? VERIFY_POSTER_TIMEOUT_MS;
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
