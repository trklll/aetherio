import { useEffect, useMemo, useState } from "react";
import { getTmdbApiKey } from "../config/apiKeys";
import { matchesPreferredLanguage, resolvePreferredLanguage, usePlaybackPreferences } from "../config/playbackPreferences";
import { useOriginalLanguage } from "./useOriginalLanguage";
import { useAddonStore, type InstalledAddon } from "../store/addonStore";
import type { MediaStream, StreamQuery } from "../types/stream";
import type { SubtitleSource } from "../types/subtitle";

const TMDB = "https://api.themoviedb.org/3";
const OPEN_SUBTITLES_PRO_URL = "https://opensubtitlesv3-pro.dexter21767.com/eyJsYW5ncyI6WyJzcGFuaXNoIiwic3BhbmlzaC1sYSJdLCJzb3VyY2UiOiJhbGwiLCJhaVRyYW5zbGF0ZWQiOnRydWUsImF1dG9BZGp1c3RtZW50Ijp0cnVlfQ==/manifest.json";
const OPEN_SUBTITLES_PRO_ADDON: InstalledAddon = {
  id: "community.opensubtitlesv3.pro",
  name: "opensubtitles PRO",
  description: "ad-free and spam-free subtitles addon",
  logo: "https://i.imgur.com/cGc1DXB.png",
  url: OPEN_SUBTITLES_PRO_URL,
  manifest: {
    id: "community.opensubtitlesv3.pro",
    version: "0.1.0",
    name: "opensubtitles PRO",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt", "kitsu"],
  },
  enabled: true,
  installedAt: 0,
  version: "0.1.0",
};

interface UseSubtitlesResult {
  subtitles: SubtitleSource[];
  loading: boolean;
  ready: boolean;
}

type SubtitleLookup = {
  videoHash?: string;
  videoSize?: number;
  filename?: string;
};

const DEBUG_SUBTITLES = false;

function buildVideoId(query: StreamQuery) {
  if (query.type !== "movie" && query.season && query.episode) {
    return `${query.id}:${query.season}:${query.episode}`;
  }
  return query.id;
}

function subtitleRequestType(query: StreamQuery) {
  if (query.type === "anime" || query.type === "tv") return "series";
  return query.type;
}

async function resolveImdbId(query: StreamQuery) {
  if (query.id.startsWith("tt")) return query.id;
  if (!query.id.startsWith("tmdb:")) return null;
  const tmdbKey = getTmdbApiKey();
  if (!tmdbKey) return null;

  const tmdbId = query.id.slice(5);
  const tmdbType = query.type === "movie" ? "movie" : "tv";
  const response = await fetch(`${TMDB}/${tmdbType}/${tmdbId}/external_ids?api_key=${tmdbKey}`);
  if (!response.ok) return null;

  const json = await response.json();
  return typeof json.imdb_id === "string" && json.imdb_id.startsWith("tt") ? json.imdb_id : null;
}

function buildSubtitleIds(query: StreamQuery, imdbId: string | null, videoId: string, allowHashId: boolean, videoHash?: string) {
  const ids = [
    imdbId && query.type !== "movie" && query.season && query.episode ? `${imdbId}:${query.season}:${query.episode}` : undefined,
    imdbId ?? undefined,
    videoId,
    allowHashId ? videoHash?.trim() : undefined,
  ].filter(Boolean) as string[];

  return Array.from(new Set(ids));
}

function addonSupportsSubtitleId(addon: any, id: string) {
  const prefixes = addon.manifest?.idPrefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0) return true;
  return prefixes.some((prefix: string) => id.startsWith(prefix));
}

function addonHasSubtitles(addon: any) {
  return (addon.manifest?.resources ?? []).some((resource: any) => {
    if (typeof resource === "string") return resource === "subtitles";
    return resource?.name === "subtitles";
  });
}

function labelFor(raw: any) {
  const language = raw.lang ?? raw.language ?? raw.lang_code;
  const title = raw.label ?? raw.title ?? raw.name;
  if (language && title && language !== title) return `${language} - ${title}`;
  return title ?? language ?? "Subtitulos";
}

function normalizeSubtitle(raw: any, addonId: string, addonName: string, index: number): SubtitleSource | null {
  const url = typeof raw.url === "string" ? raw.url : undefined;
  if (!url) return null;
  const lang = raw.lang_code ?? raw.iso639_3 ?? raw.language ?? raw.lang ?? "und";
  return {
    id: [addonId, url, index].join("|"),
    addonId,
    addonName,
    url,
    lang,
    label: `${labelFor(raw)} - ${addonName}`,
    format: raw.format,
  };
}

