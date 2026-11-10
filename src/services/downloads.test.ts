import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeCommand, isTauriRuntime } = vi.hoisted(() => ({
  invokeCommand: vi.fn(),
  isTauriRuntime: vi.fn(() => true),
}));

vi.mock("../runtime/platform", () => ({
  invokeCommand,
  isTauriRuntime,
  listenPlatformEvent: vi.fn(),
}));

import { startDownload } from "./downloads";
import { saveDownloadsEnabled } from "../config/downloadPreferences";

function mockStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
}

describe("startDownload", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockStorage();
    vi.clearAllMocks();
    isTauriRuntime.mockReturnValue(true);
  });

  it("rechaza nuevas descargas hasta que se habiliten explícitamente", async () => {
    await expect(startDownload({ target: "https://example.com/video.m3u8", title: "Demo" }))
      .rejects.toThrow("Las descargas están desactivadas en Ajustes.");

    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("envía la solicitud cuando las descargas están habilitadas", async () => {
    const request = { target: "https://example.com/video.m3u8", title: "Demo" };
    const response = { id: "download-1", ...request };
    invokeCommand.mockResolvedValue(response);
    saveDownloadsEnabled(true);

    await expect(startDownload(request)).resolves.toBe(response);
    expect(invokeCommand).toHaveBeenCalledWith("download_start", { request });
  });
});
