import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_RATE, handleProxyRequest } from "./tmdb";
import { resetRateLimits } from "./rateLimit";

const ENV = { TMDB_API_KEY: "server-key", INTRODB_TOKEN: "intro-token" };

function req(path: string, init?: RequestInit): Request {
  return new Request(`https://trkll.aetherio.workers.dev${path}`, init);
}

function reqFromIp(path: string, ip: string, init?: RequestInit): Request {
  return new Request(`https://trkll.aetherio.workers.dev${path}`, {
    ...init,
    headers: { "CF-Connecting-IP": ip, ...(init?.headers as Record<string, string> | undefined) },
  });
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  resetRateLimits();
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

  it("usa Bearer para un Read Access Token de TMDB", async () => {
    const token = "eyJheader.payload.signature";
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => okJson({ id: 550 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb/tv/550?api_key=evil"), { TMDB_API_KEY: token });
    expect(res?.status).toBe(200);
    const upstream = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstream).not.toContain("api_key");
    const headers = (fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.Authorization).toBe(`Bearer ${token}`);
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

  it("lleva la key de servidor al reintento del namespace alterno", async () => {
    // movie y tv comparten ids numericos: si movie da 404 se reintenta en tv.
    // Ese segundo fetch antes salia SIN api_key, y TMDB respondia 401 en vez del
    // 404 real -> un titulo inexistente se reportaba como "Invalid API key".
    const fetchMock = vi.fn(async (url: unknown) => {
      const target = String(url);
      if (target.includes("/movie/99999999")) {
        return new Response(JSON.stringify({ status_message: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return okJson({ id: 99999999, name: "en tv" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb/movie/99999999"), ENV);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const alternate = String(fetchMock.mock.calls[1]?.[0]);
    expect(alternate).toContain("/3/tv/99999999");
    expect(alternate).toContain("api_key=server-key");
    expect(res?.status).toBe(200);
  });

  it("devuelve 404 limpio si el id no existe en ninguno de los dos namespaces", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status_message: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb/movie/99999999"), ENV);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res?.status).toBe(404);
  });
});

describe("proxy: limitacion de tasa", () => {
  it("corta con 429 y Retry-After al superar el limite", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => okJson({ id: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { ...ENV, TMDB_RATE_LIMIT: "2:30" };
    const ip = "203.0.113.7";

    for (const id of [1, 2]) {
      const res = await handleProxyRequest(reqFromIp(`/api/tmdb/movie/${id}`, ip), env);
      expect(res?.status).toBe(200);
    }

    const blocked = await handleProxyRequest(reqFromIp("/api/tmdb/movie/3", ip), env);
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).toBe("30");
    expect(blocked?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // El bloqueo ocurre antes de gastar cuota en upstream.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("las IPs no se comen el cupo de otras", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ id: 1 })));
    const env = { ...ENV, TMDB_RATE_LIMIT: "1:30" };
    expect((await handleProxyRequest(reqFromIp("/api/tmdb/movie/1", "198.51.100.1"), env))?.status).toBe(200);
    expect((await handleProxyRequest(reqFromIp("/api/tmdb/movie/2", "198.51.100.1"), env))?.status).toBe(429);
    expect((await handleProxyRequest(reqFromIp("/api/tmdb/movie/3", "198.51.100.2"), env))?.status).toBe(200);
  });

  it("lo que sale de la cache edge no gasta cupo", async () => {
    const fetchMock = vi.fn(async () => okJson({ id: 7 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async () => new Response(JSON.stringify({ id: 7 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        put: async () => {},
      }),
    });
    const env = { ...ENV, TMDB_RATE_LIMIT: "1:30" };

    for (let i = 0; i < 5; i += 1) {
      const res = await handleProxyRequest(reqFromIp(`/api/tmdb/movie/${i}`, "198.51.100.3"), env);
      expect(res?.status).toBe(200);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el limite de imagenes es aparte del de la API", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8]), {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const env = { TMDB_API_KEY: "server-key", TMDB_RATE_LIMIT: "50:30", TMDB_IMAGE_RATE_LIMIT: "1:30" };
    const ip = "198.51.100.4";

    expect((await handleProxyRequest(reqFromIp("/api/tmdb-image/w500/a.jpg", ip), env))?.status).toBe(200);
    expect((await handleProxyRequest(reqFromIp("/api/tmdb-image/w500/b.jpg", ip), env))?.status).toBe(429);
    // La API sigue con su propio cupo, intacto.
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ id: 1 })));
    expect((await handleProxyRequest(reqFromIp("/api/tmdb/movie/1", ip), env))?.status).toBe(200);
  });

  it("el reintento por namespace alterno tambien gasta cupo", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/movie/550")) {
        return new Response(JSON.stringify({ status_message: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return okJson({ id: 550 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Cupo de 1: la peticion movie lo gasta y el reintento como tv se corta.
    const tight = { ...ENV, TMDB_RATE_LIMIT: "1:30" };
    const res = await handleProxyRequest(reqFromIp("/api/tmdb/movie/550", "198.51.100.5"), tight);
    expect(res?.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Con cupo para las dos, el reintento llega a upstream y el cliente ve el
    // resultado del namespace alterno.
    resetRateLimits();
    fetchMock.mockClear();
    const roomy = { ...ENV, TMDB_RATE_LIMIT: "2:30" };
    const ok = await handleProxyRequest(reqFromIp("/api/tmdb/movie/550", "198.51.100.5"), roomy);
    expect(ok?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

    it("acepta el limite por variable de entorno y cae al default si es invalida", async () => {
      const fetchMock = vi.fn(async () => okJson({ id: 1 }));
      vi.stubGlobal("fetch", fetchMock);
      // Configuracion rota: el proxy debe seguir protegido con el default. Se
      // lee la constante y no un numero fijo, para que este test no se rompa
      // cada vez que se ajusta el techo.
      const env = { ...ENV, TMDB_RATE_LIMIT: "no-es-un-numero" };
      const ip = "198.51.100.6";
      const defaultLimit = DEFAULT_API_RATE.limit;
      for (let i = 0; i < defaultLimit; i += 1) {
        const res = await handleProxyRequest(reqFromIp(`/api/tmdb/movie/${i}`, ip), env);
        expect(res?.status).toBe(200);
      }
      expect((await handleProxyRequest(reqFromIp("/api/tmdb/movie/999", ip), env))?.status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(defaultLimit);
    });
});

describe("proxy de imágenes TMDB", () => {
  it("400 ante tamaño o archivo inválidos", async () => {
    await expect(handleProxyRequest(req("/api/tmdb-image/w999/abc.jpg"), ENV))
      .resolves.toMatchObject({ status: 400 });
    await expect(handleProxyRequest(req("/api/tmdb-image/w500/../secret"), ENV))
      .resolves.toMatchObject({ status: 400 });
    await expect(handleProxyRequest(req("/api/tmdb-image/w500/abc.svg"), ENV))
      .resolves.toMatchObject({ status: 400 });
    await expect(handleProxyRequest(req("/api/tmdb-image/w500"), ENV))
      .resolves.toMatchObject({ status: 400 });
  });

  it("400 ante traversal codificado (no se normaliza a dot-segment, falla el charset)", async () => {
    await expect(handleProxyRequest(req("/api/tmdb-image/w500/%2e%2e%2fabc.jpg"), ENV))
      .resolves.toMatchObject({ status: 400 });
  });

  it("exige GET", async () => {
    const res = await handleProxyRequest(req("/api/tmdb-image/w500/abc.jpg", { method: "POST" }), ENV);
    expect(res?.status).toBe(405);
  });

  it("proxea la imagen con CORS y caché larga", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const fetchMock = vi.fn(async (_url: unknown) => new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb-image/w500/abc.jpg?foo=bar"), ENV);
    expect(res?.status).toBe(200);
    const upstream = String(fetchMock.mock.calls[0]?.[0]);
    expect(upstream).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res?.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res?.headers.get("Cache-Control")).toContain("immutable");
    await expect(res?.arrayBuffer()).resolves.toBeDefined();
  });

  it("propaga el error del origen sin cachearlo como éxito", async () => {
    const fetchMock = vi.fn(async (_url: unknown) => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await handleProxyRequest(req("/api/tmdb-image/w500/missing.jpg"), ENV);
    expect(res?.status).toBe(404);
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
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

describe("reintentos ante 429 del upstream", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  function imageResponse(): Response {
    return new Response("bytes", { status: 200, headers: { "Content-Type": "image/jpeg" } });
  }

  it("reintenta la imagen y sale bien si el primer intento da 429", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response("slow down", { status: 429 }) : imageResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxyRequest(req("/api/tmdb-image/w500/a.jpg"), ENV);
    expect(res?.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("reintenta el JSON y propaga la respuesta buena", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response("slow down", { status: 429 }) : okJson({ id: 550 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxyRequest(req("/api/tmdb/movie/550"), ENV);
    expect(res?.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("no reintenta de mas: 3 rechazos y devuelve el 429", async () => {
    const fetchMock = vi.fn(async () => new Response("slow down", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxyRequest(req("/api/tmdb-image/w500/a.jpg"), ENV);
    expect(res?.status).toBe(429);
    // 1 intento + 2 reintentos, y para. Un bucle infinito seria justo lo que
    // este proxy existe para impedir.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("no reintenta un 404: no es transitorio", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await handleProxyRequest(req("/api/tmdb-image/w500/a.jpg"), ENV);
    expect(res?.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("el 429 del limite propio no se reintenta (la ventana no se abre)", async () => {
    const fetchMock = vi.fn(async () => imageResponse());
    vi.stubGlobal("fetch", fetchMock);
    const env = { ...ENV, TMDB_IMAGE_RATE_LIMIT: "1:30" };
    const ip = "198.51.100.20";

    expect((await handleProxyRequest(reqFromIp("/api/tmdb-image/w500/a.jpg", ip), env))?.status).toBe(200);
    // El segundo choca con el limite y sale 429 sin tocar upstream.
    expect((await handleProxyRequest(reqFromIp("/api/tmdb-image/w500/b.jpg", ip), env))?.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
