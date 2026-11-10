import { disciplineFromLabels } from "../data/sports/identity.ts";
import type { LiveChannel, LiveEvent, LiveSource } from "../types/liveSports.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";
import { getSportsIptvLists, IPTV_SPORTS_STORAGE_KEY, type SportsIptvList } from "./iptvSportsConfig.ts";
import { numberedMmaEvent, parseSportsM3u, parseXmltv, programmeMatchup, stableIptvId, withChannelProgrammes, type XmltvGuide } from "./iptvSports.ts";
import { liveSourceKey } from "./liveSportsSourceRanking.ts";
import { fetchIptvText, IPTV_SOURCE_VERIFICATION_TTL_MS, probeIptvSource } from "./iptvSportsHttp.ts";
import { registerLiveSportsProvider, type LiveSportsProvider } from "./liveSportsService.ts";

export const IPTV_SPORTS_STATUS_EVENT = "aetherio-sports-iptv-status";
export interface IptvSportsStatus { loading: boolean; channels: number; withGuide: number; issues: string[]; updatedAt?: number; }
let status: IptvSportsStatus = { loading: false, channels: 0, withGuide: 0, issues: [] };
let statusScope = "";
const VERIFIED_CHANNELS_CACHE_MS = 15_000;
const FAILED_SOURCE_CACHE_MS = 10_000;
const CHANNEL_PROBE_CONCURRENCY = 8;
export function getIptvSportsStatus(): IptvSportsStatus { return statusScope === getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY) ? status : { loading: false, channels: 0, withGuide: 0, issues: [] }; }
function publishStatus(next: IptvSportsStatus, scope = getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY)) {
  if (scope !== getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY)) return;
  statusScope = scope;
  status = next;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(IPTV_SPORTS_STATUS_EVENT));
}

async function concurrent<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await worker(items[index]); }
  }));
  return results;
}

function mergeChannels(channels: LiveChannel[]): LiveChannel[] {
  const merged = new Map<string, LiveChannel>();
  for (const channel of channels) {
    const key = channel.tvgId?.replace(/@(?:sd|hd|fhd|uhd|4k)$/i, "").toLowerCase() ?? channel.id;
    const existing = merged.get(key);
    if (!existing) merged.set(key, channel);
    else {
      const known = new Set(existing.sources.map(liveSourceKey));
      const sources = [...existing.sources];
      for (const source of channel.sources) {
        const sourceKey = liveSourceKey(source);
        if (known.has(sourceKey)) continue;
        known.add(sourceKey);
        sources.push(source);
      }
      merged.set(key, { ...existing, sports: [...new Set([...(existing.sports ?? []), ...(channel.sports ?? [])])], sources });
    }
  }
  return [...merged.values()];
}

