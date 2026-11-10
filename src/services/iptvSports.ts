import { disciplineFromLabels, resolveParticipant } from "../data/sports/identity.ts";
import type { LiveChannel, LiveChannelProgramme, LiveEvent, LiveSource } from "../types/liveSports.ts";
import { IPTV_SOURCE_VERIFICATION_TTL_MS, MAX_IPTV_TEXT, publicIptvUrl } from "./iptvSportsHttp.ts";
import { liveSourceKey, sortLiveSources } from "./liveSportsSourceRanking.ts";
import { CNCVERSE_TV_SOURCE_ID } from "./cncverseBridge.ts";

export interface XmltvGuide {
  channels: Map<string, string[]>;
  programmes: LiveChannelProgramme[];
}

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function stableIptvId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (original, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? original;
    const point = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
  });
}

function attributes(value: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const match of value.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = decodeXml(match[2] ?? match[3]);
  return result;
}

function channelKey(id: string): string { return id.replace(/@(?:sd|hd|fhd|uhd|4k|8k)$/i, "").toLowerCase(); }
function cleanChannelName(name: string): string { return name.replace(/\s*\((?:\d{3,4}[pi]|[248]K|[FU]?HD|SD)\)/gi, "").replace(/\s*\[(?:Geo-blocked|Not 24\/7)\]/gi, "").trim().slice(0, 180); }

function inferChannelSports(name: string, group = ""): string[] {
  const value = fold(`${name} ${group}`);
  if (/\b(?:golf|basketball|baloncesto|nba|nfl|american football|cricket|darts|rugby|tennis|tenis|motorsport|racing|cybersport|esports)\b/.test(value)) return [];
  const result: string[] = [];
  if (/\b(?:futbol|football|soccer|calcio|fussball|fifa|golazo|futv|real madrid|barca|barcelona|betis|sevilla|lfc|liverpool|mutv|manchester united)\b/.test(value)) result.push("futbol");
  if (/\b(?:mma|ufc|bellator|pfl|fight|fightbox|combate|combat|one championship|artes marciales)\b/.test(value)) result.push("mma");
  // Known multisport broadcasters, not every channel called "Sports".
  if (!result.length && /\b(?:espn|bein|dazn|fox sports|tnt sports|claro sports|dsports|eleven sports|arena sport|setanta|teledeporte|esport3)\b/.test(value)) return ["futbol", "mma"];
  return result;
}

