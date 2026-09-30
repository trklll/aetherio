import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareLocalMediaPlayback } from "./localMedia";

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("prepareLocalMediaPlayback", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", createSessionStorage());
    vi.spyOn(Date, "now").mockReturnValue(123);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens local media in the normal player outside Big Picture", () => {
    vi.stubGlobal("window", { location: { pathname: "/home" } });

    expect(prepareLocalMediaPlayback("C:\\Videos\\movie.mp4"))
      .toBe("/player?local=123");
  });

  it("keeps local media in the Big Picture player", () => {
    vi.stubGlobal("window", { location: { pathname: "/big-picture" } });

    expect(prepareLocalMediaPlayback("C:\\Videos\\movie.mp4"))
      .toBe("/big-picture/player?local=123");
  });
});
