import { describe, expect, it } from "vitest";
import {
  buildShareableOffer,
  describeUnshareableReason,
  type UnshareableReason,
} from "./streamShare";
import type { MediaStream } from "../types/stream";

const REASONS: UnshareableReason[] = [
  "sin stream",
  "archivo local",
  "iframe",
  "no portable",
  "torrent privado",
  "magnet con credenciales",
  "destino inválido",
];

describe("describeUnshareableReason", () => {
  it("explica cada motivo en español (sin claves crudas)", () => {
    for (const reason of REASONS) {
      const text = describeUnshareableReason(reason);
      expect(text.length).toBeGreaterThan(3);
      expect(text).not.toBe(reason);
    }
    expect(describeUnshareableReason(undefined)).toBe("no es compartible");
  });
});

describe("buildShareableOffer", () => {
  it("rechaza iframe con motivo (el anfitrión debe avisarlo, no silenciarlo)", () => {
    const stream = {
      id: "s1",
      url: "https://videos.example.com/embed/abc",
      behaviorHints: { scraperPlayback: "iframe" },
    } as unknown as MediaStream;
    expect(buildShareableOffer(stream)).toEqual({ reason: "iframe" });
  });

  it("rechaza destino inválido con motivo en vez de null", () => {
    const stream = { id: "s2", url: "" } as unknown as MediaStream;
    const result = buildShareableOffer(stream);
    expect(result.offer).toBeUndefined();
    expect(typeof result.reason).toBe("string");
  });

  it("comparte un https directo", () => {
    const stream = {
      id: "s3",
      url: "https://cdn.example.com/video/1080p.m3u8",
      title: "Prueba",
    } as unknown as MediaStream;
    const { offer } = buildShareableOffer(stream);
    expect(offer?.target).toBe("https://cdn.example.com/video/1080p.m3u8");
    expect(offer?.kind).toBe("https");
  });
});
