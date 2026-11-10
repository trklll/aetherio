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
const readyPosters = new Set<string>();
const failedPosters = new Set<string>();
const pendingPosters = new Map<string, Promise<string | null>>();
const diskPresence = new Map<string, boolean>();

const POSTER_PATH_RE = /^\/api\/poster\//;

/**
 * Normaliza una URL de póster del proxy local a su forma estable (`/api/poster/...`).
 *
 * El proxy Rust escucha en un puerto efímero distinto en cada arranque, así que
 * las URLs absolutas no sirven como clave persistente: el mismo póster generaba
 * una URL distinta por sesión y toda la verificación se repetía. Fuera de
 * loopback (instancia remota propia) no hay nada que normalizar.
 */
export function canonicalPosterUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isLoopback = parsed.hostname === "127.0.0.1"
      || parsed.hostname === "localhost"
      || parsed.hostname === "[::1]";
    if (isLoopback && POSTER_PATH_RE.test(parsed.pathname)) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Ruta ya canónica o cadena no parseable: se devuelve tal cual.
  }
  return url;
}

/**
 * Migra una clave persistida por versiones anteriores (`firma::http://127.0.0.1:PUERTO/api/poster/...`)
 * a la forma estable (`firma::/api/poster/...`). Quitar el puerto una sola vez
 * aquí evita re-verificar por red todo lo ya verificado en la primera entrada
 * tras actualizar.
 */
function migrateReadyKey(key: string): string {
  const url = key.split("::").pop() ?? "";
  if (!url) return key;
  const canonical = canonicalPosterUrl(url);
  if (canonical === url) return key;
  return `${key.slice(0, key.length - url.length)}${canonical}`;
}

/**
 * Registro de "ya verificado" persistido en disco.
 *
 * Sin esto, cada arranque de la app pierde `readyPosters` (es un `Map` en
 * memoria) y vuelve a verificar por red las ~400 URLs de Home. Eso costs unos
 * 100 s de splash en cada entrada, aunque los PNG finals ya esten en el cache
 * del proxy Rust: la imagen se sirve al instante, pero Aetherio no lo sabe y
 * espera a que cada `Image()` resuelva.
 *
 * Lo que se guarda es solo el veredicto ("esta URL de SpatialPosters respondio
 * con una imagen"), nunca el blob. El proxy Rust sigue siendo el duenno del
 * archivo real y el unico que decide si evicta.
 *
 * Se invalida por la propia clave, que antepone la firma de ajustes y la URL
 * canónica del proxy: cambiar estilos, badges o region cambia la URL y por lo
 * tanto la clave, asi que el registro viejo no aplica. El puerto efímero del
 * proxy queda fuera de la clave (ver `canonicalPosterUrl`), asi que el registro
 * sobrevive a los reinicios. Se persisten tambien los fallos, pero con TTL corto
 * (unos minutos) para que un poster que estaba caido se vuelva a intentar en la
 * siguiente sesion sin dejar el registro pegado.
 */
const READY_STORE_KEY = "aetherio.spatial-posters.ready.v1";
const READY_STORE_MAX_ENTRIES = 6000;
const FAILED_TTL_MS = 10 * 60 * 1000;
const PERSIST_DEBOUNCE_MS = 1500;

type ReadyStoreShape = {
  v: 1;
  /** key -> epoch ms en que se confirmo como lista */
  ready: Record<string, number>;
  /** key -> epoch ms del ultimo fallo */
  failed: Record<string, number>;
};

let readyStoreLoaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: ReadyStoreShape = { v: 1, ready: {}, failed: {} };

/**
 * Marca como ausente en disco un póster que el navegador no pudo cargar.
 *
 * La llama `SpatialPosterImage` cuando la imagen del proxy da error: a partir de
 * ahi el registro persistido miente (dice "listo" pero el archivo no esta), asi
 * que se invalida para que el siguiente arranque lo vuelva a generar de verdad.
 *
 * La ausencia se recuerda por URL canónica en `diskPresence` (solo entradas
 * `false`, a modo de tombstone) y se consulta al cargar el registro y al leer
 * veredictos de esta sesión: un fallo visto por el navegador manda sobre
 * cualquier veredicto viejo.
 */
