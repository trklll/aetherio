import { describe, expect, it } from "vitest";
import { claimStreamingPlatformIntro } from "./streamingPlatformIntroSession";

function createSessionStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("streaming platform intro session", () => {
  it("claims each platform intro once per session", () => {
    const storage = createSessionStorage();

    expect(claimStreamingPlatformIntro("netflix", storage)).toBe(true);
    expect(claimStreamingPlatformIntro("netflix", storage)).toBe(false);
    expect(claimStreamingPlatformIntro("mubi", storage)).toBe(true);
  });

  it("allows the intro again in a fresh app session", () => {
    expect(claimStreamingPlatformIntro("netflix", createSessionStorage())).toBe(true);
  });

  it("recovers from malformed session data", () => {
    const storage = createSessionStorage();
    storage.setItem("aetherio.streaming-platform-intros.v1", "not-json");

    expect(claimStreamingPlatformIntro("netflix", storage)).toBe(true);
    expect(claimStreamingPlatformIntro("netflix", storage)).toBe(false);
  });
});