function dedupe(items: SubtitleSource[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function buildSubtitleTargets(base: string, requestType: string, id: string, extraArgs: URLSearchParams) {
  const encodedId = encodeURIComponent(id);
  const extra = extraArgs.toString();
  const targets = [`${base}/subtitles/${requestType}/${encodedId}.json`];
  if (extra) {
    targets.unshift(`${base}/subtitles/${requestType}/${encodedId}/${extra}.json`);
    targets.push(`${base}/subtitles/${requestType}/${encodedId}.json?${extra}`);
  }
  return targets;
}

function subtitleResourceFor(addon: any) {
  return (addon.manifest?.resources ?? []).find((item: any) => (
    typeof item === "object" && item?.name === "subtitles"
  ));
}

function resourceTypes(addon: any, resource: any) {
  const types = resource?.types ?? addon.manifest?.types;
  return Array.isArray(types) ? types : [];
}

function resourceIdPrefixes(addon: any, resource: any) {
  const prefixes = resource?.idPrefixes ?? addon.manifest?.idPrefixes;
  return Array.isArray(prefixes) ? prefixes : [];
}

function subtitleAddons(addons: InstalledAddon[]) {
  const byKey = new Map<string, InstalledAddon>();
  for (const addon of addons) {
    byKey.set(addon.id || addon.url, addon);
  }
  if (!Array.from(byKey.values()).some(addon => addon.id === OPEN_SUBTITLES_PRO_ADDON.id || addon.url === OPEN_SUBTITLES_PRO_URL)) {
    byKey.set(OPEN_SUBTITLES_PRO_ADDON.id, OPEN_SUBTITLES_PRO_ADDON);
  }
  return Array.from(byKey.values());
}

function isOpenSubtitlesPro(addon: InstalledAddon) {
  return addon.id === OPEN_SUBTITLES_PRO_ADDON.id || addon.url === OPEN_SUBTITLES_PRO_URL;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

export function useSubtitles(query: StreamQuery | null, stream?: MediaStream | null): UseSubtitlesResult {
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const playbackPreferences = usePlaybackPreferences();
  const originalLanguage = useOriginalLanguage(query, stream);
  const [subtitles, setSubtitles] = useState<SubtitleSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const videoId = useMemo(() => query ? buildVideoId(query) : "", [query]);

  const subtitleLookup = useMemo<SubtitleLookup | null>(() => {
    if (!stream?.behaviorHints) return null;

    const bh = stream.behaviorHints as SubtitleLookup;
    return {
      videoHash: bh.videoHash ?? "",
      videoSize: bh.videoSize,
      filename: bh.filename,
    };
  }, [
    stream?.behaviorHints?.videoHash,
    stream?.behaviorHints?.videoSize,
    stream?.behaviorHints?.filename,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!query || !videoId) {
        setSubtitles([]);
        setLoading(false);
        setReady(true);
        return;
      }

      setLoading(true);
      setReady(false);
      const loaded: SubtitleSource[] = [];
      const imdbId = await resolveImdbId(query).catch(() => null);
      const requestType = subtitleRequestType(query);

      for (const addon of subtitleAddons(getEnabledAddons())) {
        const resource = subtitleResourceFor(addon);
        const supportedTypes = resourceTypes(addon, resource);
        if (Array.isArray(supportedTypes) && supportedTypes.length > 0 && !supportedTypes.includes(requestType)) continue;
        if (!addonHasSubtitles(addon)) continue;

        try {
          const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
          const extraArgs = new URLSearchParams();
          const videoHash = subtitleLookup?.videoHash?.trim();

          extraArgs.set("videoID", videoId);
          if (subtitleLookup?.videoSize) {
            const size = String(subtitleLookup.videoSize);
            extraArgs.set("videoSize", size);
            extraArgs.set("moviebytesize", size);
          }
          if (subtitleLookup?.filename) extraArgs.set("filename", subtitleLookup.filename);
          if (videoHash) {
            extraArgs.set("videoHash", videoHash);
            extraArgs.set("movieHash", videoHash);
          }

          const idPrefixes = resourceIdPrefixes(addon, resource);
          const hasStrictPrefixes = idPrefixes.length > 0;
          const supportsImdb = !hasStrictPrefixes || idPrefixes.includes("tt");
          const allowHashId = !hasStrictPrefixes || isOpenSubtitlesPro(addon);
          const idsToTry = buildSubtitleIds(query, supportsImdb ? imdbId : null, videoId, allowHashId, videoHash)
            .filter(id => {
              const isHashId = Boolean(videoHash && id === videoHash);
              return addonSupportsSubtitleId(addon, id) || (isOpenSubtitlesPro(addon) && isHashId);
            });

          let addonFound = false;
          for (const id of idsToTry) {
            for (const target of buildSubtitleTargets(base, requestType, id, extraArgs)) {
              if (DEBUG_SUBTITLES) console.info("[AETHERIO:SUBTITLES] request", { addon: addon.name, target });
              const json = await fetchJsonWithTimeout(target).catch(() => null);
              if (!json) continue;

              const normalized = (json.subtitles ?? [])
                .map((subtitle: any, index: number) => normalizeSubtitle(subtitle, addon.id, addon.name, index))
                .filter(Boolean) as SubtitleSource[];
              const effectiveSubtitleLanguage = resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage);
              const filtered = playbackPreferences.addonSubtitleLoadMode === "preferred" && effectiveSubtitleLanguage
                ? normalized.filter(subtitle =>
                  matchesPreferredLanguage(subtitle.lang, effectiveSubtitleLanguage) ||
                  matchesPreferredLanguage(subtitle.label, effectiveSubtitleLanguage)
                )
                : normalized;
              loaded.push(...filtered);
              if (filtered.length > 0) {
                if (DEBUG_SUBTITLES) console.info("[AETHERIO:SUBTITLES] loaded", { addon: addon.name, count: filtered.length, target });
                addonFound = true;
                break;
              }
            }
            if (addonFound) break;
          }
        } catch {
          // Subtitle addons are optional; keep playback moving.
        }
      }

      if (!cancelled) {
        setSubtitles(prev => {
          const next = dedupe(loaded);
          if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
          return next;
        });
        setLoading(false);
        setReady(true);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [
    getEnabledAddons,
    playbackPreferences.addonSubtitleLoadMode,
    playbackPreferences.preferredSubtitleLanguage,
    originalLanguage,
    query?.type,
    query?.id,
    query?.season,
    query?.episode,
    subtitleLookup,
    videoId,
  ]);

  return { subtitles, loading, ready };
}
