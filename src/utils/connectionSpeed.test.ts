import { describe, expect, it } from "vitest";
import type { MediaStream } from "../types/stream";
import {
  accumulateThroughput,
  createThroughputAccumulator,
  estimateConnectionSpeed,
} from "./connectionSpeed";
import { sortStreamsForPlayback } from "./streamPlaybackRanking";

const MIB = 1024 * 1024;

function stream(id: string, size: number, duration: number): MediaStream {
  return {
    id,
    addonId: "addon",
    addonName: "Proveedor",
    name: id,
    url: `https://cdn.example/${id}.mkv`,
    size,
    duration,
  };
}

describe("estimador de conexion", () => {
  it("acepta una sesion activa larga y rapida", () => {
    let state = createThroughputAccumulator("stream-a");
    let completed: number | null = null;
    for (let second = 0; second <= 12; second += 1) {
      const result = accumulateThroughput(state, {
        sessionKey: "stream-a",
        at: second * 1_000,
        fileLoaded: true,
        idle: false,
        bytesPerSecond: 5 * MIB,
        positionSeconds: second,
      });
      state = result.state;
      if (result.completedSample) completed = result.completedSample.bytesPerSecond;
    }
    expect(completed).toBe(5 * MIB);
  });

  it("descarta una sesion incompleta o interrumpida", () => {
    let state = createThroughputAccumulator("stream-a");
    const result = accumulateThroughput(state, {
      sessionKey: "stream-b",
      at: 0,
      fileLoaded: true,
      idle: false,
      bytesPerSecond: 20 * MIB,
      positionSeconds: 0,
    });
    state = result.state;
    expect(accumulateThroughput(state, {
      sessionKey: "stream-b",
      at: 4_000,
      fileLoaded: true,
      idle: true,
      bytesPerSecond: 0,
      positionSeconds: 3,
    }).completedSample).toBeNull();
  });

  it("usa la muestra valida mas reciente dentro de la ventana", () => {
    const now = 20 * 24 * 60 * 60 * 1_000;
    expect(estimateConnectionSpeed([
      { bytesPerSecond: 2 * MIB, recordedAt: now - 2_000 },
      { bytesPerSecond: 7 * MIB, recordedAt: now - 20 * 24 * 60 * 60 * 1_000 },
    ], now)).toBe(7 * MIB);
    expect(estimateConnectionSpeed([
      { bytesPerSecond: 8 * MIB, recordedAt: now - 22 * 24 * 60 * 60 * 1_000 },
    ], now)).toBe(0);
  });
});

describe("orden de fuentes", () => {
  it("coloca arriba la mejor calidad que cabe segun velocidad aprendida", () => {
    const sources = [
      stream("720", 750 * MIB, 2_500),
      stream("1080", 1_500 * MIB, 2_500),
      stream("2160", 20_100 * MIB, 2_500),
      {
        id: "unknown",
        addonId: "addon",
        addonName: "Proveedor",
        name: "unknown",
        url: "https://cdn.example/unknown.mkv",
      } satisfies MediaStream,
    ];

    const ranked = sortStreamsForPlayback(sources, { connectionSpeedBps: 12 * MIB * 8 });
    expect(ranked.map(item => item.id)).toEqual(["1080", "720", "unknown", "2160"]);
  });
});
