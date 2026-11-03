import { describe, expect, it } from "vitest";
import { failureFromMpvEvent, liveRetryDelay, LIVE_LOAD_FAILURE_TIMEOUT_MS } from "./liveRecovery.ts";

describe("native IPTV failure classification", () => {
  it.each(["stop", "quit", "redirect"])("does not report %s as a broken source", endReason => {
    expect(failureFromMpvEvent({ event: "end-file", endReason }, true)).toBeNull();
  });
  it("explains a missing channel without retrying a permanent HTTP failure", () => {
    const failure = failureFromMpvEvent({ event: "end-file", endReason: "error", errorCode: -13, httpStatus: 404 }, true)!;
    expect(failure.message).toContain("HTTP 404");
    expect(failure.retryable).toBe(false);
    expect(liveRetryDelay(failure, 0)).toBeNull();
  });
  it.each([401, 403, 404, 410, 429])("does not hammer HTTP %s", httpStatus => {
    expect(failureFromMpvEvent({ event: "end-file", endReason: "error", httpStatus }, true)?.retryable).toBe(false);
  });
  it("recovers a transient 503 at most twice, and never loops on unsupported media", () => {
    const transient = failureFromMpvEvent({ event: "end-file", endReason: "error", httpStatus: 503 }, true)!;
    expect(liveRetryDelay(transient, 0)).toBe(1500);
    expect(liveRetryDelay(transient, 1)).toBe(4000);
    expect(liveRetryDelay(transient, 2)).toBeNull();
    expect(failureFromMpvEvent({ event: "end-file", endReason: "error", errorCode: -17 }, true)?.retryable).toBe(false);
  });
  it("reconnects an interrupted live stream but treats normal VOD EOF as a completion", () => {
    expect(failureFromMpvEvent({ event: "end-file", endReason: "eof" }, true)?.retryable).toBe(true);
    expect(failureFromMpvEvent({ event: "end-file", endReason: "eof" }, false)).toBeNull();
    expect(failureFromMpvEvent({ event: "file-loaded" }, true)).toBeNull();
  });
  it("allows native network recovery to finish instead of declaring failure at 12 seconds", () => {
    expect(LIVE_LOAD_FAILURE_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(LIVE_LOAD_FAILURE_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
