import { describe, expect, it } from "vitest";
import { SportsFlagCloth, FLAG_COLUMNS, FLAG_ROWS, sportsFlagGust } from "./SportsFlagCloth";

describe("WindyCloth adaptation", () => {
  it("carries gentle gusts to the right, never reversing their propagation", () => {
    for (const x of [-2, -.5, 0, 1, 2]) for (const time of [0, 1, 5, 20]) {
      expect(sportsFlagGust(x + .46, .2, time + .4)).toBeCloseTo(sportsFlagGust(x, .2, time), 8);
      expect(Math.abs(sportsFlagGust(x, .2, time))).toBeLessThanOrEqual(3.5);
    }
  });
  it("shares a deterministic, already billowing preview pose without shared mutable state", () => {
    const preview = new SportsFlagCloth();
    const detail = new SportsFlagCloth();
    expect(detail.positions).toEqual(preview.positions);
    expect(detail.writeVertices()).toEqual(preview.writeVertices());
    const frozen = preview.positions.slice();
    for (let frame = 0; frame < 60; frame += 1) detail.advance(1 / 60);
    expect(preview.positions).toEqual(frozen);
    expect(detail.positions).not.toEqual(frozen);
  });

  it("pins only the hoist and keeps the cloth finite under sustained wind", () => {
    const cloth = new SportsFlagCloth();
    const pins = Array.from({ length: FLAG_ROWS + 1 }, (_, y) => cloth.positions.slice(y * (FLAG_COLUMNS + 1) * 3, y * (FLAG_COLUMNS + 1) * 3 + 3));
    for (let frame = 0; frame < 900; frame += 1) cloth.advance(1 / 60);
    pins.forEach((pin, y) => expect(cloth.positions.slice(y * (FLAG_COLUMNS + 1) * 3, y * (FLAG_COLUMNS + 1) * 3 + 3)).toEqual(pin));
    expect(cloth.positions.every(Number.isFinite)).toBe(true);
    expect(Math.max(...cloth.positions.map(Math.abs))).toBeLessThan(10);
  });

  it("uses fixed simulation steps, independent of the display refresh rate", () => {
    const sixty = new SportsFlagCloth();
    const fast = new SportsFlagCloth();
    for (let frame = 0; frame < 60; frame += 1) sixty.advance(1 / 60);
    for (let frame = 0; frame < 144; frame += 1) fast.advance(1 / 144);
    expect(fast.positions).toEqual(sixty.positions);
  });

  it("bounds catch-up after stalls and ignores invalid time deltas", () => {
    const cloth = new SportsFlagCloth();
    const initial = cloth.positions.slice();
    expect(cloth.advance(Number.NaN)).toBe(0);
    expect(cloth.advance(-1)).toBe(0);
    expect(cloth.advance(0)).toBe(0);
    expect(cloth.positions).toEqual(initial);
    expect(cloth.advance(30)).toBeLessThanOrEqual(3);
  });

  it("reuses render buffers and produces smooth, normalized geometric normals", () => {
    const cloth = new SportsFlagCloth();
    const first = cloth.writeVertices();
    const indices = cloth.indices;
    cloth.advance(1 / 60);
    expect(cloth.writeVertices()).toBe(first);
    expect(cloth.indices).toBe(indices);
    expect(first.every(Number.isFinite)).toBe(true);
    for (let offset = 0; offset < first.length; offset += 8) {
      expect(Math.hypot(first[offset + 3], first[offset + 4], first[offset + 5])).toBeCloseTo(1, 4);
      expect(first[offset + 6]).toBeGreaterThanOrEqual(0);
      expect(first[offset + 6]).toBeLessThanOrEqual(1);
    }
  });
});
