import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import ChannelsPage from "./index";

function renderChannels(bigPicture: boolean) {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(ChannelsPage, { bigPicture })),
  );
}

describe("Channels catalog in both modes", () => {
  it("uses the IPTV catalog and normal text search outside Big Picture", () => {
    const markup = renderChannels(false);

    expect(markup).toContain('class="live-channels"');
    expect(markup).toContain('aria-label="Buscar canal"');
    expect(markup).toContain("Guía de canales");
    expect(markup).toContain("Deportes");
    expect(markup).not.toContain("Programación de ejemplo");
    expect(markup).not.toContain("data-bp-channels");
  });

  it("uses the same catalog with spatial navigation and remote search in Big Picture", () => {
    const markup = renderChannels(true);

    expect(markup).toContain('class="live-channels live-channels--tv"');
    expect(markup).toContain('data-bp-channels=""');
    expect(markup).toContain('data-spatial-navigation="local"');
    expect(markup).toContain('aria-label="Buscar canal"');
    expect(markup).toContain("Guía de canales");
    expect(markup).toContain("Deportes");
    expect(markup).not.toContain("Programación de ejemplo");
  });
});
