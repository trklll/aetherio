import { describe, expect, it } from "vitest";
import { resolveEpisodeFocusKey } from "./episodeFocus";

describe("resolveEpisodeFocusKey", () => {
  it("restores the last focused episode before the resume episode", () => {
    expect(resolveEpisodeFocusKey("1:10", "1:3", ["1:1", "1:3", "1:10"]))
      .toBe("1:10");
  });

  it("falls back to the resume episode when the previous focus is unavailable", () => {
    expect(resolveEpisodeFocusKey("2:10", "1:3", ["1:1", "1:3"]))
      .toBe("1:3");
  });

  it("falls back to the first episode when neither preferred key is available", () => {
    expect(resolveEpisodeFocusKey("2:10", "2:3", ["1:1", "1:2"]))
      .toBe("1:1");
  });
});
