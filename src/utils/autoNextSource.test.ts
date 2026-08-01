import { describe, expect, it } from "vitest";
import { pickBestMatchingSource } from "./autoNextSource";
import type { MediaStream } from "../types/stream";

function stream(id: string, bingeGroup?: string, addonId = id): MediaStream {
  return {
    id,
    addonId,
    addonName: addonId,
    name: id,
    behaviorHints: bingeGroup ? { bingeGroup } : undefined,
  };
}

describe("pickBestMatchingSource", () => {
  it("prefers the same binge group", () => {
    const result = pickBestMatchingSource(
      [stream("other", "group-b"), stream("same", "group-a", "addon-a")],
      { addonId: "addon-a", bingeGroup: "group-a" },
    );

    expect(result?.id).toBe("same");
  });

  it("falls back to source identity when no group matches", () => {
    const result = pickBestMatchingSource(
      [stream("other", "group-b"), stream("same", "group-c", "addon-a")],
      { addonId: "addon-a", bingeGroup: "group-a" },
    );

    expect(result?.id).toBe("same");
  });

  it("accepts legacy hints without a binge group", () => {
    const result = pickBestMatchingSource(
      [stream("other", "group-b"), stream("same", "group-a", "addon-a")],
      { addonId: "addon-a" },
    );

    expect(result?.id).toBe("same");
  });
});
