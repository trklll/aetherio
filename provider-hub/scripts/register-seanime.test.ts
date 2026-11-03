import { describe, expect, it } from "vitest";
import { mergeSeanimeRecords } from "./register-seanime-providers.mjs";

describe("explicit, additive Hub registration", () => {
  it("preserves every existing record byte-for-byte and its order, including personal/paused entries", () => {
    const personal = { id: "personal-provider", name: "Personal", enabled: false, supportedTypes: ["tv"], scriptUrl: "https://personal.example/source.js", unknownSetting: { keep: true } };
    const existing = { version: 2, records: [personal, { id: "animeav1", name: "My AnimeAV1", enabled: false, supportedTypes: ["tv"] }] };
    const serialized = JSON.stringify(existing);
    const records = [
      { id: "animeav1", name: "AnimeAV1", enabled: true, lang: "es", logo: "https://hub.example/logo.svg" },
      { id: "animeflv", name: "AnimeFLV", enabled: false, lang: "es", logo: "https://hub.example/flv.ico", description: "Averiado" },
      { id: "subsplease-provider", name: "SubsPlease", enabled: true, lang: "ja", logo: "https://hub.example/subs.png" },
    ];
    const merged = mergeSeanimeRecords(existing, records);
    expect(JSON.stringify(existing)).toBe(serialized);
    expect(merged.records.slice(0, 2)).toEqual(existing.records);
    expect(merged.records.map(record => record.id)).toEqual(["personal-provider", "animeav1", "animeflv", "subsplease-provider"]);
    expect(merged.records[2].enabled).toBe(false);
    expect(merged.records[3].contentLanguage).toEqual(["ja"]);
  });
  it("does not reset a missing, damaged, legacy or unknown-version production index", () => {
    for (const invalid of [null, [], { version: 1, records: [] }, { version: 2, records: ["old-id"] }, { version: 999, records: [] }]) {
      expect(() => mergeSeanimeRecords(invalid, [])).toThrow(/índice|index/i);
    }
  });
  it("is idempotent and only adds records supplied by an explicit invocation", () => {
    const records = [{ id: "animeav1", name: "AnimeAV1", lang: "es", enabled: true }];
    const first = mergeSeanimeRecords({ version: 2, records: [] }, records);
    expect(mergeSeanimeRecords(first, records).records).toEqual(first.records);
    expect(mergeSeanimeRecords({ version: 2, records: [] }, []).records).toEqual([]);
  });
});
