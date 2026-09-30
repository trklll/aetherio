import { describe, expect, it } from "vitest";
import type { SubtitleSyncCue } from "./parser";
import { buildAutoSubtitleSyncPlan } from "./autoSync";

function makeCues(count: number, stepMs = 3_000): SubtitleSyncCue[] {
  return Array.from({ length: count }, (_, index) => ({
    startTimeMs: index * stepMs,
    endTimeMs: index * stepMs + 1_800,
    text: `Linea exacta ${index}`,
  }));
}

function shift(cue: SubtitleSyncCue, startTimeMs: number): SubtitleSyncCue {
  const rounded = Math.round(startTimeMs);
  return { startTimeMs: rounded, endTimeMs: rounded + (cue.endTimeMs - cue.startTimeMs), text: cue.text };
}

// Una pelicula larga son 1500-2500 lineas. El analisis se dispara solo al elegir
// un subtitulo, asi que un accidentally-cuadratico congelaria el reproductor:
// este test es la red que lo evita.
describe("Auto Sync sobre un archivo largo", () => {
  it("resuelve 2000 lineas en un tiempo utilizable", () => {
    const reference = makeCues(2_000);
    const target = reference.map(cue => shift(cue, cue.startTimeMs - 1_000));

    const started = performance.now();
    const plan = buildAutoSubtitleSyncPlan(target, [reference]);
    const elapsedMs = performance.now() - started;

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("delay");
    // Margen amplio a proposito: mide una regresion cuadratica, no el jitter.
    expect(elapsedMs).toBeLessThan(8_000);
  });

  it("encuentra el tramo escalado en un archivo largo", () => {
    const reference = makeCues(2_000);
    const boundaryIndex = 1_000;
    const boundary = reference[boundaryIndex].startTimeMs;
    const target = reference.map((cue, index) => shift(
      cue,
      index < boundaryIndex
        ? cue.startTimeMs - 1_000
        : boundary + (cue.startTimeMs - boundary) / 2,
    ));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("retime");
    expect(plan.anchors.some(anchor => Math.abs(anchor.scale - 2) < 0.01)).toBe(true);
    expect(Math.abs(plan.cues[1_500].startTimeMs - reference[1_500].startTimeMs)).toBeLessThanOrEqual(600);
  });
});
