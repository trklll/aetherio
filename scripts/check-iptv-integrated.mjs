// Live diagnostic only: no fixtures, saved-list changes, installs or full-catalog probing.
// Run: node scripts/check-iptv-integrated.mjs [report.json]
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.resolve(root, process.argv[2] ?? ".impeccable/review/channels-m3u/live.json");
const executeFile = promisify(execFile);
const server = await createServer({ root, server: { middlewareMode: true }, appType: "custom" });
const report = {
  checkedAt: new Date().toISOString(),
  transport: "Node fetch using Aetherio's bounded IPTV downloader (not the Tauri HTTP bridge)",
  scope: "Built-in sports defaults and the current Channels catalog; not private native-profile storage",
  lists: [], guides: [], samples: [], native: [],
};

async function concurrent(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }));
  return results;
}

try {
  const config = await server.ssrLoadModule("/src/services/iptvSportsConfig.ts");
  const parser = await server.ssrLoadModule("/src/services/iptvSports.ts");
  const http = await server.ssrLoadModule("/src/services/iptvSportsHttp.ts");
  const catalog = await server.ssrLoadModule("/src/services/iptvChannels.ts");
  const channelLists = await catalog.loadPlaylistChannels(http.fetchIptvText);
  report.channelCatalog = {
    bundled: catalog.BUNDLED_IPTV_CHANNELS.length,
    attachedM3u: catalog.BUNDLED_IPTV_CHANNELS.filter(channel => channel.sourceId === "attached-sports").length,
    iptvCatSnapshot: catalog.IPTV_CAT_CHANNELS.length,
    remoteChannels: channelLists.channels.length,
    failedPlaylists: channelLists.failedPlaylists,
    sources: catalog.IPTV_PLAYLISTS.map(list => ({ id: list.id, name: list.name,
      channels: channelLists.channels.filter(channel => channel.sourceId === list.id).length })),
  };
  const loaded = await concurrent(config.defaultSportsIptvLists(), 3, async list => {
    const started = performance.now();
    try {
      const text = await http.fetchIptvText(list.url);
      const parsed = parser.parseSportsM3u(text, list);
      return { list, parsed, result: {
        id: list.id, name: list.name, ok: true,
        entries: (text.match(/^#EXTINF:/gm) ?? []).length,
        sportsChannels: parsed.channels.length,
        sources: parsed.channels.reduce((sum, channel) => sum + channel.sources.length, 0),
        elapsedMs: Math.round(performance.now() - started),
      } };
    } catch (error) {
      return { list, result: { id: list.id, name: list.name, ok: false, error: String(error) } };
    }
  });
  report.lists = loaded.map(item => item.result);
  const bundled = { id: "bundled-popular-sports", name: "Popular Sports IPTV (bundled)", epgUrls: [] };
  const bundledText = await readFile(path.join(root, "src/assets/iptv/popular-sports-iptv.m3u"), "utf8");
  const bundledParsed = parser.parseSportsM3u(bundledText, bundled);
  report.lists.push({ id: bundled.id, name: bundled.name, ok: true, activeDefault: false,
    entries: (bundledText.match(/^#EXTINF:/gm) ?? []).length, sportsChannels: bundledParsed.channels.length });

  const guideUrls = [...new Set(loaded.filter(item => item.parsed)
    .flatMap(item => [...item.list.epgUrls, ...item.parsed.epgUrls]))];
  report.guides = await concurrent(guideUrls, 2, async url => {
    try {
      const guide = parser.parseXmltv(await http.fetchIptvText(url));
      return { host: new URL(url).hostname, ok: true, channels: guide.channels.size, programmes: guide.programmes.length };
    } catch (error) {
      return { host: new URL(url).hostname, ok: false, error: String(error) };
    }
  });

  // Prefer Spanish channels, then take a small round-robin sample of distinct routes.
  const queues = [...loaded.filter(item => item.parsed), { list: bundled, parsed: bundledParsed }].map(item => {
    const channels = [...item.parsed.channels].sort((a, b) =>
      Number(/espa[nñ]|teledeporte|real madrid|bar[cç]a/i.test(b.name)) - Number(/espa[nñ]|teledeporte|real madrid|bar[cç]a/i.test(a.name)));
    return channels.slice(0, 4).map(channel => ({ list: item.list.name, name: channel.name, source: channel.sources[0] }));
  });
  const selected = new Map();
  for (let offset = 0; offset < 4 && selected.size < 10; offset++) {
    for (const queue of queues) {
      const item = queue[offset];
      if (item && selected.size < 10 && !selected.has(item.source.url)) selected.set(item.source.url, item);
    }
  }
  const checked = await concurrent([...selected.values()], 4, async item => {
    const started = performance.now();
    const mediaVerified = await http.probeIptvSource(item.source);
    return { ...item, result: { list: item.list, channel: item.name, mediaVerified, elapsedMs: Math.round(performance.now() - started) } };
  });
  report.samples = checked.map(item => item.result);

  // Reuse the bundled libmpv checker. It observes playback-restart with null audio/video
  // outputs; this proves decoder startup, not rendering in the application window.
  const nativeCandidates = checked.filter(item => item.result.mediaVerified && !Object.keys(item.source.headers ?? {}).length).slice(0, 3);
  report.native = await concurrent(nativeCandidates, 2, async item => {
    try {
      const { stdout } = await executeFile("python", ["scripts/iptv-native-smoke.py", "--profile", "current", "--runs", "1", "--url", item.source.url],
        { cwd: root, timeout: 25_000, maxBuffer: 1024 * 1024, windowsHide: true });
      const native = JSON.parse(stdout).results[0];
      return { channel: item.name, decoderStarted: native.firstFrameMs !== null, ...native };
    } catch (error) {
      // Never serialize the child command: a source URL may contain query tokens.
      return { channel: item.name, decoderStarted: false, error: error.killed ? "Native check exceeded 25 seconds" : "Native checker did not complete" };
    }
  });
} finally {
  await server.close();
}

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
