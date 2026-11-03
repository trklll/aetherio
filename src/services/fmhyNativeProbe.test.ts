import { afterEach, describe, expect, it, vi } from "vitest";
import { probeFmhyNativeSource } from "./fmhyNativeProbe.ts";

vi.mock("../runtime/platform.ts", () => ({ isTauriRuntime: () => false, invokeCommand: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
const source = { id: "test", label: "Sports", url: "https://sportsbite.org/tlive/a" };
const media = "#EXTM3U\n#EXTINF:4,\nhttps://cdn.example.com/one.js\n";
function mockResponses(manifest: string, bytes: Uint8Array) {
  const fetcher = vi.fn(async (input: unknown) => String(input) === source.url ? new Response(manifest) : new Response(bytes as BodyInit, { status: 206 }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

describe("FMHY native media validation", () => {
  it("accepts real MPEG-TS even when the CDN uses a .js extension", async () => {
    const bytes = new Uint8Array(1024);
    bytes[0] = bytes[188] = bytes[376] = 0x47;
    const fetcher = mockResponses(media, bytes);
    expect(await probeFmhyNativeSource(source)).toBe(true);
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it.each([
    ["PNG", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["HTML", Array.from(new TextEncoder().encode("<html>error</html>"))],
    ["empty body", []],
  ])("rejects %s segments even after a successful HLS response", async (_label, bytes) => {
    mockResponses(media, Uint8Array.from(bytes as number[]));
    expect(await probeFmhyNativeSource(source)).toBe(false);
  });
  it("rejects VOD, encrypted streams, missing segments and local segment URLs before fetching bytes", async () => {
    for (const manifest of [media + "#EXT-X-ENDLIST", media + '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"', "<html>blocked</html>", "#EXTM3U\n", media.replace("https://cdn.example.com/one.js", "https://127.0.0.1/one.ts")]) {
      const fetcher = mockResponses(manifest, new Uint8Array());
      expect(await probeFmhyNativeSource(source)).toBe(false);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it("follows an HLS master and accepts a fragmented MP4 segment", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      if (String(input) === source.url) return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nhttps://cdn.example.com/variant.m3u8\n");
      if (String(input).endsWith(".m3u8")) return new Response(media);
      return new Response(Uint8Array.from([0, 0, 0, 24, 115, 116, 121, 112]), { status: 206 });
    }));
    expect(await probeFmhyNativeSource(source)).toBe(true);
  });
  it("fails closed on redirects to other origins, network errors and malformed playlists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await probeFmhyNativeSource(source)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(media, { status: 503 })));
    expect(await probeFmhyNativeSource(source)).toBe(false);
    expect(await probeFmhyNativeSource({ ...source, url: "file:///secret" })).toBe(false);
  });
});
