import type { LiveEvent, LiveSource } from "../types/liveSports.ts";
import { cleanMetaName, humanizeSport, splitVersus } from "../types/stremioSports.ts";
import { registerLiveSportsProvider, type LiveSportsProvider } from "./liveSportsService.ts";
import { fetchSportsText as fetchText, publicSportsHttps as publicHttps, SPORTS_USER_AGENT as USER_AGENT } from "./fmhySportsHttp.ts";
import { probeFmhyNativeSource } from "./fmhyNativeProbe.ts";
import { liveSourceKey } from "./liveSportsSourceRanking.ts";

const SPORTS_BITE = "https://sportsbite.org";
const STREAM_FREE = "https://streamfree.top";
const CATALOG_TTL_MS = 30_000;
const MAX_LIVE_EVENTS = 16;
const MAX_EVENT_AGE_MS = 5 * 60 * 60 * 1000;
const SPORTS_BITE_PATH = /^\/(?:tlive|lol|rs|sk)\//;
const SPORTS_BITE_PLAYER = /^\/(?:tlive|lol|rs|sk)-embed\/embed\//;
const STREAM_FREE_HOSTS = new Set(["streamfree.top", "strmfree.st"]);

interface SourceDescriptor { url: string; label?: string; quality?: string; language?: string }
interface SportsCandidate {
  provider: "sportsbite" | "streamfree";
  event: LiveEvent;
  players: SourceDescriptor[];
  streamKey?: string;
}
type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 500) : "";

function image(value: unknown, base: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try { return publicHttps(new URL(raw, base).href)?.href; } catch { return undefined; }
}

function eventStatus(start: number, now: number): "live" | "upcoming" | null {
  if (!Number.isFinite(start) || now - start > MAX_EVENT_AGE_MS || start - now > 7 * 86_400_000) return null;
  return start > now ? "upcoming" : "live";
}

function sportLabel(value: string) {
  if (/american|\bnfl\b|\bncaaf\b/i.test(value)) return "futbol americano";
  return humanizeSport(value);
}

export function mapSportsBiteEvents(payload: unknown, now = Date.now()): SportsCandidate[] {
  const days = record(payload).days;
  if (!Array.isArray(days)) return [];
  const candidates: SportsCandidate[] = [];
  for (const day of days.slice(0, 10)) {
    const events = record(day).events;
    if (!Array.isArray(events)) continue;
    for (const value of events.slice(0, 200)) {
      const raw = record(value);
      if (raw.is_finished === true || raw.always_live === true || raw.always_live === 1 || /^(?:ft|post|final|cancelled|canceled)$/i.test(text(record(raw.live_status).state))) continue;
      const start = Date.parse(text(raw.start));
      const status = eventStatus(start, now);
      const id = text(raw.slug);
      const title = cleanMetaName(text(raw.title), "").replace(/\bvs\./gi, "vs");
      const sport = sportLabel(text(raw.sport) || text(raw.category));
      if (!status || !id || !title || !sport) continue;
      const teams = record(raw.teams);
      const home = text(record(teams.home).name);
      const away = text(record(teams.away).name);
      const streams = Array.isArray(raw.streams) ? raw.streams : [];
      const players = streams.flatMap(value => {
        const source = record(value);
        const url = publicHttps(source.manifest_url);
        if (!url || url.origin !== SPORTS_BITE || (!SPORTS_BITE_PATH.test(url.pathname) && !SPORTS_BITE_PLAYER.test(url.pathname)) || text(source.status) === "offline") return [];
        return [{ url: url.href, label: text(source.label) || text(source.name), quality: text(source.quality), language: text(source.language) }];
      }).sort((a, b) => Number(/spanish|espa[nñ]ol|latino/i.test(b.language)) - Number(/spanish|espa[nñ]ol|latino/i.test(a.language)));
      candidates.push({
        provider: "sportsbite", players,
        event: {
          id: `fmhy:sportsbite:${id}`, title: home && away ? `${home} vs ${away}` : title,
          sport, league: text(raw.league) || text(raw.tournament) || sport, status, startsAt: new Date(start).toISOString(),
          home: home ? { name: home, logo: image(record(teams.home).badge, SPORTS_BITE) } : undefined,
          away: away ? { name: away, logo: image(record(teams.away).badge, SPORTS_BITE) } : undefined,
          poster: image(raw.poster, SPORTS_BITE), sources: [],
        },
      });
    }
  }
  return candidates;
}

