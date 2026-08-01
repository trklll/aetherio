import { describe, expect, it } from "vitest";
import { DEFAULT_MDBLIST_SETTINGS, getEnabledMdbListProviders } from "./mdblist";

describe("getEnabledMdbListProviders", () => {
  it("returns exactly the providers selected in Settings", () => {
    const providers = getEnabledMdbListProviders({
      ...DEFAULT_MDBLIST_SETTINGS,
      showTrakt: false,
      showTmdb: false,
      showMetacritic: false,
    });

    expect(providers).toEqual(["imdb", "letterboxd", "tomatoes"]);
  });
});
