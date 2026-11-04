import { describe, expect, it } from "vitest";
import {
  PartyClock,
  expectedPartyPosition,
  getPartyCorrection,
  isNewerPartyState,
  type PartyPlaybackState,
} from "./sync";

const state = (overrides: Partial<PartyPlaybackState> = {}): PartyPlaybackState => ({
  seq: 1,
  memberId: "host",
  paused: false,
  position: 10,
  rate: 1,
  at: 1_000,
  ...overrides,
});

describe("party playback synchronization", () => {
  it("estimates server time from the lowest-latency ping sample", () => {
    const clock = new PartyClock();
    clock.addSample(10_000, 1_000, 1_100);
    expect(clock.now(1_200)).toBe(10_150);
    clock.addSample(20_000, 1_000, 1_300);
    expect(clock.now(1_300)).toBe(10_250);
  });

  it("advances the shared position using the server clock and playback rate", () => {
    expect(expectedPartyPosition(state({ position: 10, at: 1_000, rate: 1.5 }), 2_000)).toBe(11.5);
    expect(expectedPartyPosition(state({ paused: true, position: 10, at: 1_000 }), 2_000)).toBe(10);
  });

  it("seeks large drift, nudges small drift, and restores base rate in sync", () => {
    expect(getPartyCorrection(10.5, state({ position: 10, at: 1_000 }), 1_000, false)).toEqual({ type: "nudge", rate: 0.95 });
    expect(getPartyCorrection(14, state({ position: 10, at: 1_000 }), 1_000, false)).toEqual({ type: "seek", position: 10 });
    expect(getPartyCorrection(10.05, state({ position: 10, at: 1_000 }), 1_000, true)).toEqual({ type: "in-sync" });
  });

  it("orders snapshots by sequence, then sender ID", () => {
    expect(isNewerPartyState(state({ seq: 2 }), state({ seq: 1 }))).toBe(true);
    expect(isNewerPartyState(state({ seq: 1, memberId: "z" }), state({ seq: 1, memberId: "a" }))).toBe(true);
    expect(isNewerPartyState(state(), state())).toBe(false);
  });
});
