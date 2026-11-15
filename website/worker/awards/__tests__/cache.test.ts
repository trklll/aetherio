import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAwardsRequest } from "../api";
import { makeEnv } from "./helpers";

class EdgeCache {
  entries = new Map<string, { response: Response; expiresAt: number }>();

  async match(request: Request) {
    const entry = this.entries.get(request.url);
    if (!entry || entry.expiresAt <= Date.now()) return undefined;
    return entry.response.clone();
  }

  async put(request: Request, response: Response) {
    const ttl = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1] ?? 0);
    this.entries.set(request.url, {
      response: response.clone(),
      expiresAt: Date.now() + ttl * 1000,
    });
  }
}

const mediaPath = "/api/awards/media?type=movie&tmdbId=1";

function seedAward(env: ReturnType<typeof makeEnv>) {
  env.AWARDS_DB.exec(`
    INSERT INTO award_editions
      (ceremony, edition, award_year, coverage, status, source_url, fetched_at, checksum, record_count, updated_at)
    VALUES ('oscar', 96, 2024, 'complete', 'ok', 'https://example.test', '2026-01-01', 'one', 1, '2026-01-01');
    INSERT INTO award_media_links
      (id, work_key, work_title, work_year, media_type, tmdb_id, resolve_status, created_at, updated_at)
    VALUES ('link-one', 'one [2024]', 'One', 2024, 'movie', 1, 'resolved', '2026-01-01', '2026-01-01');
    INSERT INTO award_records
      (id, ceremony, edition, award_year, category_es, category_original, status, subject, recipients,
       work_title, work_year, work_key, source_url, source_tier, import_key, created_at, updated_at)
    VALUES ('record-one', 'oscar', 96, 2024, 'Mejor película', 'Best Picture', 'winner', 'work', '[]',
            'One', 2024, 'one [2024]', 'https://example.test', 'official', 'import-one', '2026-01-01', '2026-01-01');
  `);
}

function get(env: ReturnType<typeof makeEnv>, path = mediaPath, headers?: HeadersInit) {
  const request = new Request(`https://test${path}`, { headers });
  return handleAwardsRequest(request, env, new URL(request.url));
}

