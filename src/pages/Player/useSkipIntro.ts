import { useEffect, useMemo, useState } from "react";
import { getApiKeys, tmdbFetch } from "../../config/apiKeys";
import { invokeCommand } from "../../runtime/platform";
import type { StreamQuery } from "../../types/stream";

export interface SkipSegment {
  id: string;
  source: "introdb" | "aniskip" | "anime-skip";
  kind: "intro" | "recap";
  start: number;
  end: number;
}

interface SkipIntroOptions {
  enabled: boolean;
  animeSkipEnabled: boolean;
}

interface IntroDbSegment {
  start_sec?: number;
  end_sec?: number;
  start_ms?: number;
  end_ms?: number;
}

interface ArmEntry {
  myanimelist?: number;
  anilist?: number;
  kitsu?: number;
  imdb?: string;
}

const ARM_API = "https://arm.haglund.dev/api/v2";
const skipSegmentCache = new Map<string, SkipSegment[]>();

function normalizeSegment(source: SkipSegment["source"], kind: SkipSegment["kind"], segment: IntroDbSegment | null | undefined): SkipSegment | null {
  const start = Number(segment?.start_sec ?? (typeof segment?.start_ms === "number" ? segment.start_ms / 1000 : NaN));
  const end = Number(segment?.end_sec ?? (typeof segment?.end_ms === "number" ? segment.end_ms / 1000 : NaN));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    id: `${source}:${kind}:${start}:${end}`,
    source,
    kind,
    start: Math.max(0, start),
    end,
  };
}

function kindForAnimeSkipType(type: string): SkipSegment["kind"] | null {
  const normalized = type.toLowerCase();
  if (normalized === "intro" || normalized === "new intro" || normalized === "mixed intro" || normalized.includes("intro")) return "intro";
  if (normalized === "recap" || normalized.includes("recap")) return "recap";
  return null;
}

function segmentsFromAnimeSkipTimestamps(timestamps: any[]): SkipSegment[] {
  const sorted = [...timestamps]
    .map(item => ({
      at: Number(item?.at),
      type: String(item?.type?.name ?? "").toLowerCase(),
    }))
    .filter(item => Number.isFinite(item.at) && item.at >= 0)
    .sort((a, b) => a.at - b.at);

  return sorted.map((item, index) => {
    const kind = kindForAnimeSkipType(item.type);
    if (!kind) return null;
    const next = sorted[index + 1];
    const end = Number(next?.at);
    if (!Number.isFinite(end) || end <= item.at + 8) return null;
    return {
      id: `anime-skip:${kind}:${item.at}:${end}`,
      source: "anime-skip" as const,
      kind,
      start: item.at,
      end,
    };
  }).filter(Boolean) as SkipSegment[];
}

