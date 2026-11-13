import { describe, expect, it } from "vitest";
import { chooseDetailBackdrop } from "./detailBackdrop";

describe("chooseDetailBackdrop", () => {
  it("keeps Aetherio's chosen background even when it is hosted by TMDB", () => {
    const chosen = "https://image.tmdb.org/t/p/original/aetherio-choice.jpg";
    const preferred = "https://image.tmdb.org/t/p/original/tmdb-preference.jpg";

    expect(chooseDetailBackdrop(chosen, preferred, true)).toBe(chosen);
  });

  it("uses the TMDB background only when Aetherio has no background and fallback is enabled", () => {
    const preferred = "https://image.tmdb.org/t/p/original/tmdb-fallback.jpg";

    expect(chooseDetailBackdrop(undefined, preferred, true)).toBe(preferred);
  });

  it("does not add a TMDB background when fallback is disabled", () => {
    const preferred = "https://image.tmdb.org/t/p/original/tmdb-fallback.jpg";

    expect(chooseDetailBackdrop(undefined, preferred, false)).toBeUndefined();
  });
});
