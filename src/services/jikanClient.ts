/**
 * Cliente HTTP compartido para api.jikan.moe (MyAnimeList no oficial).
 *
 * Jikan limita a ~3 req/s y 60 req/min por IP. Antes cada servicio
 * (jikan.ts, LibraryService, HistoryService, detailCollections) disparaba
 * sus propias ráfagas y terminábamos en 429/504. Este módulo serializa TODAS
 * las peticiones Jikan de la app por una única puerta con hueco mínimo,
 * añade caché en memoria (+ caché negativa para 404) y reintenta los 429
 * respetando la cabecera Retry-After.
 */

const AETHERIO_API_BASE = (import.meta.env.VITE_AETHERIO_API_URL as string | undefined)?.replace(/\/$/, "")
  ?? "https://trkll.aetherio.workers.dev";
const JIKAN_URL = `${AETHERIO_API_BASE}/api/jikan`;
// Hueco conservador entre inicios de petición (≤2.5 req/s < límite de 3/s).
const MIN_GAP_MS = 400;
const CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 800;
const MAX_RETRY_WAIT_MS = 10_000;
const TIMEOUT_MS = 8_000;
// Cortacircuitos compartido: tras N fallos consecutivos se deja de llamar
// durante el cooldown y se sirve caché (o null).
const BREAKER_FAILURES = 4;
const BREAKER_COOLDOWN_MS = 60_000;

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();
let gate: Promise<void> = Promise.resolve();
let lastStart = 0;
let consecutiveFailures = 0;
let breakerTrippedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** ¿Está abierto el cortacircuitos? (para que los llamadores activen fallbacks) */
export function isJikanCircuitOpen(): boolean {
  return breakerTrippedAt > 0 && Date.now() - breakerTrippedAt < BREAKER_COOLDOWN_MS;
}

export function jikanRequestUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`${JIKAN_URL}${path.startsWith("/") ? path : `/${path}`}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function noteFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_FAILURES) {
    consecutiveFailures = 0;
    breakerTrippedAt = Date.now();
  }
}

function noteSuccess(): void {
  consecutiveFailures = 0;
}

/** Serializa y aplica el hueco mínimo entre peticiones. */
async function takeSlot(): Promise<void> {
  let release!: () => void;
  const next = new Promise<void>(resolve => {
    release = resolve;
  });
  const previous = gate;
  gate = next;
  try {
    await previous;
    const wait = MIN_GAP_MS - (Date.now() - lastStart);
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  } finally {
    release();
  }
}

function retryAfterMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header * 1000, MAX_RETRY_WAIT_MS);
  }
  return Math.min(RETRY_BASE_MS * 2 ** attempt, MAX_RETRY_WAIT_MS);
}

export async function jikanRequest<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const key = jikanRequestUrl(path, params);

  const cached = responseCache.get(key);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data as T | null;
  }
  if (isJikanCircuitOpen()) {
    return (cached?.data as T | null) ?? null;
  }

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    await takeSlot();
    try {
      const response = await fetch(key, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (response.headers?.get("X-Aetherio-Upstream-Error") === "true") {
        noteFailure();
        return (cached?.data as T | null) ?? null;
      }
      if (response.ok) {
        noteSuccess();
        const data = (await response.json()) as T;
        responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      }
      // 404 también se cachea (corto): evita repetir "no existe" en bucles.
      if (response.status === 404) {
        noteSuccess();
        responseCache.set(key, { data: null, expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
        return null;
      }
      if (response.status === 429) {
        noteFailure();
        if (attempt + 1 >= MAX_ATTEMPTS) return (cached?.data as T | null) ?? null;
        await sleep(retryAfterMs(response, attempt));
        attempt += 1;
        continue;
      }
      if (response.status === 503 || response.status === 504) {
        noteFailure();
        if (attempt + 1 >= 2) return (cached?.data as T | null) ?? null;
        await sleep(RETRY_BASE_MS);
        attempt += 1;
        continue;
      }
      // Otros 4xx: error del cliente, no reintentar.
      return null;
    } catch {
      noteFailure();
      if (attempt + 1 >= MAX_ATTEMPTS) return (cached?.data as T | null) ?? null;
      await sleep(Math.min(RETRY_BASE_MS * 2 ** attempt, MAX_RETRY_WAIT_MS));
      attempt += 1;
    }
  }
  return (cached?.data as T | null) ?? null;
}
