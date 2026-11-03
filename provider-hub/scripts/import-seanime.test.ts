import { describe, expect, it } from "vitest";
import { selectAdditionalAnimeProviders, selectSpanishAnimeProviders } from "./import-seanime-providers.mjs";

describe("Spanish anime marketplace import", () => {
  it("extracts Spanish video providers except the native AnimeAV1, excluding manga/plugins and duplicates", () => {
    const item = { id: "animeav1", name: "AnimeAV1", lang: "es", type: "onlinestream-provider" };
    const found = selectSpanishAnimeProviders([
      item, { ...item }, { ...item, id: "animeflv", brokenTag: true },
      { ...item, id: "jkanime", lang: "es-ES" }, { ...item, id: "latanime-online-provider", lang: "es-419" },
      { ...item, id: "manga", type: "manga-provider" }, { ...item, id: "plugin", type: "plugin" },
      { ...item, id: "italian", lang: "it" }, { ...item, id: "unknown", lang: "multi" },
    ]);
    expect(found.map(item => item.id)).toEqual(["animeflv", "jkanime", "latanime-online-provider"]);
    expect(found[0].brokenTag).toBe(true);
  });
});

describe("additional anime source language gate", () => {
  it("excludes Chinese and other-language marketplace sources before applying per-release audio checks", () => {
    const candidates = [
      { id: "subsplease-provider", type: "anime-torrent-provider", lang: "en" },
      { id: "animeya", type: "onlinestream-provider", lang: "multi" },
      { id: "acgnx", type: "anime-torrent-provider", lang: "zh" },
      { id: "foreign", type: "onlinestream-provider", lang: "ko" },
      { id: "broken", type: "onlinestream-provider", lang: "ja", brokenTag: true },
      { id: "deprecated", type: "anime-torrent-provider", lang: "ja", deprecatedTag: true },
    ];
    expect(selectAdditionalAnimeProviders(candidates).map(item => item.id)).toEqual(["subsplease-provider", "animeya"]);
  });
});