export function mapStreamFreeEvents(payload: unknown, now = Date.now()): SportsCandidate[] {
  const categories = record(record(payload).streams);
  const candidates: SportsCandidate[] = [];
  for (const [category, values] of Object.entries(categories).slice(0, 20)) {
    if (!Array.isArray(values)) continue;
    for (const value of values.slice(0, 100)) {
      const raw = record(value);
      const title = cleanMetaName(text(raw.name), "");
      const home = text(record(raw.team1).name);
      const away = text(record(raw.team2).name);
      // Linear channels are not matches. Do not create fake "live" events for them.
      if (!(home && away) && !splitVersus(title)) continue;
      const key = text(raw.stream_key);
      if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(key)) continue;
      const start = typeof raw.match_timestamp === "number" ? raw.match_timestamp * 1000 : NaN;
      const status = eventStatus(start, now);
      if (!status || !title) continue;
      const sport = category === "football" ? "futbol americano" : sportLabel(category);
      candidates.push({
        provider: "streamfree", players: [], streamKey: key,
        event: {
          id: `fmhy:streamfree:${key}`, title, sport, league: text(raw.league) || sport,
          status, startsAt: new Date(start).toISOString(),
          home: home ? { name: home, logo: image(record(raw.team1).logo, STREAM_FREE) } : undefined,
          away: away ? { name: away, logo: image(record(raw.team2).logo, STREAM_FREE) } : undefined,
          poster: image(raw.thumbnail_url, STREAM_FREE), sources: [],
        },
      });
    }
  }
  return candidates;
}

function decodeBase64(value: string) {
  try { return new TextDecoder().decode(Uint8Array.from(atob(value), character => character.charCodeAt(0))); }
  catch { return ""; }
}

async function fetchJson(url: string): Promise<unknown> {
  const body = await fetchText(url);
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

export async function resolveSportsBiteSource(player: SourceDescriptor): Promise<LiveSource | null> {
  let url = publicHttps(player.url);
  if (!url || url.origin !== SPORTS_BITE) return null;
  if (SPORTS_BITE_PLAYER.test(url.pathname)) {
    const body = await fetchText(url.href, `${SPORTS_BITE}/`);
    // Read a single data literal, never eval player scripts or scrape ad links.
    const encoded = body?.match(/\b(?:var|let|const)\s+source\s*=\s*(?:window\.)?atob\(\s*["']([A-Za-z0-9+/_=-]+)["']\s*\)/)?.[1];
    url = encoded ? publicHttps(decodeBase64(encoded)) : null;
  }
  if (!url || url.origin !== SPORTS_BITE || !SPORTS_BITE_PATH.test(url.pathname)) return null;
  const source: LiveSource = {
    id: `sportsbite:${url.pathname}`, label: `SportsBite${player.label ? ` · ${player.label}` : ""}`,
    url: url.href, language: player.language, quality: player.quality,
    headers: { Referer: `${SPORTS_BITE}/`, "User-Agent": USER_AGENT },
  };
  return await probeFmhyNativeSource(source) ? source : null;
}

export async function resolveStreamFreeSource(key: string, player: string): Promise<LiveSource | null> {
  if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(key)) return null;
  const embed = publicHttps(player);
  if (!embed || !STREAM_FREE_HOSTS.has(embed.hostname)) return null;
  const match = embed.pathname.match(/^\/embed\/[a-z-]+\/([^/]+)$/);
  if (!match) return null;
  const variant = match[1];
  const quality = variant.slice(key.length).match(/^(1080p|720p|540p|2160p)(?:2)?$/)?.[1];
  if (!variant.startsWith(key) || !quality) return null;
  const [metadata, body] = await Promise.all([fetchJson(`${STREAM_FREE}/get-stream-key/${encodeURIComponent(key)}`), fetchText(embed.href)]);
  const server = record(metadata);
  // External embeds and unknown server modes are not native sources.
  if (server.is_external === true || !["origin", "cdn", "externalcdn"].includes(text(server.server_name)) || !body) return null;
  const literal = body.match(/\bconst\s+_0x\s*=\s*(\{[^;]{1,4096}\})\s*;/)?.[1];
  if (!literal) return null;
  let token: JsonRecord;
  try { token = record(record(JSON.parse(literal))[quality]); } catch { return null; }
  if (typeof token._e !== "number" || token._e * 1000 <= Date.now() + 15_000 || !/^[\w-]{1,250}$/.test(text(token._t)) || !/^[\w-]{1,250}$/.test(text(token._n))) return null;
  const prefix = server.server_name === "externalcdn" ? "live-externalcdn" : server.server_name === "cdn" ? "live-cdn" : "live";
  const url = new URL(`/${prefix}/${variant}/index.m3u8`, embed.origin);
  url.search = new URLSearchParams({ _t: text(token._t), _e: String(token._e), _n: text(token._n) }).toString();
  const source: LiveSource = { id: `streamfree:${variant}`, label: `StreamFree · ${quality}`, url: url.href, quality, headers: { Referer: embed.href, "User-Agent": USER_AGENT } };
  return await probeFmhyNativeSource(source) ? source : null;
}

async function mapConcurrent<T, R>(values: T[], worker: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await worker(values[index]); }
  }));
  return results;
}

