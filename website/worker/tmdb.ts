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
 * - Imágenes TMDB (/api/tmdb-image/<size>/<file>): solo lectura, tamaños y
 *   extensiones validados; el Worker añade CORS para que el cliente pueda
 *   muestrear píxeles en canvas (image.tmdb.org no envía ACAO).
 * - Limitación de tasa por IP para que un cliente en bucle no queme la cuota
 *   de TMDB/IntroDB, que es un recurso compartido. Ver ./rateLimit.ts.
 */

import { checkRateLimit, clientRateKey, parseRateRule, type RateLimitRule } from "./rateLimit";

export interface ProxyEnv {
  TMDB_API_KEY?: string;
  INTRODB_TOKEN?: string;
  /** Limite del proxy JSON en formato "limite:segundos" (ej. "120:30"). */
  TMDB_RATE_LIMIT?: string;
  /** Limite del proxy de imagenes en formato "limite:segundos". */
  TMDB_IMAGE_RATE_LIMIT?: string;
}

const TMDB_UPSTREAM = "https://api.themoviedb.org/3";
const INTRODB_UPSTREAM = "https://api.theintrodb.org";
const TMDB_IMAGE_UPSTREAM = "https://image.tmdb.org/t/p";
const TMDB_IMAGE_PREFIX = "/api/tmdb-image";
const TMDB_CACHE_TTL_SECONDS = 3600;
const INTRODB_CACHE_TTL_SECONDS = 86400;
const TMDB_IMAGE_CACHE_TTL_SECONDS = 30 * 24 * 3600;
const MAX_PATH_LENGTH = 256;

/**
 * Techos por defecto. El de JSON va holgado a proposito: una carga de Home ya
 * paceda a unas 4 peticiones/s, asi que 120/30s deja margen para toda la
 * navegacion normal y solo corta a quien se-sale. Las imagenes van mas
 * amplias porque van cacheadas 30 dias y no gastan cuota de API.
 */
const DEFAULT_API_RATE: RateLimitRule = { limit: 120, windowMs: 30_000 };
const DEFAULT_IMAGE_RATE: RateLimitRule = { limit: 300, windowMs: 30_000 };

// Rutas TMDB: letras, dígitos, /, - y _. Sin puntos (bloquea "..").
const TMDB_PATH_PATTERN = /^\/[A-Za-z0-9_\-/]*$/;
const INTRODB_PATH = "/api/introdb/media";
const TMDB_IMAGE_SIZES = new Set(["w92", "w154", "w185", "w342", "w500", "w780", "original"]);
// Solo nombre de archivo con extensión de imagen (sin subrutas ni "..").
const TMDB_IMAGE_FILE_PATTERN = /^[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/i;
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

/** 429 con Retry-After para que el cliente sepa cuando volver. */
function rateLimitExceeded(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "Demasiadas peticiones. Intenta de nuevo en unos segundos." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfterSeconds),
        ...corsHeaders(),
      },
    },
  );
}

/** Limite de la API segun env, con el valor por defecto como red de seguridad. */
function apiRateRule(env: ProxyEnv): RateLimitRule {
  return parseRateRule(env.TMDB_RATE_LIMIT, DEFAULT_API_RATE);
}

function imageRateRule(env: ProxyEnv): RateLimitRule {
  return parseRateRule(env.TMDB_IMAGE_RATE_LIMIT, DEFAULT_IMAGE_RATE);
}

/** Devuelve null cuando la ruta no es del proxy (deja pasar al resto). */
export async function handleProxyRequest(request: Request, env: ProxyEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const isTmdb = pathname === "/api/tmdb" || pathname.startsWith("/api/tmdb/");
  const isTmdbImage = pathname === TMDB_IMAGE_PREFIX || pathname.startsWith(`${TMDB_IMAGE_PREFIX}/`);
  const isIntroDb = pathname === INTRODB_PATH;
  if (!isTmdb && !isTmdbImage && !isIntroDb) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") {
    return jsonError("Método no permitido.", 405);
  }

  if (isTmdb) return proxyTmdb(url, request, env);
  if (isTmdbImage) return proxyTmdbImage(url, request, env);
  return proxyIntroDb(url, request, env);
}

