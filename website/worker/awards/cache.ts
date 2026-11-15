// Caché pública de premios: Cache API compartida entre invocaciones del mismo
// centro de datos, sin KV adicional ni estado mutable ligado a una petición.
// No activar una regla global: autenticación e importaciones nunca se cachean.
const CACHE_NAME = "aetherio-awards-v1";
const CACHE_PREFIX = "/__aetherio-cache/awards/v1/";
const REVISION_TTL = 86400;

export const AWARDS_MAX_AGE = 3600;
export const AWARDS_EMPTY_MAX_AGE = 900;

interface CacheAccess {
  cache: Cache;
  key: Request;
}

interface CachedValue<T> {
  value: T;
  expiresAt: number;
}

function revisionKey(request: Request): Request {
  return new Request(new URL(`${CACHE_PREFIX}revision`, request.url));
}

async function cacheAccess(request: Request, name: string): Promise<CacheAccess | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const revision = await cache.match(revisionKey(request));
    const namespace = revision ? await revision.text() : "initial";
    const key = new Request(new URL(`${CACHE_PREFIX}${namespace}/${name}`, request.url));
    return { cache, key };
  } catch {
    // Un fallo de caché no debe convertirse en una caída de la API.
    return null;
  }
}

async function store(access: CacheAccess | null, response: Response): Promise<void> {
  if (!access) return;
  try { await access.cache.put(access.key, response.clone()); } catch { /* best effort */ }
}

/** Namespace nuevo para todas las fichas y la cobertura tras una escritura.
 * Cache API solo invalida el centro de datos actual; el resto se renueva por TTL.
 */
export async function invalidateAwardsCache(request: Request): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(revisionKey(request), new Response(crypto.randomUUID(), {
      headers: { "Cache-Control": `public, max-age=${REVISION_TTL}` },
    }));
  } catch { /* El TTL sigue garantizando la renovación si la purga falla. */ }
}

export async function cachedAwardsData<T>(
  request: Request,
  name: string,
  load: () => Promise<T>,
): Promise<CachedValue<T>> {
  const access = await cacheAccess(request, `data/${name}`);
  if (access) {
    try {
      const response = await access.cache.match(access.key);
      if (response) {
        const stored = await response.json<CachedValue<T>>();
        if (stored.expiresAt > Date.now()) return stored;
      }
    } catch { /* Reintentar contra D1, sin cachear el error. */ }
  }
  const stored = { value: await load(), expiresAt: Date.now() + AWARDS_MAX_AGE * 1000 };
  await store(access, new Response(JSON.stringify(stored), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${AWARDS_MAX_AGE}`,
    },
  }));
  return stored;
}

export function awardsCacheControl(maxAge: number, expiresAt?: number): string {
  // Una respuesta no debe prolongar otra hora una cobertura a punto de caducar.
  const remaining = expiresAt === undefined ? maxAge : Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return `public, max-age=${Math.min(maxAge, remaining)}, must-revalidate`;
}

export function conditionalAwardsResponse(request: Request, response: Response): Response {
  const etag = response.headers.get("ETag");
  const matches = request.headers.get("If-None-Match")?.split(",").some(value => {
    const tag = value.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag;
  });
  if (response.status !== 200 || !etag || !matches) return response;
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(null, { status: 304, headers });
}

function responseKey(request: Request): string {
  const url = new URL(request.url);
  const parameters = url.pathname.endsWith("/media")
    ? ["type", "tmdbId", "imdbId", "anilistId"]
    : url.pathname.endsWith("/person")
      ? ["tmdbId", "imdbId", "wikidataId", "anilistStaffId", "name"]
      : [];
  const search = new URLSearchParams();
  for (const parameter of parameters) {
    const raw = url.searchParams.get(parameter);
    // mediaEndpoint acepta el tipo exacto, pero recorta IDs y nombres. La
    // normalización de la clave no puede mezclar peticiones de distinto sentido.
    const value = parameter === "type" ? raw : raw?.trim();
    if (value) search.set(parameter, value);
  }
  return `response${url.pathname}?${search}`;
}

export async function cachedAwardsResponse(
  request: Request,
  load: (unconditionalRequest: Request) => Promise<Response>,
): Promise<Response> {
  const access = await cacheAccess(request, responseKey(request));
  if (access) {
    try {
      const response = await access.cache.match(access.key);
      if (response) return conditionalAwardsResponse(request, response);
    } catch { /* Continuar con el endpoint si la caché no responde. */ }
  }
  // Calcular y almacenar siempre el 200 completo, incluso si el cliente envió
  // If-None-Match. Guardar un 304 dejaría la caché sin cuerpo para otros clientes.
  const headers = new Headers(request.headers);
  headers.delete("If-None-Match");
  const response = await load(new Request(request, { headers }));
  const policy = response.headers.get("Cache-Control") ?? "";
  if (response.status === 200 && !response.headers.has("Set-Cookie")
    && /\bpublic\b/.test(policy) && !/\b(?:private|no-store)\b/.test(policy)
    && Number(/max-age=(\d+)/.exec(policy)?.[1] ?? 0) > 0) {
    await store(access, response);
  }
  return conditionalAwardsResponse(request, response);
}