export function buildFmhySportsProvider(): LiveSportsProvider {
  let catalog: Promise<SportsCandidate[]> | undefined;
  let fetchedAt = 0;
  function getCatalog() {
    if (catalog && Date.now() - fetchedAt < CATALOG_TTL_MS) return catalog;
    fetchedAt = Date.now();
    catalog = Promise.all([
      fetchJson(`${SPORTS_BITE}/api/forestgump/matches`).then(mapSportsBiteEvents),
      fetchJson(`${STREAM_FREE}/streams`).then(mapStreamFreeEvents),
    ]).then(groups => groups.flat());
    return catalog;
  }
  return {
    id: "fmhy-native", label: "FMHY · SportsBite / StreamFree (nativo)",
    async fetchEvents(onProgress) {
      const candidates = (await getCatalog()).filter(candidate => candidate.event.status === "live");
      // A per-site cap prevents one catalog consuming the entire request budget.
      const bounded = ["sportsbite", "streamfree"].flatMap(provider => candidates.filter(candidate => candidate.provider === provider).slice(0, MAX_LIVE_EVENTS / 2));
      const resolvedById = new Map<string, LiveEvent>();
      const events = await mapConcurrent(bounded, async candidate => {
        const sources: LiveSource[] = [];
        const addSource = (source: LiveSource) => {
          if (sources.some(existing => liveSourceKey(existing) === liveSourceKey(source))) return;
          sources.push(source);
          resolvedById.set(candidate.event.id, { ...candidate.event, sources: [...sources] });
          onProgress?.([...resolvedById.values()]);
        };
        try {
          if (candidate.provider === "sportsbite") {
            for (const player of candidate.players) {
              const source = await resolveSportsBiteSource(player);
              if (source) addSource(source);
            }
          } else if (candidate.streamKey) {
            const response = record(await fetchJson(`${STREAM_FREE}/api/v1/sources/${encodeURIComponent(candidate.streamKey)}`));
            // Merely being listed in `sources` does not mean it is transmitting.
            const players = Array.isArray(response.live_sources) ? response.live_sources : [];
            for (const player of players) {
              if (typeof player !== "string") continue;
              const source = await resolveStreamFreeSource(candidate.streamKey, player);
              if (source) addSource(source);
            }
          }
        } catch { /* One bad player never discards another site's events. */ }
        return sources.length ? { ...candidate.event, sources } : null;
      });
      return events.filter((event): event is LiveEvent => event !== null);
    },
    async fetchUpcoming() {
      return (await getCatalog()).filter(candidate => candidate.event.status === "upcoming")
        .map(candidate => candidate.event).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)).slice(0, 60);
    },
  };
}

registerLiveSportsProvider(buildFmhySportsProvider());
