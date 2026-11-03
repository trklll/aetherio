import type { LiveChannel, LiveEvent, LiveSource } from "../types/liveSports.ts";
import { cleanMetaName, fetchCatalogMetas, fetchManifest, fetchMeta, fetchStreams, humanizeSport, isLiveReleaseInfo, parseTextDate, probeLiveSource, splitVersus, stremioStreamToLiveSource, type StremioMeta } from "../types/stremioSports.ts";
import type { LiveSportsProvider } from "./liveSportsService.ts";
import { sortLiveSources, spanishCommentaryPriority } from "./liveSportsSourceRanking.ts";
import { SPORTS_STREAMS_PROVIDER_ID } from "./sportsStreamsConfig.ts";
import { publicSportsHttps } from "./fmhySportsHttp.ts";
import { disciplineFromLabels } from "../data/sports/identity.ts";

const CATALOG_TTL_MS = 30_000;
const MAX_CATALOGS = 64;
const MAX_CATALOG_PAGES = 5;
const PAGE_SIZE = 100;
const MAX_EVENTS = 120;
const CONCURRENCY = 4;

async function concurrent<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  let cursor = 0;
  const results = new Array<R>(items.length);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; results[index] = await worker(items[index]); }
  }));
  return results;
}

function startTime(meta: StremioMeta): string | null {
  const released = meta.released?.trim();
  if (released) {
    // An ISO timestamp without an offset is UTC in this addon, never client-local.
    const date = Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(released) ? `${released}Z` : released);
    if (Number.isFinite(date)) return new Date(date).toISOString();
  }
  return parseTextDate(meta.releaseInfo);
}

function hasExactTime(meta: StremioMeta): boolean {
  return /T\d{2}:\d{2}/.test(meta.released ?? "") || /\d{1,2}:\d{2}\s*UTC/.test(meta.releaseInfo ?? "");
}

function eventFromMeta(meta: StremioMeta, now: number): LiveEvent | null {
  const title = cleanMetaName(meta.name, "");
  if (!title || !meta.id || meta.id.startsWith("recap:")) return null;
  const teams = splitVersus(title);
  const startsAt = startTime(meta);
  const live = isLiveReleaseInfo(meta.releaseInfo);
  if (!live && (!startsAt || Date.parse(startsAt) <= now)) return null;
  const sport = humanizeSport(meta.genres?.[0] ?? meta.category);
  // Free-tier posters contain server-rendered UTC text. Prefer neutral artwork;
  // Aetherio renders the schedule itself, without requesting a premium timezone.
  const poster = [meta.background, meta.poster].find(value => value && !/_UTC\.(?:webp|png|jpe?g)(?:\?|$)/i.test(value));
  return { id: `sportsstreams:${meta.id}`, title: teams ? `${teams[0]} vs ${teams[1]}` : title,
    sport, league: meta.genres?.[1] || sport, leagueCandidates: meta.genres?.slice(1),
    status: live ? "live" : "upcoming", startsAt: startsAt ?? "",
    startsAtPrecision: !startsAt ? "unknown" : hasExactTime(meta) ? "exact" : "day",
    home: teams ? { name: teams[0] } : undefined,
    away: teams ? { name: teams[1] } : undefined, poster, logo: meta.logo, sources: [] };
}