export function markPosterMissingOnDisk(src: string): void {
  const url = src.split("::").pop();
  if (!url) return;
  const canonical = canonicalPosterUrl(url);
  diskPresence.set(canonical, false);
  let removed = false;
  for (const key of [...readyPosters]) {
    if (key === url || key.endsWith(`::${url}`) || key.endsWith(`::${canonical}`)) {
      readyPosters.delete(key);
      delete inFlight.ready[key];
      removed = true;
    }
  }
  if (removed) schedulePersist();
}

function readyStoreStorage(): Storage | null {
  try {
    // En Tauri/WebView `localStorage` puede faltar en el contexto no-oprimido
    // (splash). Si no esta, el registro simplemente no persiste y el
    // comportamiento es el de antes: correcto, solo que mas lento.
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function loadReadyStore(): ReadyStoreShape {
  if (readyStoreLoaded) return inFlight;
  readyStoreLoaded = true;
  const store = readyStoreStorage();
  if (!store) return inFlight;
  try {
    const raw = store.getItem(READY_STORE_KEY);
    if (!raw) return inFlight;
    const parsed = JSON.parse(raw) as Partial<ReadyStoreShape>;
    const now = Date.now();
    const ready: Record<string, number> = {};
    const failed: Record<string, number> = {};
    if (parsed && typeof parsed === "object") {
      // Sin TTL: si el PNG sigue en el cache en disco del proxy, un veredicto
      // de una sesión anterior vale igual. Antes se descartaba todo lo de más
      // de 60 min y el registro moría en cada reinicio, así que la app
      // re-verificaba cientos de URLs contra un proxy ya caliente.
      for (const [storedKey, at] of Object.entries(parsed.ready ?? {})) {
        if (typeof at !== "number") continue;
        const key = migrateReadyKey(storedKey);
        const url = key.split("::").pop() ?? "";
        const canonical = canonicalPosterUrl(url);
        // Solo se acepta lo que apunta al proxy local: para un host externo no
        // hay forma de confirmar que el recurso siga ahí sin pedirlo, y darlo
        // por bueno dejaría cartas rotas si el remoto lo borró.
        if (!POSTER_PATH_RE.test(canonical)) continue;
        // Un fallo visto por el navegador en esta sesión manda sobre el registro.
        if (diskPresence.get(canonical) === false) continue;
        ready[key] = at;
        readyPosters.add(key);
      }
      for (const [key, at] of Object.entries(parsed.failed ?? {})) {
        if (typeof at === "number" && now - at < FAILED_TTL_MS) {
          failed[key] = at;
          failedPosters.add(key);
        }
      }
    }
    inFlight = { v: 1, ready, failed };
  } catch {
    // Registro corrupto: se descarta y se vuelve a construir desde cero.
    inFlight = { v: 1, ready: {}, failed: {} };
  }
  return inFlight;
}

function schedulePersist() {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistReadyStore();
  }, PERSIST_DEBOUNCE_MS);
}

function persistReadyStore() {
  const now = Date.now();
  // Las claves de `readyPosters` llevan la firma y la URL canónica, así que
  // sobreviven a reinicios del proxy (el puerto efímero queda fuera).
  const entries: Array<[string, number]> = [];
  for (const key of readyPosters) entries.push([key, inFlight.ready[key] ?? now]);
  // Eviction por antiguedad: si Home crecio (400 -> 600 cards), las entradas
  // viejas son las primeras en salir. Se corta por antiguedad, no por tamano del
  // registro, para que el limite de localStorage (~5 MB) no se toque nunca.
  if (entries.length > READY_STORE_MAX_ENTRIES) {
    entries.sort((a, b) => b[1] - a[1]);
    const overflow = entries.splice(READY_STORE_MAX_ENTRIES);
    for (const [key] of overflow) {
      readyPosters.delete(key);
      delete inFlight.ready[key];
    }
  }
  const ready: Record<string, number> = {};
  for (const [key, at] of entries) ready[key] = at;

  const failed: Record<string, number> = {};
  for (const key of failedPosters) {
    const at = inFlight.failed[key] ?? now;
    if (now - at < FAILED_TTL_MS) failed[key] = at;
    else {
      failedPosters.delete(key);
      delete inFlight.failed[key];
    }
  }
  inFlight = { v: 1, ready, failed };

  const store = readyStoreStorage();
  if (!store) return;
  try {
    store.setItem(READY_STORE_KEY, JSON.stringify(inFlight));
  } catch {
    // Cuota llena: se recorta a la mitad mas reciente y se reintenta una vez.
    const trimmed: ReadyStoreShape = {
      v: 1,
      ready: Object.fromEntries(entries.slice(Math.floor(entries.length / 2))),
      failed: {},
    };
    try {
      store.setItem(READY_STORE_KEY, JSON.stringify(trimmed));
      inFlight = trimmed;
    } catch {
      /* localStorage inutilizable en este contexto: se sigue en memoria */
    }
  }
}

