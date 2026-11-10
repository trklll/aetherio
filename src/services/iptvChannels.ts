import popularSportsPlaylist from "../assets/iptv/popular-sports-iptv.m3u?raw";
import iptvCatSnapshot from "../data/iptvcatChannels.json";
import { fetchIptvText, publicIptvUrl } from "./iptvSportsHttp";

export interface IptvChannel {
  id: string;
  name: string;
  streamUrl: string;
  sourceId: string;
  sourceName: string;
  group?: string;
  logo?: string;
  tvgId?: string;
  language?: string;
  country?: string;
  countryCode?: string;
  regions?: string[];
  /** IPTV Cat exposes a one-channel M3U endpoint; resolve it just before playback. */
  playlistUrl?: string;
  quality?: string;
}

export interface PlaylistDefinition {
  id: string;
  name: string;
  url: string;
}

export interface PlaylistLoadResult {
  channels: IptvChannel[];
  failedPlaylists: string[];
  epgUrls?: string[];
}

interface IptvCatSnapshot {
  fetchedAt: string;
  onlineRows: number;
  channelCount: number;
  channels: Array<{
    id: string;
    name: string;
    country: string;
    countryCode: string;
    playlistUrl: string;
    regions: string[];
  }>;
}

export const IPTV_CAT_SNAPSHOT_AT = (iptvCatSnapshot as IptvCatSnapshot).fetchedAt;
export const IPTV_CAT_ONLINE_ROWS = (iptvCatSnapshot as IptvCatSnapshot).onlineRows;

export const IPTV_PLAYLISTS: PlaylistDefinition[] = [
  {
    id: "iptv-free-sports",
    name: "IPTV Free · Deportes",
    url: "https://live.iptv-free.com/iptv/categories/sports.m3u",
  },
  {
    id: "hacks-tools-sports",
    name: "Hacks Tools · Deportes",
    url: "https://live.hacks.tools/iptv/categories/sports.m3u",
  },
  {
    id: "u-din-sports",
    name: "u-din · Deportes",
    url: "https://raw.githubusercontent.com/u-din/IPTV/refs/heads/main/sport.m3u",
  },
  {
    id: "iptv-free-spanish",
    name: "IPTV Free · Español",
    url: "https://live.iptv-free.com/iptv/languages/spa.m3u",
  },
];

export const IPTV_CAT_CHANNELS: IptvChannel[] = (iptvCatSnapshot as IptvCatSnapshot).channels.map(channel => ({
  id: channel.id,
  name: channel.name,
  streamUrl: channel.playlistUrl,
  playlistUrl: channel.playlistUrl,
  sourceId: "iptvcat",
  sourceName: "IPTV Cat",
  group: "IPTV Cat",
  country: channel.country,
  countryCode: channel.countryCode,
  regions: channel.regions,
}));

const localSportsChannels = parseM3U(popularSportsPlaylist, {
  id: "attached-sports",
  name: "Popular Sports IPTV · adjunta",
});

export const BUNDLED_IPTV_CHANNELS: IptvChannel[] = [...localSportsChannels, ...IPTV_CAT_CHANNELS];

let playlistLoadPromise: Promise<PlaylistLoadResult> | null = null;

