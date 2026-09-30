import { describe, expect, it } from "vitest";
import type { SubtitleSyncCue } from "./parser";
import { buildAutoSubtitleSyncPlan } from "./autoSync";

function makeCues(count: number, stepMs = 10_000): SubtitleSyncCue[] {
  return Array.from({ length: count }, (_, index) => ({
    startTimeMs: index * stepMs,
    endTimeMs: index * stepMs + 1_800,
    text: `Linea exacta ${index}`,
  }));
}

describe("Auto Sync local", () => {
  it("corrige un retraso uniforme sin reescribir los cues", () => {
    const reference = makeCues(36);
    const target = reference.map(cue => ({
      ...cue,
      startTimeMs: cue.startTimeMs - 1_250,
      endTimeMs: cue.endTimeMs - 1_250,
    }));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("delay");
    expect(plan.delayMs).toBe(1_250);
    expect(plan.cues).toEqual(target);
  });

  it("corrige deriva de framerate preservando duraciones", () => {
    const reference = makeCues(48);
    const target = reference.map(cue => ({
      startTimeMs: Math.round(1_200 + cue.startTimeMs / 1.043),
      endTimeMs: Math.round(1_200 + cue.startTimeMs / 1.043) + (cue.endTimeMs - cue.startTimeMs),
      text: cue.text,
    }));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("retime");
    expect(plan.scale).toBeCloseTo(1.043, 2);
    reference.slice(2, -2).forEach((cue, index) => {
      expect(Math.abs(plan.cues[index + 2].startTimeMs - cue.startTimeMs)).toBeLessThanOrEqual(300);
      expect(plan.cues[index + 2].endTimeMs - plan.cues[index + 2].startTimeMs).toBe(cue.endTimeMs - cue.startTimeMs);
    });
  });

  it("recupera un corte extendido con offsets por segmentos", () => {
    const reference = makeCues(60);
    const target = reference.map((cue, index) => ({
      startTimeMs: cue.startTimeMs + (index < 30 ? -1_000 : 1_500),
      endTimeMs: cue.endTimeMs + (index < 30 ? -1_000 : 1_500),
      text: cue.text,
    }));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("retime");
    expect(Math.abs(plan.cues[10].startTimeMs - reference[10].startTimeMs)).toBeLessThanOrEqual(300);
    expect(Math.abs(plan.cues[45].startTimeMs - reference[45].startTimeMs)).toBeLessThanOrEqual(300);
  });

  it("empareja ocurrencias repetidas en orden temporal", () => {
    const reference = Array.from({ length: 60 }, (_, index) => ({
      startTimeMs: index * 6_000,
      endTimeMs: index * 6_000 + 1_500,
      text: index % 2 === 0 ? "Repetida A" : "Repetida B",
    }));
    const target = reference.map((cue, index) => ({
      ...cue,
      startTimeMs: cue.startTimeMs + (index < 30 ? -1_000 : 1_500),
      endTimeMs: cue.endTimeMs + (index < 30 ? -1_000 : 1_500),
    }));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("retime");
    expect(Math.abs(plan.cues[10].startTimeMs - reference[10].startTimeMs)).toBeLessThanOrEqual(300);
    expect(Math.abs(plan.cues[45].startTimeMs - reference[45].startTimeMs)).toBeLessThanOrEqual(300);
  });

  it("mantiene el timing original cuando no hay evidencia suficiente", () => {
    const target = makeCues(7, 11_000);
    const unrelated = makeCues(6, 17_000).map((cue, index) => ({ ...cue, text: `Otro ${index}` }));

    const plan = buildAutoSubtitleSyncPlan(target, [unrelated]);

    expect(plan.confident).toBe(false);
    expect(plan.mode).toBe("unchanged");
    expect(plan.cues).toEqual(target);
  });
});

describe("Auto Sync banded (DP)", () => {
  const BOUNDARY_INDEX = 30;

  // Segunda mitad del objetivo reproducida a otra velocidad: los subtitulos de
  // referencia avanzan mas rapido que en el archivo local, asi que hace falta un
  // tramo con escala y no solo un desplazamiento.
  function makeBandedTarget(rate: number): SubtitleSyncCue[] {
    const reference = makeCues(60);
    const boundary = reference[BOUNDARY_INDEX].startTimeMs;
    return reference.map((cue, index) => {
      const startTimeMs = index < BOUNDARY_INDEX
        ? cue.startTimeMs - 1_000
        : boundary + (cue.startTimeMs - boundary) / rate;
      return {
        startTimeMs: Math.round(startTimeMs),
        endTimeMs: Math.round(startTimeMs) + (cue.endTimeMs - cue.startTimeMs),
        text: cue.text,
      };
    });
  }

  it("recupera un tramo a media velocidad con escala 2", () => {
    const reference = makeCues(60);
    const plan = buildAutoSubtitleSyncPlan(makeBandedTarget(2), [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("retime");
    expect(plan.anchors.length).toBeGreaterThanOrEqual(2);
    expect(plan.anchors.some(anchor => Math.abs(anchor.scale - 2) < 0.01)).toBe(true);
    expect(Math.abs(plan.cues[10].startTimeMs - reference[10].startTimeMs)).toBeLessThanOrEqual(300);
    expect(Math.abs(plan.cues[50].startTimeMs - reference[50].startTimeMs)).toBeLessThanOrEqual(600);
  });

  it("recupera un tramo a un tercio de velocidad con escala 3", () => {
    const reference = makeCues(60);
    const plan = buildAutoSubtitleSyncPlan(makeBandedTarget(3), [reference]);

    expect(plan.confident).toBe(true);
    expect(plan.mode).toBe("retime");
    expect(plan.anchors.some(anchor => Math.abs(anchor.scale - 3) < 0.01)).toBe(true);
    expect(Math.abs(plan.cues[50].startTimeMs - reference[50].startTimeMs)).toBeLessThanOrEqual(600);
  });

  it("conserva la duracion de cada cue al reescalar un tramo", () => {
    const reference = makeCues(60);
    const plan = buildAutoSubtitleSyncPlan(makeBandedTarget(2), [reference]);

    const durations = reference.map(cue => cue.endTimeMs - cue.startTimeMs);
    expect(plan.cues).toHaveLength(reference.length);
    plan.cues.forEach((cue, index) => {
      expect(cue.endTimeMs - cue.startTimeMs).toBe(durations[index]);
    });
  });

  it("no divide en tramos lo que ya cabe en un retraso uniforme", () => {
    const reference = makeCues(36);
    const target = reference.map(cue => ({
      ...cue,
      startTimeMs: cue.startTimeMs - 1_250,
      endTimeMs: cue.endTimeMs - 1_250,
    }));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.mode).toBe("delay");
    expect(plan.anchors).toEqual([]);
    expect(plan.delayMs).toBe(1_250);
  });

  it("no inventa tramos cuando el desplazamiento ya cambia una vez", () => {
    const reference = makeCues(60);
    const target = reference.map((cue, index) => ({
      startTimeMs: cue.startTimeMs + (index < 30 ? -1_000 : 1_500),
      endTimeMs: cue.endTimeMs + (index < 30 ? -1_000 : 1_500),
      text: cue.text,
    }));

    const plan = buildAutoSubtitleSyncPlan(target, [reference]);

    expect(plan.mode).toBe("retime");
    expect(plan.anchors.every(anchor => anchor.scale === 1)).toBe(true);
  });
});