export function parseSportsM3u(text: string, list: { id: string; name: string }): { channels: LiveChannel[]; epgUrls: string[] } {
  if (text.length > MAX_IPTV_TEXT) throw new Error("La lista es demasiado grande (máximo 16 MB).");
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (!/^#EXTM3U\b/i.test(lines[0] ?? "") || lines.some(line => /^#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(line))) throw new Error("El contenido debe ser una lista de canales M3U, no un vídeo HLS.");
  const header = attributes(lines[0]);
  const epgUrls = [...new Set([header["x-tvg-url"], header["url-tvg"], header["tvg-url"]].filter(Boolean).flatMap(urls => urls.split(/[,;\s]+/)).map(url => publicIptvUrl(url)?.href).filter((url): url is string => Boolean(url)))];
  const channels = new Map<string, LiveChannel>();
  let entry: { name: string; attrs: Record<string, string>; group: string; headers: Record<string, string>; drm: boolean; quality?: string } | undefined;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (/^#EXTINF:/i.test(line)) {
      let quoted = "";
      let comma = -1;
      for (let index = 0; index < line.length; index++) {
        if (quoted) { if (line[index] === quoted) quoted = ""; }
        else if (line[index] === '"' || line[index] === "'") quoted = line[index];
        else if (line[index] === ",") { comma = index; break; }
      }
      const attrs = attributes(comma < 0 ? line : line.slice(0, comma));
      const name = cleanChannelName(decodeXml(comma < 0 ? attrs["tvg-name"] ?? "" : line.slice(comma + 1)));
      entry = { name, attrs, group: attrs["group-title"] ?? "", headers: {}, drm: false, quality: rawQuality(line.slice(comma + 1), attrs) };
      for (const [attribute, key] of [["http-referrer", "Referer"], ["http-user-agent", "User-Agent"]]) if (attrs[attribute]) entry.headers[key] = attrs[attribute];
    } else if (entry && /^#EXTGRP:/i.test(line)) entry.group = line.slice(8).trim();
    else if (entry && /^#KODIPROP:.*(?:license|widevine|playready)/i.test(line)) entry.drm = true;
    else if (entry && /^#EXTVLCOPT:http-(?:referrer|user-agent)=/i.test(line)) {
      const match = line.match(/^#EXTVLCOPT:http-(referrer|user-agent)=(.*)$/i)!;
      entry.headers[match[1].toLowerCase() === "referrer" ? "Referer" : "User-Agent"] = match[2];
    } else if (entry && line && !line.startsWith("#")) {
      const pending = entry;
      entry = undefined;
      if (!pending.name || pending.drm || channels.size >= 5000) continue;
      const [target, pipe] = line.split("|", 2);
      const url = publicIptvUrl(target);
      if (!url) continue;
      const sports = inferChannelSports(pending.name, pending.group);
      if (!sports.length && !/\b(?:sports?|deportes?|futbol|fútbol|mma|combate|combat|fight|soccer)\b/i.test(pending.group)) continue;
      if (pipe) for (const [key, value] of new URLSearchParams(pipe)) {
        if (/^(?:referer|referrer)$/i.test(key)) pending.headers.Referer = value;
        if (/^user-agent$/i.test(key)) pending.headers["User-Agent"] = value;
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(pending.headers)) if (value.length <= 1024 && !/[\r\n\u0000]/.test(value) && (key !== "Referer" || publicIptvUrl(value))) headers[key] = value;
      const key = channelKey(pending.attrs["tvg-id"] || fold(pending.name));
      const id = `iptv:${list.id}:${stableIptvId(key)}`;
      const source: LiveSource = { id: `${id}:${stableIptvId(url.href)}`, label: `IPTV · ${list.name} · ${pending.name}`, url: url.href, origin: "iptv", channelName: pending.name,
        quality: pending.quality, language: pending.attrs["tvg-language"] || undefined, ...(Object.keys(headers).length ? { headers } : {}) };
      // The quality suffix was removed from the name, but the EXTINF line retains it.
      const known = channels.get(key);
      if (known) { if (!known.sources.some(existing => liveSourceKey(existing) === liveSourceKey(source))) known.sources.push(source); }
      else channels.set(key, { id, name: pending.name, tvgId: pending.attrs["tvg-id"] || undefined, tvgName: pending.attrs["tvg-name"] || undefined,
        language: pending.attrs["tvg-language"] || undefined, country: pending.attrs["tvg-country"] || undefined,
        category: "Deportes", sports, logo: publicIptvUrl(pending.attrs["tvg-logo"])?.href, sources: [source] });
    }
  }
  return { channels: [...channels.values()], epgUrls };
}

function rawQuality(value: string, attrs: Record<string, string>): string | undefined {
  return attrs["tvg-quality"] || value.match(/\b(?:\d{3,4}[pi]|[248]K|[FU]?HD)\b/i)?.[0];
}

function xmlValues(body: string, name: string): string[] {
  return [...body.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, "gi"))]
    .map(match => decodeXml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "")).trim().slice(0, 4000));
}

function xmlTime(value: string): string | undefined {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(Z|[+-]\d{4})?$/);
  if (!match) return undefined;
  const [, y, m, d, h, min, sec = "00", zone = "Z"] = match;
  const date = new Date(`${y}-${m}-${d}T${h}:${min}:${sec}Z`);
  if (!Number.isFinite(date.getTime()) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return undefined;
  const offset = zone === "Z" ? 0 : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3))) * (zone[0] === "+" ? 1 : -1);
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(3)) > 59)) return undefined;
  return new Date(date.getTime() - offset * 60_000).toISOString();
}

const NOT_A_MATCH = /\b(?:replay|repeat|repeticion|redifusion|highlights?|resumen|classic|archivo|previa|pre match|post match|analisis|noticias|news|magazine)\b/;

export function parseXmltv(text: string, now = Date.now()): XmltvGuide {
  if (text.length > MAX_IPTV_TEXT || !/<tv(?:\s[^>]*)?>[\s\S]*<\/tv\s*>/i.test(text) || /<!ENTITY/i.test(text)) throw new Error("La guía debe ser un XMLTV válido de hasta 16 MB.");
  const xml = text.replace(/<!--[\s\S]*?-->/g, "");
  const channels = new Map<string, string[]>();
  for (const match of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel\s*>/gi)) {
    const id = attributes(match[1]).id;
    if (id && channels.size < 10_000) channels.set(id, xmlValues(match[2], "display-name"));
  }
  const programmes: LiveChannelProgramme[] = [];
  let count = 0;
  for (const match of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/gi)) {
    if (++count > 100_000) break;
    const attrs = attributes(match[1]);
    const startsAt = xmlTime(attrs.start);
    const endsAt = xmlTime(attrs.stop);
    if (!startsAt || !endsAt || !attrs.channel || Date.parse(endsAt) <= now || Date.parse(startsAt) > now + 48 * 3_600_000 || endsAt <= startsAt) continue;
    const title = xmlValues(match[2], "title")[0];
    if (!title) continue;
    const subtitle = xmlValues(match[2], "sub-title")[0];
    const description = xmlValues(match[2], "desc")[0];
    const labels = fold(`${title} ${subtitle ?? ""}`);
    programmes.push({ channelId: attrs.channel, title, subtitle, description, startsAt, endsAt, categories: xmlValues(match[2], "category"),
      live: /<live(?:\s|\/|>)/i.test(match[2]) || /\b(?:live|en directo|directo|en vivo|ao vivo)\b/.test(labels),
      repeat: /<previously-shown(?:\s|\/|>)/i.test(match[2]) || NOT_A_MATCH.test(labels) });
  }
  return { channels, programmes };
}