async function proxyTmdb(clientUrl: URL, request: Request, env: ProxyEnv): Promise<Response> {
  const apiKey = env.TMDB_API_KEY?.trim();
  if (!apiKey) return jsonError("TMDB no configurado en el servidor.", 503);

  const subPath = clientUrl.pathname.slice("/api/tmdb".length) || "/";
  if (subPath.length > MAX_PATH_LENGTH || !TMDB_PATH_PATTERN.test(subPath)) {
    return jsonError("Ruta TMDB no válida.", 400);
  }

  // Con una v3 API key la credencial viaja en la query; con un Read Access Token
  // (JWT) va en el header Bearer y la query se deja limpia. Este paso tiene que
  // aplicarse a TODAS las URLs que salgan hacia TMDB, no solo a la primera:
  // si se olvida en una, esa peticion sale sin credencial y TMDB responde 401.
  const isReadAccessToken = apiKey.startsWith("eyJ") && apiKey.split(".").length === 3;
  const authHeaders = isReadAccessToken ? { Authorization: `Bearer ${apiKey}` } : undefined;
  const withServerCredentials = (url: URL): URL => {
    if (!isReadAccessToken) url.searchParams.set("api_key", apiKey);
    return url;
  };

  const upstream = new URL(`${TMDB_UPSTREAM}${subPath}`);
  for (const [key, value] of clientUrl.searchParams) {
    if (key === "api_key" || key === "api_read_access_token") continue;
    upstream.searchParams.append(key, value);
  }
  withServerCredentials(upstream);

  const limiter = { request, rule: apiRateRule(env) };
  const response = await fetchJsonCached(upstream, authHeaders, TMDB_CACHE_TTL_SECONDS, "TMDB no disponible.", limiter);
  if (response.status !== 404) return response;

  // TMDB movie y TV comparten IDs numéricos. Los catálogos de anime pueden
  // entregar el namespace opuesto al que usa el detalle; prueba el otro sin
  // exponer el 404 intermedio al navegador.
  const alternate = alternateTmdbNamespace(subPath);
  if (!alternate) return response;
  const alternateResponse = await fetchJsonCached(
    withServerCredentials(new URL(`${TMDB_UPSTREAM}${alternate}`)),
    authHeaders,
    TMDB_CACHE_TTL_SECONDS,
    "TMDB no disponible.",
    limiter,
  );
  return alternateResponse.status === 404 ? response : alternateResponse;
}

async function proxyTmdbImage(clientUrl: URL, request: Request, env: ProxyEnv): Promise<Response> {
  const match = clientUrl.pathname
    .slice(TMDB_IMAGE_PREFIX.length)
    .match(/^\/(w92|w154|w185|w342|w500|w780|original)\/([A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp))$/i);
  if (!match) return jsonError("Ruta de imagen TMDB no válida.", 400);

  const [, size, file] = match;
  const upstream = new URL(`${TMDB_IMAGE_UPSTREAM}/${size}/${file}`);
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
  const decision = checkRateLimit(clientRateKey(request, "image"), imageRateRule(env));
  if (!decision.allowed) return rateLimitExceeded(decision.retryAfterSeconds);
  try {
    upstreamResponse = await fetch(upstream.toString());
  } catch {
    return jsonError("Imagen TMDB no disponible.", 502);
  }

  if (!upstreamResponse.ok) {
    const headers = new Headers(upstreamResponse.headers);
    headers.set("Cache-Control", "no-store");
    Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value));
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers,
    });
  }

  const headers = new Headers(upstreamResponse.headers);
  headers.set("Cache-Control", `public, max-age=${TMDB_IMAGE_CACHE_TTL_SECONDS}, immutable`);
  Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value));
  const response = new Response(upstreamResponse.body, { status: 200, headers });
  if (cache) {
    try {
      await cache.put(cacheKey, response.clone());
    } catch {
      // Cache edge opcional.
    }
  }
  return response;
}

function alternateTmdbNamespace(subPath: string): string | null {
  if (!/^\/(?:movie|tv)\/\d+(?:\/.*)?$/.test(subPath)) return null;
  return subPath.startsWith("/movie/")
    ? subPath.replace(/^\/movie\//, "/tv/")
    : subPath.replace(/^\/tv\//, "/movie/");
}

async function proxyIntroDb(clientUrl: URL, request: Request, env: ProxyEnv): Promise<Response> {
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
    { request, rule: apiRateRule(env) },
  );
}

/**
 * GET JSON con caché edge (solo 200). Los errores de TMDB/IntroDB se
 * propagan con su status para que la app aplique sus fallbacks.
 *
 * `limiter` se aplica justo antes de salir a upstream: lo que responde la
 * caché edge no consume cuota de API y por tanto no debe gastar cupo del
 * cliente. Cuando viene sin `limiter` (tests, uso interno) no se limita.
 */
async function fetchJsonCached(
  upstream: URL,
  authHeaders: Record<string, string> | undefined,
  ttlSeconds: number,
  upstreamError: string,
  limiter?: { request: Request; rule: RateLimitRule },
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

  if (limiter) {
    const decision = checkRateLimit(clientRateKey(limiter.request, "api"), limiter.rule);
    if (!decision.allowed) return rateLimitExceeded(decision.retryAfterSeconds);
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
