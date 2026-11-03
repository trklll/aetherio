import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSportsBody, fetchSportsText, publicSportsHttps } from "./fmhySportsHttp.ts";

const { nativeRuntime, invoke } = vi.hoisted(() => ({ nativeRuntime: vi.fn(() => false), invoke: vi.fn() }));
vi.mock("../runtime/platform.ts", () => ({ isTauriRuntime: nativeRuntime, invokeCommand: invoke }));
afterEach(() => { nativeRuntime.mockReturnValue(false); invoke.mockReset(); vi.unstubAllGlobals(); });
const url = "https://sportsbite.org/tlive/a";

describe("FMHY HTTP boundaries", () => {
  it.each(["http://sportsbite.org/a", "https://user:password@sportsbite.org/a", "https://127.1/a", "https://2130706433/a", "https://0x7f000001/a", "https://[::1]/a", "https://host.localhost/a", "https://host.internal/a", "file:///a", "data:abc", "https://sportsbite.org:8443/a", "https://sportsbite.org/a\r\nX:yes"])("rejects unsafe destination %s", async value => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(publicSportsHttps(value)).toBeNull();
    expect(await fetchSportsBody(value)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the native bounded transport and preserves UTF-8 and media bytes", async () => {
    nativeRuntime.mockReturnValue(true);
    const bytes = new TextEncoder().encode("Español ⚽");
    invoke.mockResolvedValue({ status: 200, url, bodyBase64: btoa(String.fromCharCode(...bytes)) });
    expect(await fetchSportsText(url, "https://sportsbite.org/")).toBe("Español ⚽");
    expect(invoke.mock.calls[0][1].request.headers.Referer).toBe("https://sportsbite.org/");
  });
  it.each([
    { status: 403, url, bodyBase64: "" },
    { status: 200, url: "https://other.example.com/a", bodyBase64: btoa("data") },
    { status: 200, url, bodyBase64: "!invalid" },
    { status: 200, url },
  ])("rejects native errors, cross-origin redirects and malformed bodies", async response => {
    nativeRuntime.mockReturnValue(true);
    invoke.mockResolvedValue(response);
    expect(await fetchSportsBody(url)).toBeNull();
  });
  it("does not accept oversized responses or a successful login redirect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("big", { headers: { "content-length": String(3 * 1024 * 1024) } })));
    expect(await fetchSportsBody(url)).toBeNull();
    const redirected = new Response("<html>login</html>");
    Object.defineProperty(redirected, "url", { value: "https://login.example.com/" });
    vi.stubGlobal("fetch", vi.fn(async () => redirected));
    expect(await fetchSportsBody(url)).toBeNull();
  });
  it("isolates network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchSportsBody(url)).toBeNull();
    nativeRuntime.mockReturnValue(true);
    invoke.mockRejectedValue(new Error("unavailable"));
    expect(await fetchSportsBody(url)).toBeNull();
  });
});
