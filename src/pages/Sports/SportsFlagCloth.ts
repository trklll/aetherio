/*
 * Adapted from WindyCloth by Sunil Tiwari (MIT), itself based on the
 * Three.js relaxed-constraint cloth example by the Three.js authors (MIT).
 * Sources and complete license notices: SportsFlagCloth.LICENSE.txt.
 * The Verlet integration, aerodynamic normal force and distance constraints
 * are retained; typed arrays, fixed stepping, shear/bend constraints and
 * reusable bicubic render buffers replace the demo's per-particle objects.
 */

export const FLAG_COLUMNS = 24;
export const FLAG_ROWS = 16;
const RENDER_COLUMNS = 72;
const RENDER_ROWS = 48;
const WIDTH = 4.8;
const HEIGHT = 3;
const STEP = 1 / 60;
const COUNT = (FLAG_COLUMNS + 1) * (FLAG_ROWS + 1);

let restPose: { positions: Float32Array; previous: Float32Array; time: number } | undefined;

/** Positive phase velocity: a gust travels from the hoist toward the right. */
export function sportsFlagGust(x: number, y: number, time: number): number {
  return Math.sin(time * 4.6 - x * 4 + y * .35) * 3.5;
}

function interpolationTable(segments: number, renderSegments: number) {
  const indices = new Uint16Array((renderSegments + 1) * 4);
  const weights = new Float32Array(indices.length);
  for (let i = 0; i <= renderSegments; i += 1) {
    const position = i * segments / renderSegments;
    const cell = Math.floor(position);
    const t = position - cell;
    const t2 = t * t;
    const t3 = t2 * t;
    const offset = i * 4;
    for (let k = 0; k < 4; k += 1) indices[offset + k] = Math.max(0, Math.min(segments, cell + k - 1));
    weights.set([-.5 * t + t2 - .5 * t3, 1 - 2.5 * t2 + 1.5 * t3, .5 * t + 2 * t2 - 1.5 * t3, -.5 * t2 + .5 * t3], offset);
  }
  return { indices, weights };
}

const horizontal = interpolationTable(FLAG_COLUMNS, RENDER_COLUMNS);
const vertical = interpolationTable(FLAG_ROWS, RENDER_ROWS);

export class SportsFlagCloth {
  readonly positions = new Float32Array(COUNT * 3);
  private readonly previous = new Float32Array(COUNT * 3);
  private readonly original = new Float32Array(COUNT * 3);
  private readonly normals = new Float32Array(COUNT * 3);
  private readonly inverseMass = new Float32Array(COUNT);
  private readonly springA: Uint16Array;
  private readonly springB: Uint16Array;
  private readonly springLength: Float32Array;
  private readonly springStiffness: Float32Array;
  private readonly sampled = new Float32Array(COUNT * 3);
  private readonly horizontalSamples = new Float32Array((FLAG_ROWS + 1) * (RENDER_COLUMNS + 1) * 3);
  readonly vertices = new Float32Array((RENDER_COLUMNS + 1) * (RENDER_ROWS + 1) * 8);
  readonly indices = new Uint16Array(RENDER_COLUMNS * RENDER_ROWS * 6);
  private accumulator = 0;
  private time = 0;

