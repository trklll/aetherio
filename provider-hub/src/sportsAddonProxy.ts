import { hubJson, jsonError } from "./responses.ts";
import { loadAddons } from "./addonRegistry.ts";
import type { Env } from "./types.ts";

/** Sports add-ons are isolated from the normal movie/series/anime directory. */
export const SPORTS_ADDON_DOMAIN = "sports" as const;

const LEGACY_IDS: Record<string, string> = {
  "sports-streams": "community.sports.fly",
  nuvio: "community.nuvio.live-sports",
  stremverse: "com.stremverse.org",
};

const ALLOWED_RESOURCES = /^(?:manifest\.json|catalog\/(?:tv|sport)\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_%.,=:+-]+)?\.json|meta\/(?:tv|sport)\/[a-zA-Z0-9_%:.-]+\.json|stream\/(?:tv|sport)\/[a-zA-Z0-9_%:.-]+\.json)$/;

/**
 * Fetch a Stremio sports add-on through the Hub. The provider name is an
 * enum, never a caller-supplied URL, so this endpoint cannot become an open proxy.
 */
export async function sportsAddonResponse(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.method !== "GET") return jsonError(405, "Solo se permite GET");
  const match = pathname.match(/^\/api\/sports\/addons\/([a-zA-Z0-9][a-zA-Z0-9._-]{0,127})\/(.+)$/);
  if (!match || !ALLOWED_RESOURCES.test(match[2])) return jsonError(400, "Recurso de addon deportivo no válido");

  const addonId = LEGACY_IDS[match[1]] ?? match[1];
  const addon = (await loadAddons(env)).find(entry => entry.id === addonId && entry.domain === SPORTS_ADDON_DOMAIN);
  if (!addon) return jsonError(404, "Addon deportivo no encontrado en Provider Hub");
  const manifestUrl = new URL(addon.manifestUrl);
  manifestUrl.pathname = manifestUrl.pathname.replace(/\/manifest\.json\/?$/i, "");
  const upstream = new URL(`${manifestUrl.toString().replace(/\/$/, "")}/${match[2]}`);
  upstream.search = new URL(request.url).search;
  try {
    const response = await fetch(upstream, {
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Referer: `${upstream.origin}/`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return jsonError(response.status === 404 ? 404 : 502, "El addon deportivo no está disponible");
    const body = await response.text();
    if (body.length > 2_000_000) return jsonError(502, "Respuesta del addon demasiado grande");
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { return jsonError(502, "Respuesta JSON inválida del addon"); }
    return hubJson(200, { domain: SPORTS_ADDON_DOMAIN, provider: match[1], payload }, 15, true);
  } catch {
    return jsonError(502, "No se pudo consultar el addon deportivo");
  }
}