function segmentsFromAniSkipResults(results: any[]): SkipSegment[] {
  return results.map(result => {
    const skipType = String(result?.skipType ?? "").toLowerCase();
    const kind: SkipSegment["kind"] | null = skipType.includes("recap") ? "recap" : skipType.includes("op") ? "intro" : null;
    const start = Number(result?.interval?.startTime);
    const end = Number(result?.interval?.endTime);
    if (!kind || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return {
      id: `aniskip:${kind}:${start}:${end}`,
      source: "aniskip" as const,
      kind,
      start,
      end,
    };
  }).filter(Boolean) as SkipSegment[];
}

function legacyAnimeSkipSegment(timestamps: any[]): SkipSegment | null {
  const sorted = [...timestamps]
    .map(item => ({
      at: Number(item?.at),
      type: String(item?.type?.name ?? "").toLowerCase(),
    }))
    .filter(item => Number.isFinite(item.at) && item.at >= 0)
    .sort((a, b) => a.at - b.at);

  for (let index = 0; index < sorted.length; index += 1) {
    const item = sorted[index];
    if (!item.type.includes("intro")) continue;
    const nextCanonical = sorted.slice(index + 1).find(next => (
      next.at > item.at && (
        next.type.includes("canon") ||
        next.type.includes("must watch") ||
        next.type.includes("recap") ||
        next.type.includes("title card")
      )
    ));
    if (!nextCanonical || nextCanonical.at - item.at < 8) continue;
    return {
      id: `anime-skip:intro:${item.at}:${nextCanonical.at}`,
      source: "anime-skip",
      kind: "intro",
      start: item.at,
      end: nextCanonical.at,
    };
  }

  return null;
}

async function resolveImdbId(query: StreamQuery) {
  if (query.id.startsWith("tt")) return query.id;
  if (!query.id.startsWith("tmdb:")) return null;
  const tmdbId = query.id.slice(5);
  const tmdbType = query.type === "movie" ? "movie" : "tv";
  const json = await tmdbFetch<any>(`/${tmdbType}/${tmdbId}/external_ids`);
  return typeof json?.imdb_id === "string" && json.imdb_id.startsWith("tt") ? json.imdb_id : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

async function resolveImdbToArmEntries(imdbId: string): Promise<ArmEntry[]> {
  return await fetchJson<ArmEntry[]>(`${ARM_API}/imdb?id=${encodeURIComponent(imdbId)}&include=myanimelist,anilist,kitsu`) ?? [];
}

async function resolveMalToArmEntry(malId: string, include = "imdb,anilist"): Promise<ArmEntry | null> {
  return fetchJson<ArmEntry>(`${ARM_API}/ids?source=myanimelist&id=${encodeURIComponent(malId)}&include=${include}`);
}

async function resolveKitsuToArmEntry(kitsuId: string, include = "myanimelist,imdb,anilist"): Promise<ArmEntry | null> {
  return fetchJson<ArmEntry>(`${ARM_API}/ids?source=kitsu&id=${encodeURIComponent(kitsuId)}&include=${include}`);
}

async function loadIntroDbSegments(query: StreamQuery): Promise<SkipSegment[]> {
  if (!query.season || !query.episode || query.type === "movie") return [];
  const imdbId = await resolveImdbId(query);
  if (!imdbId) return [];
  const json = await invokeCommand<Record<string, unknown>>("fetch_introdb_segments", {
    imdbId,
    season: query.season,
    episode: query.episode,
  }).catch(() => ({}));
  return [
    normalizeSegment("introdb", "recap", (json as { recap?: IntroDbSegment }).recap),
    normalizeSegment("introdb", "intro", (json as { intro?: IntroDbSegment }).intro),
  ].filter(Boolean) as SkipSegment[];
}

async function loadAniSkipSegments(malId: string, episode: number): Promise<SkipSegment[]> {
  const url = `https://api.aniskip.com/v2/skip-times/${encodeURIComponent(malId)}/${episode}?episodeLength=0&types=op&types=recap&types=mixed-op`;
  const json = await fetchJson<{ found?: boolean; results?: any[] }>(url);
  if (!json?.found || !Array.isArray(json.results)) return [];
  return segmentsFromAniSkipResults(json.results);
}

async function animeSkipRequest<T>(clientId: string, query: string, variables: Record<string, unknown>): Promise<T | null> {
  const response = await fetch("https://api.anime-skip.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-ID": clientId,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) return null;
  const json = await response.json();
  return json.data ?? null;
}

async function resolveAnimeSkipShowIds(anilistId: string, clientId: string): Promise<string[]> {
  const data = await animeSkipRequest<{ findShowsByExternalId?: { id: string }[] }>(
    clientId,
    "query FindShows($serviceId: String!) { findShowsByExternalId(service: ANILIST, serviceId: $serviceId) { id } }",
    { serviceId: anilistId },
  );
  return (data?.findShowsByExternalId ?? []).map(item => item.id).filter(Boolean);
}

async function loadAnimeSkipSegmentsByAnilist(anilistId: string, episode: number, season: number | null): Promise<SkipSegment[]> {
  const clientId = getApiKeys().animeSkipClientId;
  if (!clientId) return [];
  const showIds = await resolveAnimeSkipShowIds(anilistId, clientId);
  for (const showId of showIds) {
    const data = await animeSkipRequest<{ findEpisodesByShowId?: { season?: string; number?: string; timestamps?: any[] }[] }>(
      clientId,
      "query FindEpisodes($showId: ID!) { findEpisodesByShowId(showId: $showId) { season number timestamps { at type { name } } } }",
      { showId },
    );
    const target = data?.findEpisodesByShowId?.find(item => (
      Number(item.number) === episode && (season === null || Number(item.season) === season)
    ));
    const segments = segmentsFromAnimeSkipTimestamps(target?.timestamps ?? []);
    if (segments.length) return segments;
    const legacy = legacyAnimeSkipSegment(target?.timestamps ?? []);
    if (legacy) return [legacy];
  }
  return [];
}

async function loadAnimeSkipSegmentsByTitle(query: StreamQuery, mediaTitle: string): Promise<SkipSegment[]> {
  const clientId = getApiKeys().animeSkipClientId;
  const title = mediaTitle.trim();
  if (!clientId || !title || !query.episode) return [];
  const episodeData = await animeSkipRequest<{ searchEpisodes?: { number?: string; name?: string; timestamps?: any[] }[] }>(
    clientId,
    "query SearchEpisodes($showId: ID, $search: String, $limit: Int) { searchEpisodes(showId: $showId, search: $search, limit: $limit) { id number name timestamps { at type { name } } } }",
    { showId: undefined, search: `${title} ${query.episode}`, limit: 12 },
  );
  const episode = episodeData?.searchEpisodes?.find(item => Number(item.number) === query.episode) ?? episodeData?.searchEpisodes?.[0];
  return segmentsFromAnimeSkipTimestamps(episode?.timestamps ?? []);
}

async function loadAnimeSegments(query: StreamQuery, mediaTitle: string): Promise<SkipSegment[]> {
  if (!query.episode || query.type === "movie") return [];

  if (query.id.startsWith("mal:")) {
    const parts = query.id.split(":");
    const malId = parts[1];
    const episode = Number(parts[2]) || query.episode;
    const aniSkip = malId ? await loadAniSkipSegments(malId, episode).catch(() => []) : [];
    if (aniSkip.length) return aniSkip;
    const arm = malId ? await resolveMalToArmEntry(malId, "anilist").catch(() => null) : null;
    if (arm?.anilist) return loadAnimeSkipSegmentsByAnilist(String(arm.anilist), episode, null);
  }

  if (query.id.startsWith("kitsu:")) {
    const parts = query.id.split(":");
    const kitsuId = parts[1];
    const episode = Number(parts[2]) || query.episode;
    const arm = kitsuId ? await resolveKitsuToArmEntry(kitsuId).catch(() => null) : null;
    if (arm?.myanimelist) {
      const aniSkip = await loadAniSkipSegments(String(arm.myanimelist), episode).catch(() => []);
      if (aniSkip.length) return aniSkip;
    }
    if (arm?.anilist) return loadAnimeSkipSegmentsByAnilist(String(arm.anilist), episode, null);
  }

  const imdbId = await resolveImdbId(query).catch(() => null);
  if (imdbId) {
    const entries = await resolveImdbToArmEntries(imdbId).catch(() => []);
    const seasonEntry = entries[query.season ? query.season - 1 : 0] ?? entries[0];
    if (seasonEntry?.myanimelist) {
      const aniSkip = await loadAniSkipSegments(String(seasonEntry.myanimelist), query.episode).catch(() => []);
      if (aniSkip.length) return aniSkip;
    }
    if (seasonEntry?.anilist) {
      const animeSkip = await loadAnimeSkipSegmentsByAnilist(String(seasonEntry.anilist), query.episode, null).catch(() => []);
      if (animeSkip.length) return animeSkip;
    }
    const fallback = entries[0];
    if (fallback?.anilist && fallback.anilist !== seasonEntry?.anilist) {
      const animeSkip = await loadAnimeSkipSegmentsByAnilist(String(fallback.anilist), query.episode, query.season ?? null).catch(() => []);
      if (animeSkip.length) return animeSkip;
    }
  }

  return loadAnimeSkipSegmentsByTitle(query, mediaTitle).catch(() => []);
}

export function useSkipIntro(query: StreamQuery | null, mediaTitle: string, currentTime: number, options: SkipIntroOptions) {
  const [segments, setSegments] = useState<SkipSegment[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!options.enabled || !query || query.type === "movie") {
        setSegments([]);
        return;
      }
      const cacheKey = `${query.type}|${query.id}|${query.season ?? "-"}|${query.episode ?? "-"}|${mediaTitle}|anime:${options.animeSkipEnabled ? "1" : "0"}`;
      const cached = skipSegmentCache.get(cacheKey);
      if (cached) {
        setSegments(cached);
        return;
      }

      const [introDbSegments, animeSkipSegments] = await Promise.all([
        loadIntroDbSegments(query).catch(() => []),
        options.animeSkipEnabled ? loadAnimeSegments(query, mediaTitle).catch(() => []) : Promise.resolve([]),
      ]);

      if (!cancelled) {
        const byKind = new Map<string, SkipSegment>();
        for (const segment of [...introDbSegments, ...animeSkipSegments]) {
          const previous = byKind.get(segment.kind);
          if (!previous || segment.source === "introdb") byKind.set(segment.kind, segment);
        }
        const nextSegments = Array.from(byKind.values()).sort((a, b) => a.start - b.start);
        skipSegmentCache.set(cacheKey, nextSegments);
        setSegments(nextSegments);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [query, mediaTitle, options.enabled, options.animeSkipEnabled]);

  const activeSegment = useMemo(() => (
    segments.find(segment => currentTime >= Math.max(0, segment.start - 8) && currentTime < segment.end - 0.5) ?? null
  ), [currentTime, segments]);

  return { segments, activeSegment };
}
