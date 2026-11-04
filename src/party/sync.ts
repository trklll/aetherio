export interface PartyPlaybackState {
  seq: number;
  memberId: string;
  paused: boolean;
  position: number;
  rate: number;
  at: number;
}

export type PartyCorrection =
  | { type: "in-sync" }
  | { type: "seek"; position: number }
  | { type: "nudge"; rate: number };

/** Monotonic RTT sampling with the best (lowest latency) server-clock anchor. */
export class PartyClock {
  private offset = 0;
  private bestRtt = Number.POSITIVE_INFINITY;
  private sampled = false;

  addSample(serverTime: number, sentAt: number, receivedAt: number): void {
    if (![serverTime, sentAt, receivedAt].every(Number.isFinite) || receivedAt < sentAt) return;
    const rtt = receivedAt - sentAt;
    if (rtt > this.bestRtt) return;
    this.bestRtt = rtt;
    this.offset = serverTime + rtt / 2 - receivedAt;
    this.sampled = true;
  }

  now(localNow = Date.now()): number {
    return this.sampled ? localNow + this.offset : localNow;
  }

  reset(): void {
    this.offset = 0;
    this.bestRtt = Number.POSITIVE_INFINITY;
    this.sampled = false;
  }
}

export function expectedPartyPosition(state: PartyPlaybackState, now: number): number {
  if (state.paused) return Math.max(0, state.position);
  return Math.max(0, state.position + (Math.max(0, now - state.at) / 1000) * state.rate);
}

export function isNewerPartyState(candidate: PartyPlaybackState, current: PartyPlaybackState | null): boolean {
  if (!current) return true;
  if (candidate.seq !== current.seq) return candidate.seq > current.seq;
  return candidate.memberId > current.memberId;
}

export function getPartyCorrection(
  localPosition: number,
  state: PartyPlaybackState,
  now: number,
  nudging: boolean,
): PartyCorrection {
  const expected = expectedPartyPosition(state, now);
  const drift = localPosition - expected;
  const distance = Math.abs(drift);
  if (state.paused) return distance > 0.5 ? { type: "seek", position: expected } : { type: "in-sync" };
  if (distance > 3) return { type: "seek", position: expected };
  const threshold = nudging ? 0.08 : 0.25;
  if (distance > threshold) return { type: "nudge", rate: state.rate * (drift > 0 ? 0.95 : 1.05) };
  return { type: "in-sync" };
}
