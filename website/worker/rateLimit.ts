/**
 * Limitacion de tasa para el proxy de credenciales.
 *
 * Motivo: la cuota de TMDB/IntroDB es del servidor y es el recurso escaso. Un
 * cliente que se equivoca (o un bucle de reintentos) puede quemarla en
 * segundos y tumbar el proxy para todos. Aqui se frena la rafaga.
 *
 * Como funciona: ventana fija con contador en memoria del isolate. NO es un
 * limite global ni una frontera de seguridad -- cada isolate lleva su cuenta y
 * Cloudflare reparte el trafico entre muchos. Es un amortiguador de rafaga, que
 * es justo lo que necesita un cliente que abre cientos de peticiones seguidas.
 * Para un tope global habria que mover el contador a un Durable Object.
 *
 * Solo se contabilizan las peticiones que de verdad llegan a upstream: las
 * que responde la cache edge no consumen cuota y no cuentan (ver
 * `fetchJsonCached` en ./tmdb.ts).
 */

export interface RateLimitRule {
  /** Peticiones permitidas por ventana. */
  limit: number;
  /** Duracion de la ventana en milisegundos. */
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Segundos que el cliente debe esperar antes de reintentar. 0 si puede seguir. */
  retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowState>();

/** Techo de entradas vivas; por encima se purga lo caducado en caliente. */
const PRUNE_THRESHOLD = 512;

function pruneWindows(now: number) {
  if (windows.size < PRUNE_THRESHOLD) return;
  for (const [key, entry] of windows) {
    if (now >= entry.resetAt) windows.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): RateLimitDecision {
  pruneWindows(now);
  const current = windows.get(key);
  if (!current || now >= current.resetAt) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, limit: rule.limit, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }
  if (current.count >= rule.limit) {
    return {
      allowed: false,
      limit: rule.limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { allowed: true, limit: rule.limit, remaining: rule.limit - current.count, retryAfterSeconds: 0 };
}

/** Identidad del cliente. Cloudflare siempre envía CF-Connecting-IP; los tests
 *  y los despliegues locales no, de ahi el respaldo. */
export function clientRateKey(request: Request, bucket: string): string {
  const ip = request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "anon";
  return `${bucket}:${ip}`;
}

/**
 * Regla configurable por variable de entorno en formato "limite:segundos"
 * (ej. "90:30"). Si falta o no es valida se usa el valor por defecto, para que
 * un error de tecleo no deje el proxy abierto.
 */
export function parseRateRule(raw: string | undefined, fallback: RateLimitRule): RateLimitRule {
  if (!raw) return fallback;
  const [limitPart, windowPart] = raw.split(":");
  const limit = Number(limitPart);
  const windowSeconds = windowPart === undefined ? 30 : Number(windowPart);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return fallback;
  return { limit: Math.floor(limit), windowMs: Math.floor(windowSeconds * 1000) };
}

/** Limpia el estado del modulo. Pensado para tests. */
export function resetRateLimits() {
  windows.clear();
}
