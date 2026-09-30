const CONNECTION_SPEED_STORAGE_KEY = "aetherio:connection-speed:v1";
const SAMPLE_WINDOW_MS = 21 * 24 * 60 * 60 * 1_000;
const MAX_SAMPLES = 6;
const MIN_ACTIVE_MS = 3_000;
const MAX_ACTIVE_MS = 30_000;
const MIN_BYTES = 8 * 1024 * 1024;
const MAX_TICK_GAP_MS = 2_000;

export interface ConnectionSpeedSample {
  bytesPerSecond: number;
  recordedAt: number;
}

export interface ThroughputTick {
  sessionKey: string;
  at: number;
  fileLoaded: boolean;
  idle: boolean;
  bytesPerSecond: number;
  positionSeconds: number;
}

export interface ThroughputAccumulator {
  sessionKey: string;
  startedAt: number;
  lastAt: number;
  lastPositionSeconds: number;
  activeMs: number;
  bytes: number;
  speedIntegral: number;
}

export interface ThroughputResult {
  state: ThroughputAccumulator;
  completedSample: ConnectionSpeedSample | null;
}

export function createThroughputAccumulator(sessionKey: string, at = 0): ThroughputAccumulator {
  return {
    sessionKey,
    startedAt: at,
    lastAt: at,
    lastPositionSeconds: 0,
    activeMs: 0,
    bytes: 0,
    speedIntegral: 0,
  };
}

function resetAccumulator(tick: ThroughputTick): ThroughputAccumulator {
  return {
    ...createThroughputAccumulator(tick.sessionKey, tick.at),
    lastPositionSeconds: tick.positionSeconds,
  };
}

function completedFrom(state: ThroughputAccumulator): ConnectionSpeedSample | null {
  if (state.activeMs < MIN_ACTIVE_MS || state.bytes <= 0) return null;
  if (state.bytes < MIN_BYTES && state.activeMs < 10_000) return null;
  return {
    bytesPerSecond: Math.max(1, Math.round(state.speedIntegral / (state.activeMs / 1_000))),
    recordedAt: state.lastAt,
  };
}

export function accumulateThroughput(
  previous: ThroughputAccumulator,
  tick: ThroughputTick,
): ThroughputResult {
  let state = previous;
  if (tick.sessionKey !== state.sessionKey) {
    state = resetAccumulator(tick);
  } else {
    const deltaMs = tick.at - state.lastAt;
    const positionDelta = Math.abs(tick.positionSeconds - state.lastPositionSeconds);
    const expectedPositionDelta = Math.max(0, deltaMs / 1_000) * 4;
    if (deltaMs <= 0 || deltaMs > MAX_TICK_GAP_MS || positionDelta > expectedPositionDelta + 2.5) {
      state = resetAccumulator(tick);
    }
  }

  const deltaSeconds = Math.max(0, Math.min(MAX_TICK_GAP_MS, tick.at - state.lastAt)) / 1_000;
  const active = tick.fileLoaded && !tick.idle && Number.isFinite(tick.bytesPerSecond) && tick.bytesPerSecond > 0;
  if (!active || deltaSeconds <= 0) {
    return { state: resetAccumulator(tick), completedSample: null };
  }

  const remainingMs = Math.max(0, MAX_ACTIVE_MS - state.activeMs);
  const countedSeconds = Math.min(deltaSeconds, remainingMs / 1_000);
  const next: ThroughputAccumulator = {
    ...state,
    lastAt: state.lastAt + countedSeconds * 1_000,
    lastPositionSeconds: tick.positionSeconds,
    activeMs: state.activeMs + countedSeconds * 1_000,
    bytes: state.bytes + tick.bytesPerSecond * countedSeconds,
    speedIntegral: state.speedIntegral + tick.bytesPerSecond * countedSeconds,
  };
  const sample = completedFrom(next);
  return {
    state: sample ? resetAccumulator(tick) : next,
    completedSample: sample,
  };
}

export function estimateConnectionSpeed(
  samples: ConnectionSpeedSample[],
  now = Date.now(),
): number {
  const valid = samples.filter(sample => (
    Number.isFinite(sample.bytesPerSecond)
    && sample.bytesPerSecond > 0
    && Number.isFinite(sample.recordedAt)
    && sample.recordedAt <= now
    && now - sample.recordedAt <= SAMPLE_WINDOW_MS
  ));
  return valid.length ? Math.max(...valid.map(sample => sample.bytesPerSecond)) : 0;
}

export function readConnectionSpeedSamples(): ConnectionSpeedSample[] {
  try {
    const raw = localStorage.getItem(CONNECTION_SPEED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((sample): sample is ConnectionSpeedSample => (
      Boolean(sample)
      && typeof sample === "object"
      && Number.isFinite((sample as ConnectionSpeedSample).bytesPerSecond)
      && (sample as ConnectionSpeedSample).bytesPerSecond > 0
      && Number.isFinite((sample as ConnectionSpeedSample).recordedAt)
    ));
  } catch {
    return [];
  }
}

export function writeConnectionSpeedSamples(samples: ConnectionSpeedSample[], now = Date.now()): ConnectionSpeedSample[] {
  const retained = samples
    .filter(sample => sample.bytesPerSecond > 0 && sample.recordedAt <= now && now - sample.recordedAt <= SAMPLE_WINDOW_MS)
    .sort((left, right) => right.recordedAt - left.recordedAt)
    .slice(0, MAX_SAMPLES);
  try {
    localStorage.setItem(CONNECTION_SPEED_STORAGE_KEY, JSON.stringify(retained));
  } catch {}
  return retained;
}

export function recordConnectionSpeedSample(sample: ConnectionSpeedSample): void {
  writeConnectionSpeedSamples([...readConnectionSpeedSamples(), sample]);
}

export function getEstimatedConnectionSpeedBps(): number {
  return estimateConnectionSpeed(readConnectionSpeedSamples());
}

export function isNetworkSampleEligible(url: string | null | undefined): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname !== "localhost"
      && hostname !== "127.0.0.1"
      && hostname !== "::1"
      && !hostname.endsWith(".local")
      && !hostname.startsWith("192.168.")
      && !hostname.startsWith("10.")
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}
