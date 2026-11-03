/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runProviderScript, warmupProviders } from "../sandbox.ts";

const catalog = JSON.parse(await readFile(new URL("./catalog.lock.json", import.meta.url), "utf8")).records.filter((record: any) => !record.excluded);

beforeAll(async () => {
  const deps = await readFile(new URL("../assets/provider-deps.js.txt", import.meta.url), "utf8");
  const entries = await Promise.all(catalog.map(async (record: any, i: number) => ({ id: record.id, updatedAt: 0,
    source: await readFile(new URL(`../assets/seanime/${record.id}.js.txt`, import.meta.url), "utf8"), depsSource: i === 0 ? deps : "" })));
  const summary = await warmupProviders(entries);
  expect(summary.failed).toEqual([]);
  expect(summary.compiled).toHaveLength(catalog.length);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("real, build-time compiled marketplace payloads", () => {
  it("AnimeAV1 searches its own Remix API and resolves both real audio variants without AnimES", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = new URL(String(input)); urls.push(url.href);
      expect(url.hostname).toBe("animeav1.com");
      if (url.pathname === "/catalogo/__data.json") return Response.json({ nodes: [{ uses: { search_params: ["search"] }, data: [
        { results: 1 }, [2], { title: 3, slug: 4 }, "Sample", "sample",
      ] }] });
      if (url.pathname === "/media/sample/__data.json") return Response.json({ nodes: [{ data: [
        { slug: 1, episodes: 2 }, "sample", [3], { number: 4 }, 3,
      ] }] });
      if (url.pathname === "/media/sample/3/__data.json") return Response.json({ nodes: [{ data: [
        { embeds: 1 }, { SUB: 2, DUB: 6 }, [3], { server: 4, url: 5 }, "HLS", "https://player.zilla-networks.com/play/sub",
        [7], { server: 4, url: 8 }, "https://player.zilla-networks.com/play/dub",
      ] }] });
      return new Response(null, { status: 404 });
    }));
    const streams = await runProviderScript("animeav1", [123, "tv", 1, 3, "Sample"]);
    expect(streams).toHaveLength(2);
    expect(streams.map(stream => stream.url)).toEqual(expect.arrayContaining(["https://player.zilla-networks.com/m3u8/sub", "https://player.zilla-networks.com/m3u8/dub"]));
    expect(streams.map(stream => stream.languages)).toEqual(expect.arrayContaining([["ja"], ["es"]]));
    expect(streams[0].headers).toMatchObject({ Referer: "https://player.zilla-networks.com/", Origin: "https://player.zilla-networks.com", "Sec-Fetch-Site": "same-origin" });
    expect(urls.filter(url => url.includes("/media/sample/3/"))).toHaveLength(1);
    expect(urls.some(url => /pigamer|alwaysdata|animes/i.test(url))).toBe(false);
  });

  it("JkAnime keeps its real session cookie and CSRF POST while resolving the requested episode", async () => {
    let ajax = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.startsWith("/buscar/")) return new Response('<div class="anime__item__text"><a href="https://jkanime.net/sample/">Sample</a></div>');
      if (url.pathname === "/sample/") return new Response('<meta name="csrf-token" content="fixture-token"><script>"ajax/episodes/123/"</script>', { headers: { "set-cookie": "jk_session=fixture; Path=/; Secure" } });
      if (url.pathname === "/ajax/episodes/123/1") {
        ajax = true;
        expect(init.method).toBe("POST");
        expect(new Headers(init.headers).get("cookie")).toContain("jk_session=fixture");
        expect(await new Request(url, init).text()).toBe("_token=fixture-token");
        return Response.json({ data: [{ number: 3 }], last_page: 1 });
      }
      if (url.pathname === "/sample/3/") return new Response('<iframe src="https://jkanime.net/jkplayer/sample"></iframe>');
      if (url.pathname === "/jkplayer/sample") return new Response('file: "https://cdn.example/sample.m3u8"');
      return new Response(null, { status: 404 });
    }));
    const streams = await runProviderScript("jkanime", [123, "tv", 1, 3, "Sample"]);
    expect(ajax).toBe(true);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ name: "JkAnime", url: "https://cdn.example/sample.m3u8" });
  });

  it("SubsPlease returns playable torrent identity, not a web-page URL or an English dub", async () => {
    const hash = "abcdef0123456789abcdef0123456789abcdef01";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ release: { show: "Sample", episode: "3", release_date: "2026-11-01", page: "sample", downloads: [{ res: "1080", magnet: `magnet:?xt=urn:btih:${hash}` }] } })));
    const streams = await runProviderScript("subsplease-provider", [123, "tv", 1, 3, "Sample"]);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ name: "SubsPlease", infoHash: hash, languages: ["ja"] });
    expect(streams[0].url).toBeUndefined();
  });
});
