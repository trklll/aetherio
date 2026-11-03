import { describe, expect, it } from "vitest";
import { normalizeSportsStreamsManifestUrl } from "./sportsStreamsConfig.ts";

describe("Highfly configuration URLs", () => {
  it("normalizes the manifest suffix without changing its encoded personal configuration", () => {
    expect(normalizeSportsStreamsManifestUrl("https://sports.highfly.to/encoded/manifest.json/")).toBe("https://sports.highfly.to/encoded/manifest.json");
  });
  it.each(["http://sports.highfly.to/a", "https://127.0.0.1/a", "https://user:pass@sports.highfly.to/a", "https://sports.highfly.to/a?token=private", "javascript:alert(1)"])("rejects unsafe configuration %s", value => {
    expect(normalizeSportsStreamsManifestUrl(value)).toBeNull();
  });
});