  constructor() {
    for (let y = 0; y <= FLAG_ROWS; y += 1) for (let x = 0; x <= FLAG_COLUMNS; x += 1) {
      const index = y * (FLAG_COLUMNS + 1) + x;
      const offset = index * 3;
      const u = x / FLAG_COLUMNS;
      const v = y / FLAG_ROWS;
      this.original[offset] = (u - .5) * WIDTH;
      this.original[offset + 1] = (.5 - v) * HEIGHT;
      this.positions[offset] = this.original[offset] - u * .4;
      this.positions[offset + 1] = this.original[offset + 1];
      // Only seed an initial imperfection; subsequent deformation is solved,
      // not prescribed by a sine-wave vertex shader.
      this.positions[offset + 2] = u * (.12 * Math.sin(u * 14 + v * .65) + .035 * Math.sin(u * 21 - v * .8));
      this.inverseMass[index] = x === 0 ? 0 : 1;
    }
    this.previous.set(this.positions);
    const starts: number[] = [], ends: number[] = [], lengths: number[] = [], stiffnesses: number[] = [];
    const connect = (x: number, y: number, dx: number, dy: number, stiffness: number) => {
      if (x + dx > FLAG_COLUMNS || y + dy > FLAG_ROWS || y + dy < 0) return;
      starts.push(y * (FLAG_COLUMNS + 1) + x);
      ends.push((y + dy) * (FLAG_COLUMNS + 1) + x + dx);
      lengths.push(Math.hypot(dx * WIDTH / FLAG_COLUMNS, dy * HEIGHT / FLAG_ROWS));
      stiffnesses.push(stiffness);
    };
    for (let y = 0; y <= FLAG_ROWS; y += 1) for (let x = 0; x <= FLAG_COLUMNS; x += 1) {
      connect(x, y, 1, 0, 1); connect(x, y, 0, 1, 1);
      connect(x, y, 1, 1, .35); connect(x, y, 1, -1, .35);
      connect(x, y, 2, 0, .015); connect(x, y, 0, 2, .015);
    }
    this.springA = new Uint16Array(starts); this.springB = new Uint16Array(ends);
    this.springLength = new Float32Array(lengths); this.springStiffness = new Float32Array(stiffnesses);
    let offset = 0;
    for (let y = 0; y <= RENDER_ROWS; y += 1) for (let x = 0; x <= RENDER_COLUMNS; x += 1) {
      const index = y * (RENDER_COLUMNS + 1) + x;
      this.vertices[index * 8 + 6] = x / RENDER_COLUMNS;
      this.vertices[index * 8 + 7] = y / RENDER_ROWS;
      if (x < RENDER_COLUMNS && y < RENDER_ROWS) {
        const below = index + RENDER_COLUMNS + 1;
        this.indices.set([index, below, index + 1, index + 1, below, below + 1], offset);
        offset += 6;
      }
    }
    if (restPose) {
      this.positions.set(restPose.positions); this.previous.set(restPose.previous); this.time = restPose.time;
    } else {
      // One deterministic settled pose per module, reused for every match.
      for (let i = 0; i < 30; i += 1) this.step();
      restPose = { positions: this.positions.slice(), previous: this.previous.slice(), time: this.time };
    }
  }

  advance(deltaSeconds: number): number {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
    this.accumulator += Math.min(deltaSeconds, STEP * 3);
    let steps = 0;
    while (this.accumulator + 1e-9 >= STEP && steps < 3) {
      this.step(); this.accumulator = Math.max(0, this.accumulator - STEP); steps += 1;
    }
    return steps;
  }