/**
 * Clave de caché de un póster. La firma de ajustes se antepone para que cambiar
 * estilos/badges/región fuerce el reprocesado de lo ya verificado (SpatialPosters
 * hornea en el servidor, así que la URL cambia con cada ajuste). La URL se usa
 * en su forma canónica para que el puerto efímero del proxy no invalide el
 * registro en cada arranque.
 */
export function posterArtworkKey(src: string, _settings?: SpatialPosterSettings, signature?: string): string {
  const canonical = canonicalPosterUrl(src);
  return signature ? `${signature}::${canonical}` : canonical;
}

/** Registra un póster como verificado sin pisar el timestamp original si ya estaba. */
function markReady(key: string) {
  readyPosters.add(key);
  if (inFlight.ready[key] === undefined) inFlight.ready[key] = Date.now();
  failedPosters.delete(key);
  delete inFlight.failed[key];
}

export function getReadyPosterArtwork(
  src: string,
  settings: SpatialPosterSettings,
  signature?: string,
): string | undefined {
  loadReadyStore();
  const key = posterArtworkKey(src, settings, signature);
  if (!readyPosters.has(key)) return undefined;
  // Si esta sesión ya vio fallar esta URL (el navegador recibió un error del
  // proxy), el registro miente para esa entrada: se devuelve undefined y el
  // caller re-verifica por red.
  if (diskPresence.get(canonicalPosterUrl(src)) === false) return undefined;
  return src;
}

/**
 * Vacía el estado en memoria y fuerza la recarga del registro persistido.
 *
 * Solo lo usan los tests: entre casos hay que simular un arranque nuevo de la
 * app, que es exactamente el escenario que la persistencia viene a arreglar.
 */
export function resetPosterArtworkCacheForTests(): void {
  readyPosters.clear();
  failedPosters.clear();
  pendingPosters.clear();
  diskPresence.clear();
  inFlight = { v: 1, ready: {}, failed: {} };
  readyStoreLoaded = false;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/** Fuerza el guardado inmediato del registro (el debounce Normally lo aplaza). */
export function flushPosterArtworkCacheForTests(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistReadyStore();
}

export function isPosterArtworkFailed(
  src: string,
  settings: SpatialPosterSettings,
  signature?: string,
): boolean {
  loadReadyStore();
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
  loadReadyStore();
  const key = posterArtworkKey(src, settings, signature);
  // Ya verificado: se resuelve la URL del caller (fresca, con el puerto actual
  // del proxy). Antes se devolvía la URL guardada en el registro, que llevaba el
  // puerto de la sesión anterior y quedaba muerta al reiniciar.
  if (readyPosters.has(key)) return Promise.resolve(src);
  const pending = pendingPosters.get(key);
  if (pending) return pending;

  const task = verifyPosterUrl(src).then(ok => {
    // Liberar antes de resolver: un reintento en el mismo tick (bucle de
    // espera del arranque tras `forgetPosterFailure`) debe lanzar una
    // verificacion nueva, no recibir el resultado viejo ya resuelto.
    if (pendingPosters.get(key) === task) pendingPosters.delete(key);
    return ok ? src : null;
  });
  pendingPosters.set(key, task);
  void task.then(result => {
    if (result) {
      markReady(key);
    } else {
      failedPosters.add(key);
      inFlight.failed[key] = Date.now();
    }
    schedulePersist();
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
