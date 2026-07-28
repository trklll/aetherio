import { handleAuthRequest, type AuthEnv } from "./auth";
import { handleReleaseRequest, type ReleaseEnv } from "./releases";

interface Env extends AuthEnv, ReleaseEnv {
  ASSETS: Fetcher;
  RELEASE_PUBLISH_TOKEN?: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "aetherio-web" }, 200, 60);
    }

    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuthRequest(request, env, url.pathname);
    }

    const releaseResponse = await handleReleaseRequest(request, env, url);
    if (releaseResponse) return releaseResponse;

    return env.ASSETS.fetch(request);
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