function findUnquotedComma(value: string): number {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? "" : char;
    else if (char === "," && !quote) return index;
  }
  return -1;
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  for (const match of value.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function resolvePlaylistEntryUrl(value: string, baseUrl?: string): string {
  if (!baseUrl) return value;
  try { return new URL(value, baseUrl).href; } catch { return value; }
}

export function parseM3U(
  text: string,
  source: Pick<PlaylistDefinition, "id" | "name">,
  baseUrl?: string,
): IptvChannel[] {
  const channels: IptvChannel[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let pending: Omit<IptvChannel, "streamUrl"> | null = null;
  let pendingGroup = "";
  let entryIndex = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTGRP:")) {
      pendingGroup = line.slice("#EXTGRP:".length).trim();
      if (pending && pendingGroup) pending.group = pendingGroup;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const payload = line.slice("#EXTINF:".length);
      const comma = findUnquotedComma(payload);
      const metadata = comma < 0 ? payload : payload.slice(0, comma);
      const name = comma < 0 ? "" : payload.slice(comma + 1).trim();
      const attributes = parseAttributes(metadata);
      const sourceTag = `${source.id}:${entryIndex++}`;
      pending = {
        id: `${sourceTag}:${attributes["tvg-id"] || name || "channel"}`,
        name: name || attributes["tvg-name"] || "Canal sin nombre",
        sourceId: source.id,
        sourceName: source.name,
        group: attributes["group-title"] || pendingGroup || "General",
        logo: attributes["tvg-logo"] || undefined,
        tvgId: attributes["tvg-id"] || undefined,
        language: attributes["tvg-language"] || attributes.language || undefined,
        country: attributes["tvg-country"] || undefined,
        countryCode: attributes["tvg-country-code"] || undefined,
      };
      pendingGroup = "";
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;

    const streamUrl = resolvePlaylistEntryUrl(line, baseUrl);
    channels.push({ ...pending, streamUrl });
    pending = null;
  }

  return channels;
}

export function getAttachedPlaylistEpgUrls(text = popularSportsPlaylist): string[] {
  const header = text.split(/\r?\n/).find(line => line.trimStart().startsWith("#EXTM3U")) ?? "";
  const urls = new Set<string>();
  const pattern = /(?:url-tvg|x-tvg-url)\s*=\s*"([^"]+)"/gi;
  for (const match of header.matchAll(pattern)) {
    for (const candidate of match[1].split(",")) {
      const url = publicIptvUrl(candidate.trim());
      if (url) urls.add(url.href);
    }
  }
  return [...urls];
}

export async function loadPlaylistChannels(
  fetchText: (url: string) => Promise<string> = fetchIptvText,
): Promise<PlaylistLoadResult> {
  const results = await Promise.all(IPTV_PLAYLISTS.map(async playlist => {
    try {
      const text = await fetchText(playlist.url);
      return { ok: true as const, playlist, channels: parseM3U(text, playlist, playlist.url), epgUrls: getAttachedPlaylistEpgUrls(text) };
    } catch {
      return { ok: false as const, playlist };
    }
  }));

  const channels: IptvChannel[] = [];
  const failedPlaylists: string[] = [];
  results.forEach(result => {
    if (result.ok) channels.push(...result.channels);
    else failedPlaylists.push(result.playlist.name);
  });
  const epgUrls = [...new Set(results.flatMap(result => result.ok ? result.epgUrls : []))];
  return { channels, failedPlaylists, epgUrls };
}

export function loadConfiguredPlaylistChannels(force = false): Promise<PlaylistLoadResult> {
  if (!force && playlistLoadPromise) return playlistLoadPromise;
  playlistLoadPromise = loadPlaylistChannels().catch(error => {
    playlistLoadPromise = null;
    throw error;
  });
  return playlistLoadPromise;
}

export async function resolveIptvChannelStream(channel: IptvChannel): Promise<IptvChannel> {
  if (!channel.playlistUrl) {
    const directUrl = publicIptvUrl(channel.streamUrl);
    if (!directUrl) throw new Error("La señal no usa una URL pública HTTP o HTTPS válida.");
    return { ...channel, streamUrl: directUrl.href };
  }

  const playlistUrl = publicIptvUrl(channel.playlistUrl);
  if (!playlistUrl) throw new Error("La lista de IPTV Cat no tiene una URL pública válida.");
  const text = await fetchIptvText(playlistUrl.href);
  const [entry] = parseM3U(text, { id: channel.sourceId, name: channel.sourceName }, playlistUrl.href);
  if (!entry) throw new Error("IPTV Cat no devolvió una señal reproducible para este canal.");
  const streamUrl = publicIptvUrl(entry.streamUrl, playlistUrl.href);
  if (!streamUrl) throw new Error("La señal devuelta no es una URL pública HTTP o HTTPS válida.");
  return {
    ...channel,
    streamUrl: streamUrl.href,
    logo: entry.logo || channel.logo,
    tvgId: entry.tvgId || channel.tvgId,
    group: entry.group || channel.group,
    quality: entry.quality || channel.quality,
  };
}
