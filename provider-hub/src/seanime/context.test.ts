import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, publicUrl } from "./context.ts";

const meta = { id: "test", name: "Test", lang: "ja" };
afterEach(() => vi.unstubAllGlobals());

describe("bounded, invocation-local Seanime HTTP compatibility", () => {
  it.each(["file:///private", "https://127.0.0.1/a", "https://[::1]/a", "https://localhost/a", "https://service.local/a", "https://user:pass@example.com", "https://127.0.0.1.nip.io/"])("rejects non-public URLs: %s", value => {
    expect(() => publicUrl(value)).toThrow();
  });
  it("limits unique requests without counting repeated reads of an already materialized response", async () => {
    const network = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", network);
    const ctx = createContext(meta, {}, new AbortController().signal);
    for (let i = 0; i < 24; i++) await ctx.fetch(`https://public.example/${i}`);
    expect((await ctx.fetch("https://public.example/0")).text()).toBe("ok");
    await expect(ctx.fetch("https://public.example/25")).rejects.toThrow(/presupuesto/);
    expect(network).toHaveBeenCalledTimes(24);
  });
  it("does not leak authorization or cookies across redirects", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init.headers) });
      return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://cdn.example/final", "set-cookie": "session=private; Path=/; Secure" } }) : new Response("done");
    }));
    const ctx = createContext(meta, {}, new AbortController().signal);
    const response = await ctx.fetch("https://public.example/start", { headers: { Cookie: "private=1", Authorization: "Bearer private" } });
    expect(response.text()).toBe("done");
    expect(calls[1].headers.has("cookie")).toBe(false);
    expect(calls[1].headers.has("authorization")).toBe(false);
  });
  it("rejects oversized responses before parsing and respects an already aborted call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("small", { headers: { "content-length": String(9 * 1024 * 1024) } })));
    const controller = new AbortController();
    const ctx = createContext(meta, {}, controller.signal);
    await expect(ctx.fetch("https://public.example/large")).rejects.toThrow(/grande/);
    controller.abort();
    await expect(ctx.fetch("https://public.example/after-abort")).rejects.toThrow(/agotado/);
  });
  it("preserves binary torrent bytes for synchronous SHA-1 helpers", async () => {
    const bytes = new Uint8Array([100, 49, 58, 120, 49, 58, 255, 101]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { headers: { "content-type": "application/x-bittorrent" } })));
    const response = await createContext(meta, {}, new AbortController().signal).fetch("https://public.example/file.torrent");
    expect(response.text().charCodeAt(6)).toBe(255);
    expect(new Uint8Array(response.arrayBuffer())).toEqual(bytes);
  });
  it("bounds total materialized data across an invocation, not just each response", async () => {
    const body = new Uint8Array(6 * 1024 * 1024);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const ctx = createContext(meta, {}, new AbortController().signal);
    await ctx.fetch("https://public.example/1");
    await ctx.fetch("https://public.example/2");
    await expect(ctx.fetch("https://public.example/3")).rejects.toThrow(/presupuesto de datos/);
  });
  it("supplies local preferences/store without sharing state between calls", () => {
    const a = createContext({ ...meta, config: { category: "1_4" } }, {}, new AbortController().signal);
    const b = createContext(meta, {}, new AbortController().signal);
    a.$store.set("key", { data: 42 });
    expect(a.$store.has("key")).toBe(true);
    expect(b.$store.has("key")).toBe(false);
    expect(a.$store.get("key")).toEqual({ data: 42 });
    a.$store.remove("key");
    expect(a.$store.has("key")).toBe(false);
    expect(a.$getUserPreference("category")).toBe("1_4");
    expect(a.$isOffline()).toBe(false);
    expect(a.$toString(new Uint8Array([65]))).toBe("A");
    expect(a.$toString({ x: 1 })).toBe('{"x":1}');
    expect(a.$toBytes("A")).toEqual(new Uint8Array([65]));
  });
});
