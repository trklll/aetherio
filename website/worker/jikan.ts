/**
 * Proxy de solo lectura para Jikan. El upstream devuelve 504 con frecuencia;
 * ocultar ese fallo detrás del Worker permite que el cliente use su fallback
 * TMDB sin llenar la consola del navegador con errores de red.
 */

const JIKAN_UPSTREAM = "https://api.jikan.moe/v4";
const JIKAN_PREFIX = "/api/jikan";
const JIKAN_PATH_PATTERN = /^\/[A-Za-z0-9_\-/]*$/;
const MAX_PATH_LENGTH = 256;
const JIKAN_CACHE_TTL_SECONDS = 600;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(value: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      ...corsHeaders(),
    },
  });
}

/** Devuelve null cuando la ruta no es del proxy de Jikan. */
export async function handleJikanRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== JIKAN_PREFIX && !url.pathname.startsWith(`${JIKAN_PREFIX}/`)) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET") return json({ error: "Método no permitido." }, 405);

  const subPath = url.pathname.slice(JIKAN_PREFIX.length) || "/";
  if (subPath.length > MAX_PATH_LENGTH || !JIKAN_PATH_PATTERN.test(subPath)) {
    return json({ error: "Ruta Jikan no válida." }, 400);
  }

  const upstream = new URL(`${JIKAN_UPSTREAM}${subPath}`);
  for (const [key, value] of url.searchParams) {
    if (!/^[A-Za-z0-9_]+$/.test(key) || key.length > 64 || value.length > 256) {
      return json({ error: "Parámetro Jikan no válido." }, 400);
    }
    upstream.searchParams.append(key, value);
  }

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

  let response: Response;
  try {
    response = await fetch(upstream.toString(), {
      headers: { Accept: "application/json" },
    });
  } catch {
    return upstreamUnavailable();
  }

  if (!response.ok) return upstreamUnavailable(response.status);

  const success = new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${JIKAN_CACHE_TTL_SECONDS}`,
      ...corsHeaders(),
    },
  });
  if (cache) {
    try {
      await cache.put(cacheKey, success.clone());
    } catch {
      // Cache edge opcional.
    }
  }
  return success;
}

function upstreamUnavailable(status?: number): Response {
  const response = json({ data: [] }, 200);
  response.headers.set("X-Aetherio-Upstream-Error", "true");
  if (status) response.headers.set("X-Aetherio-Upstream-Status", String(status));
  return response;
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
