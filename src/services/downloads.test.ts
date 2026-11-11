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

import { createDownloadRequest, getOpenSubtitlesForDownload, startDownload } from "./downloads";
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

  it("incluye los subtítulos de OpenSubtitles en la solicitud de descarga", () => {
    const subtitles = [{
      url: "https://subs.example/movie.es.srt",
      lang: "es",
      label: "Español - OpenSubtitles",
      format: "srt",
    }];

    const request = createDownloadRequest(
      { id: "stream-1", url: "https://media.example/movie.mp4" } as any,
      { title: "Demo", subtitles },
      "https://media.example/movie.mp4",
    );

    expect(request.subtitles).toEqual(subtitles);
  });

  it("selecciona solo URLs HTTP(S) únicas del addon OpenSubtitles", () => {
    const sources = [
      { id: "1", addonId: "community.opensubtitles", addonName: "OpenSubtitles", url: "https://subs.example/a.srt", lang: "es", label: "Español", format: "srt" },
      { id: "2", addonId: "community.opensubtitles", addonName: "OpenSubtitles", url: "https://subs.example/a.srt", lang: "es", label: "Duplicado", format: "srt" },
      { id: "3", addonId: "other", addonName: "Other Subs", url: "https://subs.example/b.srt", lang: "en", label: "English" },
      { id: "4", addonId: "community.opensubtitles", addonName: "OpenSubtitles", url: "file:///tmp/sub.srt", lang: "es", label: "Local" },
    ];

    expect(getOpenSubtitlesForDownload(sources)).toEqual([{
      url: "https://subs.example/a.srt",
      lang: "es",
      label: "Español",
      format: "srt",
    }]);
  });

  it("ignora referencias mal formadas sin fallar la preparación de descarga", () => {
    expect(getOpenSubtitlesForDownload([{
      id: "bad",
      addonId: "community.opensubtitles",
      addonName: "OpenSubtitles",
      url: "not a URL",
      lang: "es",
      label: "Español",
    }])).toEqual([]);
  });
});
