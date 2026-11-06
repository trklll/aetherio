import { afterEach, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ isTauriRuntime: vi.fn(() => false), invokeCommand: vi.fn() }));
vi.mock("../runtime/platform", () => runtime);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); runtime.isTauriRuntime.mockReturnValue(false); });

it("only routes fixed sports data hosts and paths, never arbitrary URLs", async () => {
  const { sportsDataProxyPath } = await import("./sportsDataHttp");
  expect(sportsDataProxyPath("https://www.fotmob.com/api/data/teams?id=6398")).toBe("/api/sports-data/fotmob/teams?id=6398");
  expect(sportsDataProxyPath("https://data.fotmob.com/stats/131/season/123/goals.json")).toBe("/api/sports-data/fotmob-stats/stats/131/season/123/goals.json");
  expect(() => sportsDataProxyPath("https://evil.test/data")).toThrow();
  expect(() => sportsDataProxyPath("http://www.fotmob.com/api/data/teams?id=6398")).toThrow();
  expect(() => sportsDataProxyPath("https://www.fotmob.com@evil.test/api/data/teams")).toThrow();
  expect(() => sportsDataProxyPath("https://www.fotmob.com/api/data/../../admin")).toThrow();
});
it("uses the existing desktop HTTP bridge and decodes UTF-8, not a CORS-limited web fetch", async () => {
  const { sportsDataJson } = await import("./sportsDataHttp");
  runtime.isTauriRuntime.mockReturnValue(true);
  runtime.invokeCommand.mockResolvedValue({ status: 200, bodyBase64: Buffer.from(JSON.stringify({ name: "Perú" })).toString("base64") });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await sportsDataJson("https://www.fotmob.com/api/data/teams?id=987", { refresh: true })).toEqual({ name: "Perú" });
  expect(runtime.invokeCommand).toHaveBeenCalledWith("provider_http_request", expect.objectContaining({ request: expect.objectContaining({ method: "GET", url: "https://www.fotmob.com/api/data/teams?id=987" }) }));
  expect(fetch).not.toHaveBeenCalled();
});
it("HTTP errors are not cached and can be retried without a hidden fallback", async () => {
  const { sportsDataJson } = await import("./sportsDataHttp");
  const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 403 })).mockResolvedValueOnce(new Response('{"ok":true}'));
  vi.stubGlobal("fetch", fetch);
  await expect(sportsDataJson("https://www.fotmob.com/api/data/teams?id=986")).rejects.toThrow(/403/);
  expect(await sportsDataJson("https://www.fotmob.com/api/data/teams?id=986")).toEqual({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("identifies the native app honestly so FotMob does not reject an anonymous client", async () => {
  const { sportsDataJson } = await import("./sportsDataHttp");
  runtime.isTauriRuntime.mockReturnValue(true);
  runtime.invokeCommand.mockImplementation(async (_command, args) => {
    const identified = args.request.headers["User-Agent"] === "Aetherio/0.9.4 (local sports MVP)";
    return { status: identified ? 200 : 403, bodyBase64: Buffer.from('{"ok":true}').toString("base64") };
  });
  await expect(sportsDataJson("https://www.fotmob.com/api/data/teams?id=985", { refresh: true })).resolves.toEqual({ ok: true });
});
