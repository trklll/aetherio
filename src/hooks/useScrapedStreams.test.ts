import { describe, expect, it } from "vitest";
import { scrapedResultCacheable } from "./useScrapedStreams";

describe("scrapedResultCacheable", () => {
  it("cachea resultados aunque otros providers hayan fallado", () => {
    expect(scrapedResultCacheable(1)).toBe(true);
  });

  it("no cachea un lote sin fuentes", () => {
    expect(scrapedResultCacheable(0)).toBe(false);
  });
});
