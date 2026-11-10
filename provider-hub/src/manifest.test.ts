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
    expect(manifest.domain).toBe("general");
    expect(manifest.scrapers[0].domain).toBe("general");
  });

  it("leaves the optional logo out when it is unavailable", () => {
    const manifest = buildManifest("1.0.0", [{
      id: "example",
      name: "Example",
      supportedTypes: ["movie"],
    }]);

    expect(manifest.scrapers[0]).not.toHaveProperty("logo");
  });

  it("publishes broken/paused scripts as visible but not executable metadata", () => {
    const manifest = buildManifest("1.0.0", [{
      id: "animeflv", name: "AnimeFLV", description: "Averiado en el marketplace",
      supportedTypes: ["movie", "tv"], enabled: false,
    }]);
    expect(manifest.scrapers[0]).toMatchObject({ id: "animeflv", enabled: false, description: "Averiado en el marketplace" });
  });
});
