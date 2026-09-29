/**
 * Disponibilidad de la instancia de SpatialPosters.
 *
 * SpatialPosters corre como proceso hermano, así que puede no estar levantado
 * (recién instalás la app, el equipo estaba apagado, la instancia se cayó).
 * En ese caso NO queremos que Aetherio dispare cientos de peticiones que van a
 * fallar: el pipeline de pósters se apaga y todo usa los pósters de TMDB.
 *
 * El sondeo va contra /manifest.json porque es barato y no llama a TMDB:
 * responde 200 con CORS si el server está vivo, y no exige credenciales.
 */

const PROBE_PATH = "/manifest.json";
const PROBE_TIMEOUT_MS = 2500;

/** Si respondió bien, no hace falta re-comprobar seguido. */
const TTL_UP_MS = 60_000;
/** Si cayó, reintentar pronto para recuperarse sin reiniciar Aetherio. */
const TTL_DOWN_MS = 20_000;

type Availability = { at: number; ok: boolean };

/** Clave por instancia: cambiar de URL reinicia el sondeo de esa una. */
const cache = new Map<string, Availability>();
/** Sondeos en vuelo, para no duplicar cuando varias cards preguntan a la vez. */
const inFlight = new Map<string, Promise<boolean>>();

/** Último resultado conocido, o `null` si todavía no se sondeó. */
export function getKnownSpatialAvailability(instanceUrl: string): boolean | null {
  const entry = cache.get(instanceUrl);
  if (!entry) return null;
  const ttl = entry.ok ? TTL_UP_MS : TTL_DOWN_MS;
  return Date.now() - entry.at < ttl ? entry.ok : null;
}

export function probeSpatialInstance(
  instanceUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const known = getKnownSpatialAvailability(instanceUrl);
  if (known !== null) return Promise.resolve(known);

  const pending = inFlight.get(instanceUrl);
  if (pending) return pending;

  const task = (async () => {
    let ok = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const response = await fetchImpl(`${instanceUrl}${PROBE_PATH}`, {
          method: "GET",
          signal: controller.signal,
        });
        // Cualquier respuesta HTTP prueba que hay algo escuchando; 404 tambien.
        ok = response.status > 0;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      ok = false;
    }
    cache.set(instanceUrl, { at: Date.now(), ok });
    return ok;
  })();

  inFlight.set(instanceUrl, task);
  void task.finally(() => {
    if (inFlight.get(instanceUrl) === task) inFlight.delete(instanceUrl);
  });
  return task;
}

/** Fuerza el próximo sondeo (tests, o cuando el usuario cambia la URL). */
export function resetSpatialAvailability(instanceUrl?: string): void {
  if (instanceUrl) cache.delete(instanceUrl);
  else cache.clear();
}
