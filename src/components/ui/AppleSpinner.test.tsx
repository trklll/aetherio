import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppleSpinner from "./AppleSpinner";

describe("AppleSpinner", () => {
  it("renders eight decorative petals and keeps size and color configurable", () => {
    const markup = renderToStaticMarkup(
      <AppleSpinner size={28} color="#fff" className="startup-indicator" />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("startup-indicator");
    expect(markup).toContain("--aetherio-spinner-size:28px");
    expect(markup).toContain("--aetherio-spinner-color:#fff");
    expect(markup.match(/aetherio-petal-spinner__petal/g)).toHaveLength(8);
  });

  it("uses the shared 1.05-second cadence and stops for reduced motion", () => {
    const css = readFileSync("src/index.css", "utf8");

    expect(css).toContain("animation: aetherio-petal-spinner-rotate 1.05s linear infinite");
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.aetherio-petal-spinner\s*\{\s*animation:\s*none/);
  });
});