describe("caché de premios y consumo de D1", () => {
  let edge: EdgeCache;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    edge = new EdgeCache();
    vi.stubGlobal("caches", { open: vi.fn(async () => edge) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sirve una ficha repetida sin ninguna consulta adicional a D1", async () => {
    const env = makeEnv();
    seedAward(env);
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    const first = await get(env);
    const firstBody = await first!.json();
    const initialQueries = prepare.mock.calls.length;
    expect(initialQueries).toBeGreaterThan(0);

    for (let index = 0; index < 20; index += 1) {
      const response = await get(env);
      expect(response?.status).toBe(200);
      expect(await response!.json()).toEqual(firstBody);
    }
    expect(prepare).toHaveBeenCalledTimes(initialQueries);
  });

  it("comparte la cobertura entre fichas diferentes y el endpoint de cobertura", async () => {
    const env = makeEnv();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    await get(env);
    await get(env, "/api/awards/media?tmdbId=2&type=movie");
    await get(env, "/api/awards/coverage");
    const scans = prepare.mock.calls.map(([sql]) => sql).filter(sql =>
      sql.includes("FROM award_editions") || sql.includes("FROM award_edition_manifest"),
    );
    expect(scans).toHaveLength(2);
  });

  it("cachea resultados vacíos y los vuelve a consultar después de 15 minutos", async () => {
    const env = makeEnv();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    const first = await get(env);
    expect(first?.headers.get("Cache-Control")).toContain("max-age=900");
    const initialQueries = prepare.mock.calls.length;
    await get(env);
    expect(prepare).toHaveBeenCalledTimes(initialQueries);

    vi.setSystemTime(Date.now() + 901_000);
    await get(env);
    expect(prepare.mock.calls.length).toBeGreaterThan(initialQueries);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM award_editions"))).toHaveLength(1);
  });

  it("renueva los premios y la cobertura al caducar una hora", async () => {
    const env = makeEnv();
    seedAward(env);
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    await get(env);
    const initialQueries = prepare.mock.calls.length;
    vi.setSystemTime(Date.now() + 3_601_000);
    await get(env);
    expect(prepare.mock.calls.length).toBeGreaterThan(initialQueries);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM award_editions"))).toHaveLength(2);
  });

  it("un 304 desde caché no consulta D1 y no elimina la respuesta completa", async () => {
    const env = makeEnv();
    seedAward(env);
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    const first = await get(env);
    const initialQueries = prepare.mock.calls.length;
    const etag = first!.headers.get("ETag")!;
    const conditional = await get(env, mediaPath, { "If-None-Match": `W/${etag}` });
    expect(conditional?.status).toBe(304);
    expect(await conditional!.text()).toBe("");
    const full = await get(env);
    expect(full?.status).toBe(200);
    expect((await full!.json() as { records: unknown[] }).records).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(initialQueries);
  });

  it("almacena un 200 completo aunque la primera petición sea condicional", async () => {
    const env = makeEnv();
    seedAward(env);
    const first = await get(env);
    const etag = first!.headers.get("ETag")!;
    edge.entries.clear();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    expect((await get(env, mediaPath, { "If-None-Match": etag }))?.status).toBe(304);
    const initialQueries = prepare.mock.calls.length;
    expect((await get(env))?.status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(initialQueries);
  });

  it("ignora parámetros de seguimiento, orden y cabeceras no-cache al reutilizar una ficha", async () => {
    const env = makeEnv();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    await get(env);
    const initialQueries = prepare.mock.calls.length;
    await get(env, "/api/awards/media?utm_source=test&tmdbId=1&type=movie&v=2", { "Cache-Control": "no-cache" });
    expect(prepare).toHaveBeenCalledTimes(initialQueries);
  });

  it("no mezcla las claves de película, TV e identificadores distintos", async () => {
    const env = makeEnv();
    seedAward(env);
    const movie = await get(env);
    const tv = await get(env, "/api/awards/media?tmdbId=1&type=tv");
    const other = await get(env, "/api/awards/media?tmdbId=2&type=movie");
    expect((await movie!.json() as { records: unknown[] }).records).toHaveLength(1);
    expect((await tv!.json() as { records: unknown[] }).records).toHaveLength(0);
    expect((await other!.json() as { records: unknown[] }).records).toHaveLength(0);
  });

  it("no permite contaminar una clave válida con un tipo que el endpoint no acepta", async () => {
    const env = makeEnv();
    seedAward(env);
    await get(env, "/api/awards/media?tmdbId=1&type=%20tv%20");
    const response = await get(env, "/api/awards/media?tmdbId=1&type=tv");
    expect((await response!.json() as { records: unknown[] }).records).toHaveLength(0);
  });

  it("una ficha nueva no prolonga la vida de una cobertura a punto de caducar", async () => {
    const env = makeEnv();
    await get(env);
    vi.setSystemTime(Date.now() + 3_540_000);
    const response = await get(env, "/api/awards/media?tmdbId=2&type=movie");
    expect(response?.headers.get("Cache-Control")).toContain("max-age=60");
  });

  it("no reutiliza cobertura caducada aunque el almacén la devuelva", async () => {
    const env = makeEnv();
    await get(env);
    for (const entry of edge.entries.values()) entry.expiresAt = Number.POSITIVE_INFINITY;
    vi.setSystemTime(Date.now() + 3_601_000);
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    await get(env, "/api/awards/media?tmdbId=2&type=movie");
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM award_editions"))).toHaveLength(1);
  });

  it("no cachea errores de D1", async () => {
    const env = makeEnv();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare").mockImplementationOnce(() => {
      throw new Error("D1 temporalmente bloqueado");
    });
    expect((await get(env))?.status).toBe(502);
    prepare.mockRestore();
    expect((await get(env))?.status).toBe(200);
  });

  it("no cachea peticiones inválidas", async () => {
    const env = makeEnv();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    expect((await get(env, "/api/awards/media?type=movie"))?.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
    expect(edge.entries.size).toBe(0);
  });

  it("sigue funcionando cuando la infraestructura de caché no está disponible", async () => {
    vi.stubGlobal("caches", { open: vi.fn(async () => { throw new Error("cache unavailable"); }) });
    const env = makeEnv();
    expect((await get(env))?.status).toBe(200);
  });

  it("no convierte un error de escritura de caché en un error de la API", async () => {
    vi.spyOn(edge, "put").mockRejectedValue(new Error("cache full"));
    const env = makeEnv();
    expect((await get(env))?.status).toBe(200);
  });

  it("no convierte un error de lectura de caché en un error de la API", async () => {
    const match = vi.spyOn(edge, "match").mockImplementation(async request => {
      if (!request.url.endsWith("/revision")) throw new Error("cache unavailable");
      return undefined;
    });
    const env = makeEnv();
    expect((await get(env))?.status).toBe(200);
    expect(match).toHaveBeenCalled();
  });

  it("mantiene la API operativa al fallar la invalidación tras una escritura", async () => {
    const env = { ...makeEnv(), AWARDS_IMPORT_TOKEN: "secret" };
    vi.spyOn(edge, "put").mockRejectedValue(new Error("cache full"));
    const request = new Request("https://test/api/internal/awards/manifest/sync", {
      method: "POST", headers: { Authorization: "Bearer secret" },
    });
    expect((await handleAwardsRequest(request, env, new URL(request.url)))?.status).toBe(200);
  });

  it("invalida fichas y cobertura después de una escritura interna autorizada", async () => {
    const env = { ...makeEnv(), AWARDS_IMPORT_TOKEN: "secret" };
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    await get(env);
    const request = new Request("https://test/api/internal/awards/manifest/sync", {
      method: "POST", headers: { Authorization: "Bearer secret" },
    });
    expect((await handleAwardsRequest(request, env, new URL(request.url)))?.status).toBe(200);
    prepare.mockClear();
    const response = await get(env);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes("FROM award_editions"))).toHaveLength(1);
    const payload = await response!.json() as { coverage: { oscar: { expectedEditions: number[] } } };
    expect(payload.coverage.oscar.expectedEditions.length).toBeGreaterThan(0);
  });

  it("una escritura no autorizada no purga la caché", async () => {
    const env = { ...makeEnv(), AWARDS_IMPORT_TOKEN: "secret" };
    await get(env);
    const request = new Request("https://test/api/internal/awards/manifest/sync", { method: "POST" });
    expect((await handleAwardsRequest(request, env, new URL(request.url)))?.status).toBe(401);
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    await get(env);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("cachea personas sin confundir el nombre mostrado de una identidad no resuelta", async () => {
    const env = makeEnv();
    const prepare = vi.spyOn(env.AWARDS_DB, "prepare");
    const path = "/api/awards/person?tmdbId=500&name=Persona";
    expect((await get(env, path))?.status).toBe(200);
    const initialQueries = prepare.mock.calls.length;
    await get(env, path);
    expect(prepare).toHaveBeenCalledTimes(initialQueries);
    const other = await get(env, "/api/awards/person?tmdbId=500&name=Otro");
    expect(await other!.json()).toMatchObject({ personName: "Otro" });
  });
});
