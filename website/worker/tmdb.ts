/**
 * Proxy de solo lectura hacia TMDB e IntroDB.
 *
 * Las credenciales (TMDB_API_KEY, INTRODB_TOKEN) viven como secretos del
 * Worker y nunca viajan al cliente: la app llama a /api/tmdb/... y
 * /api/introdb/... y el Worker inyecta la credencial del lado servidor.
 * Sin secretos configurados responde 503 y la app usa sus fallbacks.
 *
 * Límites anti-abuso por construcción:
 * - Solo GET (TMDB queda en lectura; sin escrituras, votos ni listas).
 * - Host TMDB fijo en código; el cliente solo aporta ruta + query.
 * - Ruta TMDB con charset estricto (sin "..", sin query smuggling: la
 *   api_key del cliente se elimina siempre).
 * - IntroDB restringido a GET /media con imdb_id/season/episode validados.
 */

export interface ProxyEnv {
  TMDB_API_KEY?: string;
  INTRODB_TOKEN?: string;
}

const TMDB_UPSTREAM = "https://api.themoviedb.org/3";
const INTRODB_UPSTREAM = "https://api.theintrodb.org";
const TMDB_CACHE_TTL_SECONDS = 3600;
const INTRODB_CACHE_TTL_SECONDS = 86400;
const MAX_PATH_LENGTH = 256;

// Rutas TMDB: letras, dígitos, /, - y _. Sin puntos (bloquea "..").
const TMDB_PATH_PATTERN = /^\/[A-Za-z0-9_\-/]*$/;
const INTRODB_PATH = "/api/introdb/media";
const INTRODB_ALLOWED_PARAMS: Record<string, (value: string) => boolean> = {
  imdb_id: value => /^tt\d{7,8}$/.test(value),
  season: value => /^\d{1,3}$/.test(value),
  episode: value => /^\d{1,4}$/.test(value),
};

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(),
    },
  });
}

/** Devuelve null cuando la ruta no es del proxy (deja pasar al resto). */
export async function handleProxyRequest(request: Request, env: ProxyEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const isTmdb = pathname === "/api/tmdb" || pathname.startsWith("/api/tmdb/");
  const isIntroDb = pathname === INTRODB_PATH;
  if (!isTmdb && !isIntroDb) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return jsonError("Método no permitido.", 405);
  }

  if (isTmdb) return proxyTmdb(url, env);
  return proxyIntroDb(url, env);
}

async function proxyTmdb(clientUrl: URL, env: ProxyEnv): Promise<Response> {
  const apiKey = env.TMDB_API_KEY?.trim();
  if (!apiKey) return jsonError("TMDB no configurado en el servidor.", 503);

  const subPath = clientUrl.pathname.slice("/api/tmdb".length) || "/";
  if (subPath.length > MAX_PATH_LENGTH || !TMDB_PATH_PATTERN.test(subPath)) {
    return jsonError("Ruta TMDB no válida.", 400);
  }

  const upstream = new URL(`${TMDB_UPSTREAM}${subPath}`);
  for (const [key, value] of clientUrl.searchParams) {
    if (key === "api_key" || key === "api_read_access_token") continue;
    upstream.searchParams.append(key, value);
  }
  upstream.searchParams.set("api_key", apiKey);

  return fetchJsonCached(upstream, undefined, TMDB_CACHE_TTL_SECONDS, "TMDB no disponible.");
}

async function proxyIntroDb(clientUrl: URL, env: ProxyEnv): Promise<Response> {
  const token = env.INTRODB_TOKEN?.trim();
  if (!token) return jsonError("IntroDB no configurado en el servidor.", 503);

  const upstream = new URL(`${INTRODB_UPSTREAM}/media`);
  for (const [key, value] of clientUrl.searchParams) {
    const validate = INTRODB_ALLOWED_PARAMS[key];
    if (!validate || !validate(value)) return jsonError(`Parámetro no válido: ${key}.`, 400);
    upstream.searchParams.append(key, value);
  }
  if (!upstream.searchParams.has("imdb_id")) {
    return jsonError("Falta imdb_id.", 400);
  }

  return fetchJsonCached(
    upstream,
    { Authorization: `Bearer ${token}` },
    INTRODB_CACHE_TTL_SECONDS,
    "IntroDB no disponible.",
  );
}

/**
 * GET JSON con caché edge (solo 200). Los errores de TMDB/IntroDB se
 * propagan con su status para que la app aplique sus fallbacks.
 */
async function fetchJsonCached(
  upstream: URL,
  authHeaders: Record<string, string> | undefined,
  ttlSeconds: number,
  upstreamError: string,
): Promise<Response> {
  const cacheKey = new Request(upstream.toString(), { method: "GET" });
  const cache = await openEdgeCache();
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return withProxyHeaders(hit, true);
    } catch {
      // Sin caché edge: seguir al origen.
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream.toString(), {
      headers: { Accept: "application/json", ...authHeaders },
    });
  } catch {
    return jsonError(upstreamError, 502);
  }

  if (!upstreamResponse.ok) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(),
      },
    });
  }

  const response = new Response(upstreamResponse.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttlSeconds}`,
      ...corsHeaders(),
    },
  });
  if (cache) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      // Cache edge opcional.
    }
  }
  return withProxyHeaders(response, false);
}

function withProxyHeaders(response: Response, fromCache: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  if (fromCache) headers.set("X-Aetherio-Cache", "HIT");
  return new Response(response.body, { status: response.status, headers });
}

async function openEdgeCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open("aetherio-service-proxy");
  } catch {
    return null;
  }
}
