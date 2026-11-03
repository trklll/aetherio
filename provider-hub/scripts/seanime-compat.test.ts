import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCompatibility } from "../src/seanime/compat.ts";

const require = createRequire(import.meta.url);
const compat = createCompatibility(require("cheerio"), require("crypto-js"));

describe("reviewed Seanime helper compatibility", () => {
  it("supports Goquery-style DOM selections used by the imported torrent providers", () => {
    const $ = compat.LoadDoc('<main><ul><li data-n="1"><a href="/one">One</a></li><li data-n="2"><a href="/two">Two</a></li></ul></main>');
    expect(Number($("li").length)).toBe(2);
    expect($("li").length()).toBe(2);
    expect($("li").first().find("a").attr("href")).toBe("/one");
    expect($("li").map((_i: number, node: any) => node.text())).toEqual(["One", "Two"]);
    expect($("li").first().data("n")).toBe("1");
    expect($("li").first().attrs()).toEqual({ "data-n": "1" });
    expect($("a").first().closest("main").html()).toContain("<ul>");
    expect($("li").last().is("li")).toBe(true);
    const names: string[] = [];
    $("li").each((_i: number, node: any) => names.push(node.text()));
    expect(names).toEqual(["One", "Two"]);
    expect(compat.Doc("<p>Text</p>").find("p").text()).toBe("Text");
  });
  it("parses release titles and builds the scanner shapes expected by smartSearch", () => {
    const scanner = compat.$scannerUtils;
    const name = "Sample S02E03 (1080p)";
    expect(scanner.normalizeTitle(name)).toMatchObject({ season: 2, isMain: true });
    expect(scanner.extractPartNumber("Sample Part 2")).toBe(2);
    expect(scanner.extractYear("Sample 2026")).toBe(2026);
    expect(scanner.compareTitles("Sample", "Sample")).toBe(1);
    expect(scanner.compareTitles("", "")).toBe(0);
    expect(scanner.findBestMatch("Sample", ["Other", "Sample"])).toBe("Sample");
    expect(scanner.buildSeasonQuery("Sample", 2)).toContain("S02");
    expect(scanner.buildSeasonQuery("Sample", 1)).toBe("Sample");
    expect(scanner.buildPartQuery("Sample", 2)).toContain("Cour 2");
    expect(scanner.buildSmartSearchTitles(["Sample Season 2", "Sample"])).toMatchObject({ titles: ["Sample"], season: 2 });
    expect(compat.$habari.parse("[SubsPlease] Sample - 03 (1080p).mkv")).toMatchObject({ episode_number: ["03"], video_resolution: "1080p", release_group: "SubsPlease", file_extension: "mkv" });
  });
  it("hashes exactly the original bencoded info dictionary, not a decoded/re-encoded version", () => {
    const info = "d4:name6:sample6:lengthi123ee";
    const hash = createHash("sha1").update(info, "latin1").digest("hex");
    expect(compat.$torrentUtils.getMagnetLinkFromTorrentData(`d4:info${info}e`)).toBe(`magnet:?xt=urn:btih:${hash}`);
    expect(compat.$torrentUtils.getMagnetLinkFromTorrentData("d3:foo3:bare")).toBe("");
    expect(() => compat.$torrentUtils.getMagnetLinkFromTorrentData("invalid")).toThrow();
  });
});
