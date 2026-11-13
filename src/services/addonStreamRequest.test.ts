import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../runtime/platform.ts", () => ({
  invokeCommand: vi.fn(),
  isTauriRuntime: vi.fn(),
}));

import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import { fetchAddonStreamPayload } from "./addonStreamRequest.ts";

const invokeMock = vi.mocked(invokeCommand);
const isTauriMock = vi.mocked(isTauriRuntime);

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("fetchAddonStreamPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the native HTTP bridge in Tauri and decodes its JSON response", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      status: 200,
      statusText: "OK",
      bodyBase64: toBase64('{"streams":[{"name":"source"}]}'),
    });

    await expect(fetchAddonStreamPayload("https://addon.example/stream/movie/id.json", { timeoutMs: 6000 }))
      .resolves.toEqual({ json: { streams: [{ name: "source" }] }, status: 200 });

    expect(invokeMock).toHaveBeenCalledWith("provider_http_request", {
      request: {
        url: "https://addon.example/stream/movie/id.json",
        method: "GET",
        headers: { Accept: "application/json" },
        timeoutMs: 6000,
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces native HTTP errors without retrying through browser fetch", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue({
      status: 502,
      statusText: "Bad Gateway",
      bodyBase64: toBase64("upstream unavailable"),
    });

    await expect(fetchAddonStreamPayload("https://addon.example/stream/movie/id.json"))
      .rejects.toThrow("HTTP 502 Bad Gateway");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fall back to browser fetch when the native bridge fails", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue(new Error("bridge unavailable"));

    await expect(fetchAddonStreamPayload("https://addon.example/stream/movie/id.json"))
      .rejects.toThrow("bridge unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not start a request when its signal is already aborted", async () => {
    isTauriMock.mockReturnValue(true);
    const controller = new AbortController();
    controller.abort();

    await expect(fetchAddonStreamPayload("https://addon.example/stream/movie/id.json", {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses browser fetch outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    const response = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ streams: [] }),
    };
    vi.mocked(fetch).mockResolvedValue(response as unknown as Response);
    const controller = new AbortController();

    await expect(fetchAddonStreamPayload("https://addon.example/stream/movie/id.json", {
      signal: controller.signal,
      timeoutMs: 6000,
    })).resolves.toEqual({ json: { streams: [] }, status: 200 });

    expect(fetch).toHaveBeenCalledWith("https://addon.example/stream/movie/id.json", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