// These are documented channel IDs in TDTChannels' Spanish XMLTV feed, not fuzzy guesses.
const TDT_IDS: Record<string, string> = { "tdp.tv": "teledeporte.es", "e3.tv": "esport3.es", "rmtv.tv": "realmadridtv.es", "gol.tv": "golplay.es", "betis.tv": "betistv.es" };

export function withChannelProgrammes(channels: readonly LiveChannel[], guides: readonly XmltvGuide[], now = Date.now()): LiveChannel[] {
  return channels.map(channel => {
    const candidates: LiveChannelProgramme[] = [];
    for (const guide of guides) {
      const ids = new Set<string>();
      if (channel.tvgId) {
        const key = channelKey(channel.tvgId);
        for (const programme of guide.programmes) if (channelKey(programme.channelId) === key || TDT_IDS[programme.channelId.toLowerCase()] === key) ids.add(programme.channelId);
      }
      // A display-name fallback is safe only when both sides have no regional ID.
      if (!ids.size && !channel.tvgId) {
        const matches = [...guide.channels].filter(([, names]) => names.some(name => fold(name) === fold(channel.tvgName || channel.name)));
        if (matches.length === 1) ids.add(matches[0][0]);
      }
      candidates.push(...guide.programmes.filter(programme => ids.has(programme.channelId)));
    }
    candidates.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const currentProgramme = candidates.find(p => Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt));
    const nextProgramme = candidates.find(p => Date.parse(p.startsAt) > now);
    return { ...channel, currentProgramme, nextProgramme };
  });
}

export function channelMatchesSports(channel: LiveChannel, sports: readonly string[], now = Date.now()): boolean {
  if (!sports.length) return true;
  const p = channel.currentProgramme;
  const current = p && Date.parse(p.startsAt) <= now && now < Date.parse(p.endsAt)
    ? disciplineFromLabels([...p.categories, p.title, p.subtitle]) : null;
  const channelSports = channel.sports?.some(sport => sports.includes(sport)) ?? false;
  const genericCncVerseSportsChannel = !current && !channel.sports?.length
    && channel.sources.some(source => source.providerId === CNCVERSE_TV_SOURCE_ID);
  return Boolean(current ? sports.includes(current) : channelSports || genericCncVerseSportsChannel);
}

export function requiresRecentChannelProbe(channel: Pick<LiveChannel, "id">, source: LiveSource): boolean {
  return channel.id.startsWith("iptv:") || channel.id.startsWith("highfly:") || source.origin === "iptv" || source.providerId === "sports-streams";
}

/** Imported and Highfly linear channels need a recent successful media probe. */
export function filterFreshIptvChannels(channels: readonly LiveChannel[], now = Date.now()): LiveChannel[] {
  return channels.flatMap(channel => {
    const sources = channel.sources.filter(source => {
      if (!requiresRecentChannelProbe(channel, source)) return true;
      return Number.isFinite(source.verifiedAt)
        && source.verifiedAt! <= now
        && now - source.verifiedAt! <= IPTV_SOURCE_VERIFICATION_TTL_MS;
    });
    return sources.length ? [{ ...channel, sources }] : [];
  });
}

export function programmeMatchup(p: LiveChannelProgramme): [string, string] | null {
  for (const original of [p.title, p.subtitle, p.description?.replace(/\b(vs|v)\.(?=\s)/gi, "$1").split(/\.(?:\s|$)/)[0]]) {
    if (!original) continue;
    const text = original.replace(/\s*\(?\b(?:en directo|directo|en vivo|ao vivo|live)\b\)?\s*/gi, " ").split(":").pop()!.trim();
    const parts = text.match(/^(.{2,140}?)\s+(?:vs\.?|v\.?|[-–—])\s+(.{2,140}?)$/i);
    if (parts) return [parts[1].trim(), parts[2].trim()];
  }
  return null;
}

