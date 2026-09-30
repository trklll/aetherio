import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("../../../runtime/platform", () => ({ invokeCommand: invokeMock }));

import { fetchEmbeddedReferenceCues } from "./embeddedReference";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:03.000
Primera linea embebida

00:00:04.000 --> 00:00:06.000
Segunda linea embebida

00:00:07.000 --> 00:00:09.000
Tercera linea embebida
`;

function input(overrides: Partial<Parameters<typeof fetchEmbeddedReferenceCues>[0]> = {}) {
  return {
    url: "https://cdn.example/pelicula.mkv",
    localPath: null,
    streamUrl: "https://cdn.example/pelicula.mkv",
    headers: undefined,
    language: "spa",
    ...overrides,
  };
}

describe("referencia embebida para Auto Sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("pide la pista embebida y devuelve sus cues", async () => {
    invokeMock.mockResolvedValue(VTT);

    const cues = await fetchEmbeddedReferenceCues(input());

    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ startTimeMs: 1_000, endTimeMs: 3_000, text: "Primera linea embebida" });
    expect(invokeMock).toHaveBeenCalledWith("embedded_subtitle_text", expect.objectContaining({
      language: "spa",
      url: "https://cdn.example/pelicula.mkv",
    }));
  });

  it("devuelve lista vacia cuando el contenedor no trae subtitulos", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await fetchEmbeddedReferenceCues(input())).toEqual([]);
  });

  it("devuelve lista vacia si el backend falla", async () => {
    invokeMock.mockRejectedValue(new Error("HTTP 403"));
    expect(await fetchEmbeddedReferenceCues(input())).toEqual([]);
  });

  it("descarta una pista demasiado corta para servir de referencia", async () => {
    invokeMock.mockResolvedValue("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nUnica linea\n");
    expect(await fetchEmbeddedReferenceCues(input())).toEqual([]);
  });

  it("no invoca el backend sin un archivo que leer", async () => {
    expect(await fetchEmbeddedReferenceCues(input({ url: null, localPath: null }))).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("prefiere la ruta local cuando existe", async () => {
    invokeMock.mockResolvedValue(VTT);

    const cues = await fetchEmbeddedReferenceCues(input({ localPath: "C:\\videos\\pelicula.mkv" }));

    expect(cues).toHaveLength(3);
    expect(invokeMock).toHaveBeenCalledWith("embedded_subtitle_text", expect.objectContaining({
      localPath: "C:\\videos\\pelicula.mkv",
      url: null,
    }));
  });
});