export function buildIptvSportsProvider(dependencies: {
  lists?: () => SportsIptvList[];
  text?: (url: string) => Promise<string>;
  probe?: (source: LiveSource) => Promise<boolean>;
  now?: () => number;
} = {}): LiveSportsProvider {
  const lists = dependencies.lists ?? getSportsIptvLists;
  const download = dependencies.text ?? fetchIptvText;
  const probe = dependencies.probe ?? probeIptvSource;
  const now = dependencies.now ?? Date.now;
  let cacheKey = "";
  let catalogAt = -Infinity;
  let catalog: Promise<{ channels: LiveChannel[]; guides: XmltvGuide[]; issues: string[] }> | undefined;
  let verifiedAt = -Infinity;
  let verified: Promise<LiveChannel[]> | undefined;
  let verificationPending = false;
  const probes = new Map<string, { at: number; ok: boolean }>();
  const pendingProbes = new Map<string, Promise<{ at: number; ok: boolean }>>();

  async function checkSource(source: LiveSource) {
    const key = liveSourceKey(source);
    const cached = probes.get(key);
    const ttl = cached?.ok ? IPTV_SOURCE_VERIFICATION_TTL_MS : FAILED_SOURCE_CACHE_MS;
    if (cached && now() >= cached.at && now() - cached.at < ttl) return cached;
    const pending = pendingProbes.get(key);
    if (pending) return pending;
    const request = Promise.resolve().then(() => probe(source))
      .catch(() => false)
      .then(ok => {
        const result = { at: now(), ok };
        probes.set(key, result);
        return result;
      });
    pendingProbes.set(key, request);
    try { return await request; }
    finally { if (pendingProbes.get(key) === request) pendingProbes.delete(key); }
  }

  function getCatalog() {
    const enabled = lists().filter(list => list.enabled);
    const key = `${getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY)}:${JSON.stringify(enabled)}`;
    if (catalog && key === cacheKey && now() - catalogAt < 10 * 60_000) return catalog;
    cacheKey = key;
    catalogAt = now();
    verified = undefined;
    verifiedAt = -Infinity;
    verificationPending = false;
    publishStatus({ loading: true, channels: 0, withGuide: 0, issues: [] });
    catalog = (async () => {
      const issues: string[] = [];
      const parsed = await concurrent(enabled, 3, async list => {
        try { return { ...parseSportsM3u(list.content ?? await download(list.url!), list), list }; }
        catch { issues.push(`No se pudo cargar «${list.name}». Revisa la lista o vuelve a intentarlo.`); return null; }
      });
      const valid = parsed.filter(value => value !== null);
      const guideUrls = [...new Set(valid.flatMap(value => [...value.list.epgUrls, ...value.epgUrls]))];
      const guides = await concurrent(guideUrls, 2, async url => {
        try { return parseXmltv(await download(url), now()); }
        catch { issues.push("Una guía de programación no está disponible. Sus canales siguen disponibles sin asignarles partidos."); return null; }
      });
      // Broken upstreams retry on the next minute, not after the full successful-cache TTL.
      if (cacheKey === key && issues.length) catalogAt = now() - 9 * 60_000;
      return { channels: mergeChannels(valid.flatMap(value => value.channels)), guides: guides.filter(value => value !== null), issues: [...new Set(issues)] };
    })();
    return catalog;
  }

  async function getChannels() {
    const pending = getCatalog();
    const requestKey = cacheKey;
    const scope = getScopedStorageKey(IPTV_SPORTS_STORAGE_KEY);
    if (verified && (verificationPending || now() - verifiedAt < VERIFIED_CHANNELS_CACHE_MS)) return verified;
    const currentRequest = (async () => {
      const data = await pending;
      const current = withChannelProgrammes(data.channels, data.guides, now());
      const checked = await concurrent<LiveChannel, LiveChannel | null>(current, CHANNEL_PROBE_CONCURRENCY, async (channel): Promise<LiveChannel | null> => {
        // Verify every route so the user can choose among all live alternatives.
        const sources: LiveSource[] = [];
        for (const source of channel.sources) {
          const result = await checkSource(source);
          if (result.ok && result.at <= now() && now() - result.at <= IPTV_SOURCE_VERIFICATION_TTL_MS) {
            sources.push({ ...source, verifiedAt: result.at });
          }
        }
        return sources.length ? { ...channel, sources } : null;
      });
      if (probes.size > 2048) {
        for (const key of probes.keys()) { probes.delete(key); if (probes.size <= 1536) break; }
      }
      const channels = checked.filter((channel): channel is LiveChannel => channel !== null);
      if (cacheKey === requestKey) publishStatus({ loading: false, channels: channels.length, withGuide: channels.filter(channel => channel.currentProgramme).length, issues: data.issues, updatedAt: now() }, scope);
      return channels;
    })();
    verifiedAt = now();
    verified = currentRequest;
    verificationPending = true;
    void currentRequest.then(
      () => { if (verified === currentRequest) { verifiedAt = now(); verificationPending = false; } },
      () => { if (verified === currentRequest) { verified = undefined; verifiedAt = -Infinity; verificationPending = false; } },
    );
    return currentRequest;
  }

  return {
    id: "iptv-sports", label: "IPTV · Canales deportivos", priority: "fallback",
    fetchChannels: getChannels,
    async fetchEvents() {
      const channels = await getChannels();
      return channels.flatMap((channel): LiveEvent[] => {
        const p = channel.currentProgramme;
        if (!p?.live || p.repeat || Date.parse(p.endsAt) <= now()) return [];
        const sides = programmeMatchup(p);
        const sport = disciplineFromLabels([...p.categories, p.title, p.subtitle]) ?? (channel.sports?.length === 1 ? channel.sports[0] : null);
        const sources = channel.sources.filter(source => source.verifiedAt && now() - source.verifiedAt <= 120_000).map(source => ({ ...source, isDefault: true, validUntil: p.endsAt }));
        if (!sport || (!sides && !numberedMmaEvent(p.title)) || !sources.length) return [];
        return [{ id: `iptv-event:${channel.id}:${stableIptvId(p.title + p.startsAt)}`, title: sides ? `${sides[0]} vs ${sides[1]}` : p.title, sport, league: "Programación IPTV", status: "live", startsAt: p.startsAt,
          ...(sides ? { home: { name: sides[0] }, away: { name: sides[1] } } : {}), sources }];
      });
    },
  };
}

registerLiveSportsProvider(buildIptvSportsProvider());
