import { describe, expect, it } from "vitest";
import { readLibraryTab, stepLibraryTab, writeLibraryTabSearch } from "./libraryTabs";

describe("library tabs", () => {
  it("reads the Downloads tab from the URL and accepts the old offline value", () => {
    expect(readLibraryTab("?tab=downloads")).toBe("downloads");
    expect(readLibraryTab("?tab=offline")).toBe("downloads");
    expect(readLibraryTab("?tab=unknown")).toBeNull();
  });

  it("cycles through visible tabs in either direction", () => {
    expect(stepLibraryTab("library", 1, true)).toBe("discover");
    expect(stepLibraryTab("discover", 1, true)).toBe("downloads");
    expect(stepLibraryTab("downloads", 1, true)).toBe("library");
    expect(stepLibraryTab("library", -1, true)).toBe("downloads");
    expect(stepLibraryTab("library", 1, false)).toBe("discover");
    expect(stepLibraryTab("discover", 1, false)).toBe("library");
  });

  it("writes a direct Downloads link while preserving unrelated query parameters", () => {
    expect(writeLibraryTabSearch("?sort=recent&tab=offline", "downloads"))
      .toBe("?sort=recent&tab=downloads");
    expect(writeLibraryTabSearch("?sort=recent&tab=downloads", "library"))
      .toBe("?sort=recent");
    expect(writeLibraryTabSearch("", "discover")).toBe("");
  });
});
