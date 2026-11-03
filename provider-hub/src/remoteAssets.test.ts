import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetError, fetchPublicAsset, publicHttpsUrl } from "./remoteAssets.ts";

describe("bounded remote addon assets", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "http://example.org/file", "https://user:pass@example.org/file", "https://localhost/file",
    "https://10.0.0.1/file", "https://127.1/file", "https://[::1]/file", "https://app.local/file",
    "https://metadata.google.internal/file", "https://example.org:8080/file", "invalid",
  ])("rejects unsafe URL %s", value => { expect(publicHttpsUrl(value)).toBeNull(); });

  it("accepts a normal HTTPS asset", () => {
    expect(publicHttpsUrl("https://cdn.example.org/file")?.href).toBe("https://cdn.example.org/file");
  });

  it("follows a bounded, validated redirect without forwarding credentials", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/final" } }))
      .mockResolvedValueOnce(new Response("ok", { headers: { "content-type": "application/json; charset=utf-8" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchPublicAsset("https://cdn.example.org/file", 8);
    expect(new TextDecoder().decode(result.bytes)).toBe("ok");
    expect(result.contentType).toBe("application/json");
    expect(fetchMock.mock.calls[1][0]).toBe("https://cdn.example.org/final");
  });

  it("blocks a redirect to a local address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/file" } })));
    await expect(fetchPublicAsset("https://cdn.example.org/file", 8)).rejects.toMatchObject({ status: 400 });
  });

  it("stops redirect loops", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicAsset("https://cdn.example.org/file", 8)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    { response: () => new Response("oversized", { headers: { "content-length": "100" } }), status: 413 },
    { response: () => new Response("oversized"), status: 413 },
    { response: () => new Response("no", { status: 403 }), status: 502 },
    { response: () => new Response(null), status: 422 },
    { response: () => new Response(""), status: 422 },
  ])("rejects failed, empty or oversized bodies ($status)", async ({ response, status }) => {
    vi.stubGlobal("fetch", vi.fn(async () => response()));
    await expect(fetchPublicAsset("https://cdn.example.org/file", 4)).rejects.toMatchObject({ status });
  });

  it("reports a network error without exposing the URL or credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private upstream details"); }));
    await expect(fetchPublicAsset("https://cdn.example.org/file", 8)).rejects.toEqual(new AssetError("No se pudo descargar el recurso remoto.", 502));
  });
});
