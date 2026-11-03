import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchIptvBytes, fetchIptvText, probeIptvSource, publicIptvUrl } from "./iptvSportsHttp.ts";

const { native, invoke } = vi.hoisted(() => ({ native: vi.fn(() => false), invoke: vi.fn() }));
vi.mock("../runtime/platform.ts", () => ({ isTauriRuntime: native, invokeCommand: invoke }));
afterEach(() => { native.mockReturnValue(false); invoke.mockReset(); vi.unstubAllGlobals(); });

describe("IPTV transport boundaries", () => {
  it.each(["http://127.1/a", "http://2130706433/a", "http://0x7f000001/a", "http://10.0.0.1/a", "http://169.254.169.254/a", "http://192.168.1.1/a", "http://172.20.0.1/a", "http://[::ffff:127.0.0.1]/a", "file:///a", "https://user:pass@cdn.example.com/a", "http://localhost./a", "http://router.lan/a", "https://cdn.example.com/a\r\nX:yes"])("rejects unsafe URL %s before networking", async url => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(publicIptvUrl(url)).toBeNull();
    await expect(fetchIptvBytes(url)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows public HTTP IPTV servers, ports and literal public IPv4", () => {
    expect(publicIptvUrl("http://89.33.29.115:8080/sport/index.m3u8")).not.toBeNull();
  });
  it("handles gzip files, including guides incorrectly served with an .xml extension", async () => {
    const bytes = gzipSync(Buffer.from("<tv>Fútbol</tv>"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes)));
    expect(await fetchIptvText("https://guide.example.com/TV.xml")).toBe("<tv>Fútbol</tv>");
  });
  it("uses native HTTP without forwarding arbitrary M3U headers", async () => {
    native.mockReturnValue(true);
    invoke.mockResolvedValue({ status: 200, url: "https://cdn.example.com/live", bodyBase64: btoa("#EXTM3U") });
    await fetchIptvBytes("https://cdn.example.com/live", { Referer: "https://watch.example.com/", Cookie: "secret", Authorization: "secret", "User-Agent": "TV\r\nInjected: yes" });
    expect(invoke.mock.calls[0][1].request.headers).toEqual({ Accept: "*/*", Referer: "https://watch.example.com/" });
  });
  it("rejects oversized bodies and redirects to a local server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("abc", { headers: { "content-length": "90000000" } })));
    await expect(fetchIptvBytes("https://cdn.example.com/a")).rejects.toThrow();
    native.mockReturnValue(true);
    invoke.mockResolvedValue({ status: 200, url: "http://127.0.0.1/a", bodyBase64: btoa("abc") });
    await expect(fetchIptvBytes("https://cdn.example.com/a")).rejects.toThrow();
  });
  it("checks media bytes and rejects VOD, DRM, HTML and private segment targets", async () => {
    const source = { id: "a", label: "IPTV", url: "https://cdn.example.com/live.m3u8" };
    const bytes = new Uint8Array(564); bytes[0] = bytes[188] = bytes[376] = 0x47;
    const fetcher = vi.fn(async (url: string) => new Response(url.endsWith(".ts") ? bytes : "#EXTM3U\n#EXTINF:6,\nsegment.ts"));
    vi.stubGlobal("fetch", fetcher);
    expect(await probeIptvSource(source)).toBe(true);
    for (const body of ["<html>Login</html>", "#EXTM3U\n#EXT-X-ENDLIST\n#EXTINF:6,\na.ts", "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES\n#EXTINF:6,\na.ts", "#EXTM3U\n#EXTINF:6,\nhttp://127.1/a.ts"]) {
      fetcher.mockImplementation(async () => new Response(body));
      expect(await probeIptvSource(source)).toBe(false);
    }
  });
});