export function numberedMmaEvent(title: string): string | undefined {
  return fold(title).match(/\b(ufc|bellator|pfl|one)\s+(\d+)\b/)?.[0];
}

function participantKey(name: string, sport: "futbol" | "mma" | "baloncesto"): string {
  // Qualifiers must survive even when a legacy alias resolver is permissive.
  const qualifiers = fold(name).match(/\b(?:women|womens|femenino|femenina|femenil|femeni|ladies|u\d{2}|sub\s?\d{2}|reserves|juvenil)\b/g)?.join("|") ?? "";
  const participant = resolveParticipant(name, sport);
  return `${participant?.entityId ?? fold(participant?.name ?? name)}:${qualifiers}`;
}

export function programmeMatchesEvent(p: LiveChannelProgramme, event: LiveEvent, now = Date.now()): boolean {
  const programmeStart = Date.parse(p.startsAt);
  const programmeEnd = Date.parse(p.endsAt);
  if (event.status !== "live" || p.repeat || NOT_A_MATCH.test(fold(`${p.title} ${p.subtitle ?? ""}`))
    || !Number.isFinite(programmeStart) || !Number.isFinite(programmeEnd) || programmeStart > now || programmeEnd <= now) return false;

  const start = Date.parse(event.startsAt);
  const precision = event.startsAtPrecision ?? "exact";
  if (precision === "exact" && (!Number.isFinite(start) || Math.abs(start - programmeStart) > 45 * 60_000)) return false;
  if (precision === "day" && Number.isFinite(start)
    && new Date(start).toISOString().slice(0, 10) !== new Date(programmeStart).toISOString().slice(0, 10)) return false;
  // `synthesized` and `unknown` are not trustworthy kickoff times. The guide
  // programme is already live now, so keep matching on sport and participants
  // rather than rejecting it because of a fabricated or absent clock value.

  const sport = disciplineFromLabels([event.sport, event.league]);
  const programmeSport = disciplineFromLabels([...p.categories, p.title, p.subtitle]);
  if (!sport || programmeSport && programmeSport !== sport) return false;
  if (sport === "futbol" && /\b(?:basketball|baloncesto|nba|rugby|nfl|american football)\b/.test(fold([...p.categories, p.title, p.subtitle ?? ""].join(" ")))) return false;
  const expected = event.home?.name && event.away?.name ? [event.home.name, event.away.name] : programmeMatchup({ ...p, title: event.title, subtitle: undefined, description: undefined });
  const actual = programmeMatchup(p);
  if (expected && actual) {
    const left = expected.map(name => participantKey(name, sport)).sort();
    const right = actual.map(name => participantKey(name, sport)).sort();
    return left[0] === right[0] && left[1] === right[1];
  }
  if (sport !== "mma") return false;
  return Boolean(numberedMmaEvent(event.title) && numberedMmaEvent(event.title) === numberedMmaEvent(p.title));
}

export function attachIptvSources(events: readonly LiveEvent[], channels: readonly LiveChannel[], now = Date.now()): LiveEvent[] {
  return events.map(event => {
    // Rebuild programme associations from today's channel data on every merge.
    // A cached source must not remain primary after a failed probe or guide change.
    const originals = event.sources.filter(source => source.origin !== "iptv" || !source.validUntil);
    const matching: LiveSource[] = [];
    const known = new Set(originals.map(liveSourceKey));
    if (event.status === "live") for (const channel of channels) {
      const programme = channel.currentProgramme;
      if (!programme || !programmeMatchesEvent(programme, event, now)) continue;
      for (const source of channel.sources) {
        if (!source.verifiedAt || now - source.verifiedAt > 120_000 || source.verifiedAt > now) continue;
        const key = liveSourceKey(source);
        if (known.has(key)) continue;
        known.add(key);
        matching.push({ ...source, origin: "iptv", channelName: channel.name, isDefault: true, validUntil: programme.endsAt });
      }
    }
    return { ...event, sources: sortLiveSources([...originals, ...matching]) };
  });
}

export function iptvChannelEvent(channel: LiveChannel): LiveEvent {
  return { id: `iptv-channel:${channel.id}`, title: channel.name, sport: channel.sports?.[0] ?? "Deportes", league: "Canal deportivo", status: "live",
    startsAt: channel.currentProgramme?.startsAt ?? "", logo: channel.logo, poster: channel.poster, sources: channel.sources.map((source, index) => ({ ...source, isDefault: index === 0 })) };
}
