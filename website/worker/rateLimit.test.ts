import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientRateKey, parseRateRule, resetRateLimits } from "./rateLimit";

const RULE = { limit: 3, windowMs: 10_000 };

beforeEach(() => {
  resetRateLimits();
});

describe("checkRateLimit", () => {
  it("deja pasar hasta el limite y luego corta", () => {
    expect(checkRateLimit("k", RULE, 0).allowed).toBe(true);
    expect(checkRateLimit("k", RULE, 0).allowed).toBe(true);
    expect(checkRateLimit("k", RULE, 0)).toMatchObject({ allowed: true, remaining: 0 });
    expect(checkRateLimit("k", RULE, 0)).toMatchObject({ allowed: false, retryAfterSeconds: 10 });
  });

  it("arranca una ventana nueva al vencer la anterior", () => {
    checkRateLimit("k", RULE, 0);
    checkRateLimit("k", RULE, 0);
    checkRateLimit("k", RULE, 0);
    expect(checkRateLimit("k", RULE, 9_999).allowed).toBe(false);
    expect(checkRateLimit("k", RULE, 10_000).allowed).toBe(true);
  });

  it("cuenta por clave: una IP no agota el cupo de otra", () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit("api:1.1.1.1", RULE, 0);
    expect(checkRateLimit("api:1.1.1.1", RULE, 0).allowed).toBe(false);
    expect(checkRateLimit("api:2.2.2.2", RULE, 0).allowed).toBe(true);
  });

  it("separa cubos: imagenes no consumen el cupo de la API", () => {
    for (let i = 0; i < 3; i += 1) checkRateLimit("image:1.1.1.1", RULE, 0);
    expect(checkRateLimit("image:1.1.1.1", RULE, 0).allowed).toBe(false);
    expect(checkRateLimit("api:1.1.1.1", RULE, 0).allowed).toBe(true);
  });

  it("nunca devuelve Retry-After 0 al cortar", () => {
    checkRateLimit("k", { limit: 1, windowMs: 300 }, 0);
    expect(checkRateLimit("k", { limit: 1, windowMs: 300 }, 299)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });
});

describe("clientRateKey", () => {
  function withHeaders(headers: Record<string, string>): Request {
    return new Request("https://trkll.aetherio.workers.dev/api/tmdb/movie/1", { headers });
  }

  it("usa CF-Connecting-IP", () => {
    expect(clientRateKey(withHeaders({ "CF-Connecting-IP": "9.9.9.9" }), "api")).toBe("api:9.9.9.9");
  });

  it("cae a la primera IP de X-Forwarded-For", () => {
    const req = withHeaders({ "X-Forwarded-For": "8.8.8.8, 10.0.0.1" });
    expect(clientRateKey(req, "api")).toBe("api:8.8.8.8");
  });

  it("usa anon cuando no hay ninguna cabecera", () => {
    expect(clientRateKey(withHeaders({}), "image")).toBe("image:anon");
  });
});

describe("parseRateRule", () => {
  it("lee limite:segundos", () => {
    expect(parseRateRule("90:15", { limit: 1, windowMs: 1 })).toEqual({ limit: 90, windowMs: 15_000 });
  });

  it("asume 30s si no hay ventana", () => {
    expect(parseRateRule("45", { limit: 1, windowMs: 1 })).toEqual({ limit: 45, windowMs: 30_000 });
  });

  it("cae al valor por defecto ante configuracion invalida", () => {
    const fallback = { limit: 7, windowMs: 7_000 };
    expect(parseRateRule(undefined, fallback)).toBe(fallback);
    expect(parseRateRule("", fallback)).toBe(fallback);
    expect(parseRateRule("abc", fallback)).toBe(fallback);
    expect(parseRateRule("0", fallback)).toBe(fallback);
    expect(parseRateRule("-5", fallback)).toBe(fallback);
    expect(parseRateRule("10:0", fallback)).toBe(fallback);
  });
});
