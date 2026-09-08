import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleProxyRequest } from "./tmdb";

const ENV = { TMDB_API_KEY: "server-key", INTRODB_TOKEN: "intro-token" };

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://trkll.aetherio.workers.dev${path}`, init);
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy: enrutado", () => {
  it("ignora rutas ajenas (devuelve null)", async () => {
    await expect(handleProxyRequest(req("/api/auth/me"), ENV)).resolves.toBeNull();
    await expect(handleProxyRequest(req("/api/tmdb-otro/movie/1"), ENV)).resolves.toBeNull();
  });

  it("responde al preflight OPTIONS", async () => {
    const res = await handleProxyRequest(req("/api/tmdb/movie/1", { method: "OPTIONS" }), ENV);
    expect(res?.status).toBe(204);
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("proxy TMDB", () => {
  it("exige GET", async () => {
    const res = await handleProxyRequest(req("/api/tmdb/movie/1", { method: "POST" }), ENV);
    expect(res?.status).toBe(405);
  });

  it("503 sin secreto configurado", async () => {
    const res = await handleProxyRequest(req("/api/tmdb/movie/1"), {});
    expect(res?.status).toBe(503);
  });

  it("400 ante caracteres fuera del charset", async () => {
    const res = await handleProxyRequest(req("/api/tmdb/movie/1$select"), ENV);
    expect(res?.status).toBe(400);
  });

  it("el traversal codificado se normaliza fuera de la ruta (null)", async () => {
    await expect(handleProxyRequest(req("/api/tmdb/%2e%2e/etc/passwd"), ENV)).resolves.toBeNull();
  });

  it("inyecta la key de servidor y elimina la del cliente", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => okJson({ id: 550 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb/movie/550?language=es-ES&api_key=evil"), ENV);
    expect(res?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstream = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstream.startsWith("https://api.themoviedb.org/3/movie/550?")).toBe(true);
    expect(upstream).toContain("language=es-ES");
    expect(upstream).toContain("api_key=server-key");
    expect(upstream).not.toContain("evil");
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(res?.json()).resolves.toEqual({ id: 550 });
  });

  it("propaga el error de TMDB sin cachearlo como éxito", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => new Response(JSON.stringify({ status_message: "Invalid" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb/movie/550"), ENV);
    expect(res?.status).toBe(401);
  });
});

describe("proxy IntroDB", () => {
  it("503 sin secreto configurado", async () => {
    const res = await handleProxyRequest(req("/api/introdb/media?imdb_id=tt1234567"), {});
    expect(res?.status).toBe(503);
  });

  it("400 sin imdb_id o con imdb_id inválido", async () => {
    const noId = await handleProxyRequest(req("/api/introdb/media"), ENV);
    expect(noId?.status).toBe(400);
    const badId = await handleProxyRequest(req("/api/introdb/media?imdb_id=xyz"), ENV);
    expect(badId?.status).toBe(400);
  });

  it("400 ante parámetros no permitidos", async () => {
    const res = await handleProxyRequest(req("/api/introdb/media?imdb_id=tt1234567&foo=bar"), ENV);
    expect(res?.status).toBe(400);
  });

  it("inyecta el Bearer de servidor y reenvía filtros válidos", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: unknown) => okJson({ media: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(
      req("/api/introdb/media?imdb_id=tt1234567&season=2&episode=3"),
      ENV,
    );
    expect(res?.status).toBe(200);
    const upstream = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstream.startsWith("https://api.theintrodb.org/media?")).toBe(true);
    expect(upstream).toContain("imdb_id=tt1234567");
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.Authorization).toBe("Bearer intro-token");
    expect(upstream).not.toContain("intro-token");
  });
});
