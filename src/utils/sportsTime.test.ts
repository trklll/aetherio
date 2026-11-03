import { afterEach, expect, it, vi } from "vitest";
import { formatSportsSchedule, formatSportsTime } from "./sportsTime.ts";

afterEach(() => vi.useRealTimers());
it("uses Peru time in winter and summer, including the preceding Peru calendar day", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T23:00:00Z"));
  expect(formatSportsSchedule("2026-10-31T02:30:00Z")).toBe("Hoy 21:30");
  expect(formatSportsTime("2026-01-31T02:30:00Z")).toBe("21:30");
  expect(formatSportsTime("2026-07-31T02:30:00Z")).toBe("21:30");
});
