import type { IptvChannel } from "../../services/iptvChannels";
import type { XmltvGuide } from "../../services/iptvSports";
import type { LiveChannelProgramme } from "../../types/liveSports";

export const LIVE_FILTERS = [
  { id: "all", label: "Todos" }, { id: "spanish", label: "Español" },
  { id: "sports", label: "Deportes" }, { id: "peru", label: "Perú" },
  { id: "latin-america", label: "Latinoamérica" },
] as const;
export type LiveFilter = typeof LIVE_FILTERS[number]["id"];
export const foldChannel = (value = "") => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
const guideKey = (value: string) => value.replace(/@(?:sd|hd|fhd|uhd|4k|8k)$/i, "").toLowerCase();

export function uniqueChannels(channels: IptvChannel[]): IptvChannel[] {
  const seen = new Set<string>();
  return channels.filter(channel => {
    const key = `${foldChannel(channel.name)}:${channel.streamUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function filterLiveChannels(channels: IptvChannel[], filter: LiveFilter, query: string, source: string): IptvChannel[] {
  const search = foldChannel(query);
  return channels.filter(channel => {
    if (source !== "all" && channel.sourceName !== source) return false;
    const words = foldChannel(`${channel.name} ${channel.group ?? ""} ${channel.country ?? ""} ${channel.sourceName}`);
    if (search && !words.includes(search)) return false;
    if (filter === "peru") return channel.countryCode?.toUpperCase() === "PE" || channel.regions?.includes("peru");
    if (filter === "latin-america") return channel.regions?.includes("latin-america");
    if (filter === "spanish") return channel.sourceId === "iptv-free-spanish" || /\b(spanish|espanol|castellano)\b|^(es|spa)$/i.test(foldChannel(channel.language)) || /\b(spanish|espanol|castellano)\b/.test(words);
    if (filter === "sports") return /sport|deport|futbol|soccer|espn/.test(words);
    return true;
  });
}

export function buildProgrammeIndex(guides: XmltvGuide[]) {
  const programmes = new Map<string, LiveChannelProgramme[]>();
  const names = new Map<string, Set<string>>();
  for (const guide of guides) {
    for (const [id, labels] of guide.channels) for (const label of labels) {
      const name = foldChannel(label);
      const ids = names.get(name) ?? new Set<string>();
      ids.add(guideKey(id));
      names.set(name, ids);
    }
    for (const programme of guide.programmes) {
      const key = guideKey(programme.channelId);
      const entries = programmes.get(key) ?? [];
      entries.push(programme);
      programmes.set(key, entries);
    }
  }
  for (const [key, entries] of programmes) {
    const seen = new Set<string>();
    programmes.set(key, entries.filter(entry => {
      const identity = `${entry.startsAt}:${entry.endsAt}:${entry.title}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
  }
  return { programmes, names };
}

export function channelProgrammes(channel: IptvChannel, index: ReturnType<typeof buildProgrammeIndex>): LiveChannelProgramme[] {
  if (channel.tvgId) return index.programmes.get(guideKey(channel.tvgId)) ?? [];
  const ids = index.names.get(foldChannel(channel.name));
  return ids?.size === 1 ? index.programmes.get([...ids][0]) ?? [] : [];
}

export function programmeWindow(programme: LiveChannelProgramme, start: number, end: number) {
  const left = Math.max(start, Date.parse(programme.startsAt));
  const right = Math.min(end, Date.parse(programme.endsAt));
  if (!Number.isFinite(left) || !Number.isFinite(right) || end <= start || right <= left) return null;
  return { left: (left - start) / (end - start) * 100, width: (right - left) / (end - start) * 100 };
}

export const channelTime = (time: string | number) => new Date(time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
export const cleanChannelName = (name: string) => name.replace(/\s*\((?:\d{3,4}[pi]|[FU]?HD|SD|[248]K)\)/gi, "").trim();