export function buildSportsStreamsProvider(dependencies: {
  base: () => string;
  manifest?: typeof fetchManifest;
  catalog?: typeof fetchCatalogMetas;
  meta?: typeof fetchMeta;
  streams?: typeof fetchStreams;
  probe?: typeof probeLiveSource;
  now?: () => number;
}): LiveSportsProvider {
  const manifest = dependencies.manifest ?? fetchManifest;
  const catalog = dependencies.catalog ?? fetchCatalogMetas;
  const details = dependencies.meta ?? fetchMeta;
  const streams = dependencies.streams ?? fetchStreams;
  const probe = dependencies.probe ?? probeLiveSource;
  const now = dependencies.now ?? Date.now;
  let cachedBase = "";
  let cachedAt = -Infinity;
  let pending: Promise<StremioMeta[]> | undefined;
  let loading = false;
  const sourceRequests = new Map<string, Promise<LiveSource[]>>();

  function getCatalog(): Promise<StremioMeta[]> {
    const base = dependencies.base();
    if (!base) return Promise.resolve([]);
    if (pending && cachedBase === base && (loading || now() >= cachedAt && now() - cachedAt < CATALOG_TTL_MS)) return pending;
    cachedBase = base;
    cachedAt = now();
    sourceRequests.clear();
    loading = true;
    pending = (async () => {
      const info = await manifest(base).catch(() => null);
      const declared = info?.catalogs?.filter(item => item?.type === "sport" && item.id) ?? [];
      const catalogs = [...new Map((declared.length ? declared : [{ type: "sport", id: "sports_live" }]).map(item => [item.id, item])).values()].slice(0, MAX_CATALOGS);
      const pages = await concurrent(catalogs, async item => {
        const metas: StremioMeta[] = [];
        const ids = new Set<string>();
        for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
          const batch = await catalog(base, item.type, item.id, page ? { skip: String(page * PAGE_SIZE) } : undefined).catch(() => []);
          let added = 0;
          for (const meta of batch) {
            if (!meta?.id || ids.has(meta.id)) continue;
            ids.add(meta.id); added++;
            metas.push(meta);
          }
          if (batch.length < PAGE_SIZE || !added || !item.extra?.some(extra => extra.name === "skip")) break;
        }
        return metas;
      });
      // Interleave catalogs before any event budget so one large football list
      // cannot consume all slots before basketball or a configured league.
      const byId = new Map<string, StremioMeta>();
      const count = Math.max(0, ...pages.map(page => page.length));
      for (let index = 0; index < count; index++) for (const page of pages) {
        const meta = page[index];
        if (meta && !byId.has(meta.id)) byId.set(meta.id, meta);
      }
      return concurrent([...byId.values()].slice(0, MAX_EVENTS * 2), async meta => {
        if (cleanMetaName(meta.name, "") && startTime(meta)) return meta;
        const detail = await details(base, "sport", meta.id).catch(() => null);
        if (!detail || detail.id !== meta.id) {
          const name = cleanMetaName(meta.name, "") || cleanMetaName(meta.description?.split(/\r?\n/)[0], "");
          return { ...meta, name: meta.id.startsWith("leaf:") && name === "Live IPTV Recording" ? `Canal Highfly · ${meta.genres?.[1] ?? meta.id.slice(5)}` : name };
        }
        return { ...meta, ...detail, released: (hasExactTime(detail) ? startTime(detail) : detail.released) ?? meta.released,
          // A detail often gives only the kickoff, while the catalog knows LIVE.
          releaseInfo: isLiveReleaseInfo(meta.releaseInfo) ? "LIVE" : detail.releaseInfo ?? meta.releaseInfo };
      });
    })();
    const request = pending;
    void request.then(() => { if (pending === request) { loading = false; cachedAt = now(); } },
      () => { if (pending === request) { loading = false; pending = undefined; } });
    return pending;
  }

  function resolveSources(meta: StremioMeta): Promise<LiveSource[]> {
    const base = dependencies.base();
    const key = `${base}:${meta.id}`;
    const existing = sourceRequests.get(key);
    if (existing) return existing;
    const request = (async () => {
      const payload = await streams(base, "sport", meta.id).catch(() => []);
      const candidates = sortLiveSources(payload.map((stream, index) => {
        const source = stremioStreamToLiveSource(stream, `sportsstreams:${meta.id}`, index);
        if (!source || !publicSportsHttps(source.url)) return null;
        const spanish = spanishCommentaryPriority({ language: source.language, label: `${stream.name ?? ""} ${stream.title ?? ""}` });
        return { ...source, providerId: SPORTS_STREAMS_PROVIDER_ID, label: `Sports Streams · ${source.label}`,
          quality: source.quality || stream.title?.match(/\b(\d{3,4})[pi]\b/i)?.[0] || stream.title?.match(/\b\d{3,4}x(\d{3,4})\b/)?.[1]?.concat("p"),
          language: source.language || (spanish ? "es" : undefined) };
      }).filter((source): source is NonNullable<typeof source> => source !== null));
      const available: LiveSource[] = [];
      for (const source of candidates.slice(0, 12)) {
        if (available.some(item => item.url === source.url)) continue;
        if (await probe(source).catch(() => "dead") === "live") available.push({ ...source, verifiedAt: now(), isDefault: available.length === 0 });
        if (available.length === 4) break;
      }
      return available;
    })();
    sourceRequests.set(key, request);
    return request;
  }

  return {
    id: SPORTS_STREAMS_PROVIDER_ID, label: "Sports Streams · Highfly",
    async fetchEvents() {
      const metas = (await getCatalog()).filter(meta => !meta.id.startsWith("leaf:"));
      const candidates = metas.map(meta => ({ meta, event: eventFromMeta(meta, now()) })).filter(item => item.event?.status === "live").slice(0, MAX_EVENTS);
      const events = await concurrent(candidates, async ({ meta, event }) => {
        const sources = await resolveSources(meta);
        return sources.length && event ? { ...event, sources } : null;
      });
      return events.filter((event): event is LiveEvent => event !== null);
    },
    async fetchUpcoming() {
      return (await getCatalog()).filter(meta => !meta.id.startsWith("leaf:")).map(meta => eventFromMeta(meta, now()))
        .filter((event): event is LiveEvent => event?.status === "upcoming")
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, MAX_EVENTS);
    },
    async fetchChannels() {
      const metas = (await getCatalog()).filter(meta => meta.id.startsWith("leaf:") && isLiveReleaseInfo(meta.releaseInfo)).slice(0, MAX_EVENTS);
      const channels = await concurrent(metas, async meta => {
        const sources = await resolveSources(meta);
        if (!sources.length) return null;
        const sport = disciplineFromLabels(meta.genres ?? []);
        return { id: `highfly:${meta.id}`, name: cleanMetaName(meta.name, "Canal deportivo"), category: "Sports Streams", logo: meta.logo,
          language: sources[0]?.language, country: meta.id.match(/^leaf:([a-z]{2})-/i)?.[1],
          sports: sport ? [sport] : [], sources } satisfies LiveChannel;
      });
      return channels.filter((channel): channel is NonNullable<typeof channel> => channel !== null);
    },
  };
}
