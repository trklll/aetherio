import { describe, expect, it } from "vitest";
import {
  isShellPreviewInternalPath,
  isShellPreviewMessage,
  withShellPreviewQuery,
  shellPreviewBounds,
  resolveShellPreviewInitialIndex,
  isShellPreviewBootstrap,
  wrapDelta,
} from "./shellPreview";

describe("shell preview protocol", () => {
  it("adds the embedded flag without losing existing query or hash", () => {
    expect(withShellPreviewQuery("/detail/movie/tmdb%3A42?from=home#overview"))
      .toBe("/detail/movie/tmdb%3A42?from=home&shellPreview=1#overview");
  });

  it("keeps detail-related routes inside the iframe", () => {
    expect(isShellPreviewInternalPath("/big-picture/detail/movie/tmdb:42")).toBe(true);
    expect(isShellPreviewInternalPath("/big-picture/person/42")).toBe(true);
    expect(isShellPreviewInternalPath("/big-picture/entity/company/10")).toBe(true);
    expect(isShellPreviewInternalPath("/detail/movie/tmdb:42")).toBe(false);
    expect(isShellPreviewInternalPath("/big-picture/episode")).toBe(false);
    expect(isShellPreviewInternalPath("/episode")).toBe(false);
  });

  it("never bootstraps an embedded shell on normal Aetherio or a top-level page", () => {
    expect(isShellPreviewBootstrap("/home", "?shellPreview=1", true)).toBe(false);
    expect(isShellPreviewBootstrap("/detail/movie/42", "?shellPreview=1", true)).toBe(false);
    expect(isShellPreviewBootstrap("/big-picture/detail/movie/42", "?shellPreview=1", false)).toBe(false);
    expect(isShellPreviewBootstrap("/big-picture/detail/movie/42", "", true)).toBe(false);
    expect(isShellPreviewBootstrap("/big-picture/detail/movie/42", "?shellPreview=1", true)).toBe(true);
  });

  it("matches the native 960x540 compact viewport, flush with the bottom", () => {
    expect(shellPreviewBounds(960, 540)).toEqual({ left: 84, top: 28, width: 792, height: 512, density: 1 });
    expect(shellPreviewBounds(1920, 1080)).toEqual({ left: 168, top: 56, width: 1584, height: 1024, density: 2 });
  });

  it("keeps narrow and ultrawide previews within the viewport", () => {
    for (const [width, height] of [[390, 844], [2560, 1080]]) {
      const bounds = shellPreviewBounds(width, height);
      expect(bounds.width).toBeGreaterThan(0);
      expect(bounds.left * 2 + bounds.width).toBeCloseTo(width);
      expect(bounds.top + bounds.height).toBeCloseTo(height);
      expect(bounds.width).toBeLessThanOrEqual(width * 0.84);
    }
  });

  it("measures neighbours around a carousel that never ends", () => {
    // La ficha siguiente de la última es la primera, y al revés.
    expect(wrapDelta(0, 4, 5)).toBe(1);
    expect(wrapDelta(4, 0, 5)).toBe(-1);
    expect(wrapDelta(1, 0, 5)).toBe(1);
    expect(wrapDelta(3, 0, 5)).toBe(-2);
    // Con 2 fichas solo hay un vecino y cabe en un lado: el empate va al derecho.
    expect(wrapDelta(1, 0, 2)).toBe(1);
    expect(wrapDelta(0, 1, 2)).toBe(1);
    // Casos límite.
    expect(wrapDelta(0, 0, 1)).toBe(0);
    expect(wrapDelta(3, 3, 4)).toBe(0);
    expect(wrapDelta(0, 0, 0)).toBe(0);
  });

  it("uses the selected card from each request when reopening the same carousel", () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      detailPath: `/big-picture/detail/movie/${index + 1}`,
      title: `Movie ${index + 1}`,
      cardElement: null,
    }));

    expect(resolveShellPreviewInitialIndex({ ...items[1], items, initialIndex: 1 })).toBe(1);
    expect(resolveShellPreviewInitialIndex({ ...items[4], items, initialIndex: 4 })).toBe(4);
    expect(resolveShellPreviewInitialIndex({ ...items[4], items, initialIndex: 99 })).toBe(4);
  });

  it("rejects malformed or external navigation messages", () => {
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "ready" })).toBe(true);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "loading" })).toBe(true);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "navigate", path: "/episode?type=movie" })).toBe(true);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "background", background: "https://image.test/backdrop.jpg" })).toBe(true);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "background", background: "" })).toBe(false);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "reveal", on: true })).toBe(true);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "reveal", on: "yes" })).toBe(false);
    expect(isShellPreviewMessage({ source: "other", type: "close" })).toBe(false);
    expect(isShellPreviewMessage({ source: "aetherio-shell-preview", type: "navigate", path: "https://example.com" })).toBe(false);
  });
});
