import { handleAuthRequest, type AuthEnv } from "./auth";
import { handleReleaseRequest, type ReleaseEnv } from "./releases";
import { handleAwardsRequest, type AwardsApiEnv } from "./awards/api";
import { runImport, weeklyTargets } from "./awards/import";
import { resolvePeopleBatch } from "./awards/people";

interface Env extends AuthEnv, ReleaseEnv, AwardsApiEnv {
  ASSETS: Fetcher;
  RELEASE_PUBLISH_TOKEN?: string;
  AWARDS_IMPORT_TOKEN?: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "aetherio-web" }, 200, 60);
    }

    if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/integrations/")) {
      return handleAuthRequest(request, env, url.pathname);
    }

    const awardsResponse = await handleAwardsRequest(request, env, url);
    if (awardsResponse) return awardsResponse;

    const releaseResponse = await handleReleaseRequest(request, env, url);
    if (releaseResponse) return releaseResponse;

    // Nunca dejes que el fallback SPA convierta una ruta API desconocida en
    // HTML: los clientes deben recibir un error JSON y CORS consistente.
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Ruta API no encontrada." }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  // Revisión semanal: las dos ediciones más recientes de cada ceremonia.
  async scheduled(_controller, env): Promise<void> {
    if (!env.AWARDS_DB) return;
    const targets = weeklyTargets();
    await runImport(env, "weekly", targets);
    try { await resolvePeopleBatch(env, 40); } catch { /* El siguiente ciclo reintentará pendientes. */ }
  },
} satisfies ExportedHandler<Env>;

function json(value: unknown, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