  private step() {
    const p = this.positions;
    const previous = this.previous;
    this.time += STEP;
    // Central-difference normals from the current geometry drive wind pressure.
    for (let y = 0; y <= FLAG_ROWS; y += 1) for (let x = 0; x <= FLAG_COLUMNS; x += 1) {
      const left = (y * (FLAG_COLUMNS + 1) + Math.max(0, x - 1)) * 3;
      const right = (y * (FLAG_COLUMNS + 1) + Math.min(FLAG_COLUMNS, x + 1)) * 3;
      const top = (Math.max(0, y - 1) * (FLAG_COLUMNS + 1) + x) * 3;
      const bottom = (Math.min(FLAG_ROWS, y + 1) * (FLAG_COLUMNS + 1) + x) * 3;
      const ax = p[right] - p[left], ay = p[right + 1] - p[left + 1], az = p[right + 2] - p[left + 2];
      const bx = p[top] - p[bottom], by = p[top + 1] - p[bottom + 1], bz = p[top + 2] - p[bottom + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const i = (y * (FLAG_COLUMNS + 1) + x) * 3;
      this.normals[i] = nx / length; this.normals[i + 1] = ny / length; this.normals[i + 2] = nz / length;
    }
    const windX = 9 + 2 * Math.sin(this.time * .7);
    const windZ = 1.5 + 1.5 * Math.sin(this.time * .9);
    for (let index = 0; index < COUNT; index += 1) {
      if (!this.inverseMass[index]) continue;
      const i = index * 3;
      const nx = this.normals[i], ny = this.normals[i + 1], nz = this.normals[i + 2];
      const u = index % (FLAG_COLUMNS + 1) / FLAG_COLUMNS;
      // Dissipate energy near the free hem instead of letting curls pile up
      // against the right side of a background-sized cloth.
      const drag = .97 - Math.max(0, u - .7) * .2;
      const gust = sportsFlagGust(this.original[i], this.original[i + 1], this.time);
      const pressure = nx * windX + nz * (windZ + gust);
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = x + (x - previous[i]) * drag + (3 + u + nx * pressure) * STEP * STEP;
      p[i + 1] = y + (y - previous[i + 1]) * drag + (-.45 + ny * pressure) * STEP * STEP;
      p[i + 2] = z + (z - previous[i + 2]) * drag + nz * pressure * STEP * STEP;
      previous[i] = x; previous[i + 1] = y; previous[i + 2] = z;
    }
    for (let iteration = 0; iteration < 3; iteration += 1) {
      for (let spring = 0; spring < this.springA.length; spring += 1) {
        const a = this.springA[spring], b = this.springB[spring];
        const wa = this.inverseMass[a], wb = this.inverseMass[b];
        if (wa + wb === 0) continue;
        const ai = a * 3, bi = b * 3;
        const dx = p[bi] - p[ai], dy = p[bi + 1] - p[ai + 1], dz = p[bi + 2] - p[ai + 2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance < 1e-8) continue;
        const correction = (1 - this.springLength[spring] / distance) * this.springStiffness[spring] / (wa + wb);
        p[ai] += dx * correction * wa; p[ai + 1] += dy * correction * wa; p[ai + 2] += dz * correction * wa;
        p[bi] -= dx * correction * wb; p[bi + 1] -= dy * correction * wb; p[bi + 2] -= dz * correction * wb;
      }
    }
  }

  writeVertices(): Float32Array {
    const alpha = this.accumulator / STEP;
    for (let i = 0; i < this.sampled.length; i += 1) this.sampled[i] = this.previous[i] + (this.positions[i] - this.previous[i]) * alpha;
    // Separable Catmull-Rom interpolation: a cheap solver grid does not imply
    // a faceted render mesh. Tables and scratch storage are allocated once.
    for (let y = 0; y <= FLAG_ROWS; y += 1) for (let x = 0; x <= RENDER_COLUMNS; x += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        let value = 0;
        for (let k = 0; k < 4; k += 1) value += this.sampled[(y * (FLAG_COLUMNS + 1) + horizontal.indices[x * 4 + k]) * 3 + axis] * horizontal.weights[x * 4 + k];
        this.horizontalSamples[(y * (RENDER_COLUMNS + 1) + x) * 3 + axis] = value;
      }
    }
    const vertices = this.vertices;
    for (let y = 0; y <= RENDER_ROWS; y += 1) for (let x = 0; x <= RENDER_COLUMNS; x += 1) {
      const offset = (y * (RENDER_COLUMNS + 1) + x) * 8;
      for (let axis = 0; axis < 3; axis += 1) {
        let value = 0;
        for (let k = 0; k < 4; k += 1) value += this.horizontalSamples[(vertical.indices[y * 4 + k] * (RENDER_COLUMNS + 1) + x) * 3 + axis] * vertical.weights[y * 4 + k];
        vertices[offset + axis] = value;
      }
    }
    for (let y = 0; y <= RENDER_ROWS; y += 1) for (let x = 0; x <= RENDER_COLUMNS; x += 1) {
      const left = (y * (RENDER_COLUMNS + 1) + Math.max(0, x - 1)) * 8;
      const right = (y * (RENDER_COLUMNS + 1) + Math.min(RENDER_COLUMNS, x + 1)) * 8;
      const top = (Math.max(0, y - 1) * (RENDER_COLUMNS + 1) + x) * 8;
      const bottom = (Math.min(RENDER_ROWS, y + 1) * (RENDER_COLUMNS + 1) + x) * 8;
      const ax = vertices[right] - vertices[left], ay = vertices[right + 1] - vertices[left + 1], az = vertices[right + 2] - vertices[left + 2];
      const bx = vertices[top] - vertices[bottom], by = vertices[top + 1] - vertices[bottom + 1], bz = vertices[top + 2] - vertices[bottom + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const offset = (y * (RENDER_COLUMNS + 1) + x) * 8;
      vertices[offset + 3] = nx / length; vertices[offset + 4] = ny / length; vertices[offset + 5] = nz / length;
    }
    return vertices;
  }
}
