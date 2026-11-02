import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.ts";

describe("buildManifest", () => {
  it("preserves the logo for each enabled provider", () => {
    const manifest = buildManifest("1.0.0", [{
      id: "example",
      name: "Example",
      logo: "https://example.org/logo.png",
      supportedTypes: ["movie"],
    }]);

    expect(manifest.scrapers[0].logo).toBe("https://example.org/logo.png");
  });

  it("leaves the optional logo out when it is unavailable", () => {
    const manifest = buildManifest("1.0.0", [{
      id: "example",
      name: "Example",
      supportedTypes: ["movie"],
    }]);

    expect(manifest.scrapers[0]).not.toHaveProperty("logo");
  });
});
