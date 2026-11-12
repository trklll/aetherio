import { useEffect, useMemo, useState } from "react";
import { tmdbFetch } from "../config/apiKeys.ts";
import { matchesPreferredLanguage, resolvePreferredLanguage, usePlaybackPreferences } from "../config/playbackPreferences.ts";
import { useOriginalLanguage } from "./useOriginalLanguage";
import { useAddonStore, type InstalledAddon } from "../store/addonStore.ts";
import type { MediaStream, StreamQuery } from "../types/stream.ts";
import type { SubtitleSource } from "../types/subtitle.ts";
import { readPageDataCache, writePageDataCache } from "../utils/pageDataCache.ts";

const OPEN_SUBTITLES_PRO_URL = "https://opensubtitles.stremio.homes/ea%7Ces%7Csp/ai-translated=true%7Cfrom=all%7Cauto-adjustment=true/manifest.json";
const OPEN_SUBTITLES_PRO_ADDON: InstalledAddon = {
  id: "community.opensubtitles.stremio.homes",
  name: "OpenSubtitles",
  description: "OpenSubtitles subtitles addon",

  url: OPEN_SUBTITLES_PRO_URL,
  manifest: {
    id: "community.opensubtitles.stremio.homes",
    version: "0.1.0",
    name: "OpenSubtitles",
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

  const tmdbId = query.id.slice(5);
  const tmdbType = query.type === "movie" ? "movie" : "tv";
  const json = await tmdbFetch(`/${tmdbType}/${tmdbId}/external_ids`);
  if (!json) return null;
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

function decodeLanguageCandidate(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed).trim();
  } catch {
    return trimmed;
  }
}

function normalizeLanguageValue(value: string) {
  const lower = value.toLowerCase().replace(/[_\s]+/g, "-");
  if (!lower) return "";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("ru")) return "ru";
  if (lower.startsWith("it")) return "it";
  if (lower.startsWith("pt")) return "pt";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("ja") || lower.startsWith("jp")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("zh") || lower.startsWith("cn")) return "zh";
  return lower;
}

function resolveLanguageFromText(value: unknown) {
  const decoded = decodeLanguageCandidate(value);
  if (!decoded) return "";
  const queryMatch = decoded.match(/(?:^|[?&])(?:lang|lang_code|language)=([a-zA-Z-]{2,12})/i);
  if (queryMatch?.[1]) return normalizeLanguageValue(queryMatch[1]);
  const codeMatch = decoded.match(/\b([a-z]{2,3})(?:-[a-z]{2,4})?\b/i);
  if (codeMatch?.[0]) return normalizeLanguageValue(codeMatch[0]);
  const lowered = decoded.toLowerCase();
  if (/(spanish|espanol|español|castellano|latino)/i.test(lowered)) return "es";
  if (/(english|ingles|inglés)/i.test(lowered)) return "en";
  if (/(russian|ruso)/i.test(lowered)) return "ru";
  if (/(italian|italiano)/i.test(lowered)) return "it";
  if (/(portuguese|portugues|português|brasil)/i.test(lowered)) return "pt";
  if (/(french|frances|francais)/i.test(lowered)) return "fr";
  if (/(german|aleman|alemán|deutsch)/i.test(lowered)) return "de";
  if (/(japanese|japones|japonés|nihongo)/i.test(lowered)) return "ja";
  return "";
}

function resolveSubtitleLanguage(raw: any) {
  const candidates = [
    raw.lang_code,
    raw.iso639_3,
    raw.language,
    raw.lang,
    raw.locale,
    raw.label,
    raw.title,
    raw.name,
  ];
  for (const candidate of candidates) {
    const normalized = resolveLanguageFromText(candidate);
    if (normalized) return normalized;
  }
  if (typeof raw.url === "string") {
    const fromUrl = resolveLanguageFromText(raw.url);
    if (fromUrl) return fromUrl;
    try {
      const parsed = new URL(raw.url);
      for (const key of ["lang", "lang_code", "language"]) {
        const normalized = resolveLanguageFromText(parsed.searchParams.get(key));
        if (normalized) return normalized;
      }
    } catch {
      // ignore invalid subtitle urls
    }
  }
  return "und";
}

function cleanSubtitleLabel(raw: any) {
  const language = resolveSubtitleLanguage(raw);
  const title = decodeLanguageCandidate(raw.label ?? raw.title ?? raw.name);
  if (title && !/lang_code=/i.test(title)) {
    return language && language !== title.toLowerCase() ? `${language} - ${title}` : title;
  }
  const legacy = labelFor(raw);
  if (legacy && !/lang_code=/i.test(legacy)) return legacy;
  return language || "Subtitulos";
}

function labelFor(raw: any) {
  const language = raw.lang ?? raw.language ?? raw.lang_code;
  const title = raw.label ?? raw.title ?? raw.name;
  if (language && title && language !== title) return `${language} - ${title}`;
  return title ?? language ?? "Subtítulos";
}

function normalizeSubtitle(raw: any, addonId: string, addonName: string, index: number): SubtitleSource | null {
  const url = typeof raw.url === "string" ? raw.url : undefined;
  if (!url) return null;
  const lang = resolveSubtitleLanguage(raw);
  return {
    id: [addonId, url, index].join("|"),
    addonId,
    addonName,
    url,
    lang,
    label: `${cleanSubtitleLabel(raw)} - ${addonName}`,
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

async function fetchJsonWithTimeout(url: string, timeoutMs = 2500) {
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

export function useSubtitles(
  query: StreamQuery | null,
  stream?: MediaStream | null,
  forcedSubtitleValue = "",
  disabled = false,
): UseSubtitlesResult {
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const playbackPreferences = usePlaybackPreferences();
  const originalLanguage = useOriginalLanguage(query, stream);
  const [subtitles, setSubtitles] = useState<SubtitleSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const videoId = useMemo(() => query ? buildVideoId(query) : "", [query]);
  const forcedSubtitleUrl = forcedSubtitleValue.startsWith("ext:") ? forcedSubtitleValue.slice(4) : "";

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
      if (disabled) {
        setSubtitles([]);
        setLoading(false);
        setReady(true);
        return;
      }
      if (!query || !videoId) {
        setSubtitles([]);
        setLoading(false);
        setReady(true);
        return;
      }

      setLoading(true);
      setReady(false);
      const addonsFingerprint = subtitleAddons(getEnabledAddons())
        .map(addon => addon.id || addon.url)
        .sort()
        .join("|");
      const cacheKey = [
        query.type,
        videoId,
        stream?.id ?? "",
        subtitleLookup?.videoHash ?? "",
        subtitleLookup?.videoSize ?? "",
        subtitleLookup?.filename ?? "",
        forcedSubtitleUrl,
        playbackPreferences.addonSubtitleLoadMode,
        playbackPreferences.preferredSubtitleLanguage,
        originalLanguage ?? "",
        addonsFingerprint,
      ].join(":");
      const cachedSubtitles = readPageDataCache<SubtitleSource[]>("subtitles", cacheKey);
      if (cachedSubtitles) {
        setSubtitles(cachedSubtitles);
        setLoading(false);
        setReady(true);
        return;
      }
      const loaded: SubtitleSource[] = [];
      const imdbIdPromise = resolveImdbId(query).catch(() => null);
      const requestType = subtitleRequestType(query);

      const addonResults = await Promise.all(subtitleAddons(getEnabledAddons()).map(async addon => {
        const resource = subtitleResourceFor(addon);
        const supportedTypes = resourceTypes(addon, resource);
        if (Array.isArray(supportedTypes) && supportedTypes.length > 0 && !supportedTypes.includes(requestType)) return [] as SubtitleSource[];
        if (!addonHasSubtitles(addon)) return [] as SubtitleSource[];

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
          const immediateIds = buildSubtitleIds(query, null, videoId, allowHashId, videoHash)
            .filter(id => {
              const isHashId = Boolean(videoHash && id === videoHash);
              return addonSupportsSubtitleId(addon, id) || (isOpenSubtitlesPro(addon) && isHashId);
            });
          const effectiveSubtitleLanguage = resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage);
          const normalizeResult = (json: any) => (json?.subtitles ?? [])
            .map((subtitle: any, index: number) => normalizeSubtitle(subtitle, addon.id, addon.name, index))
            .filter(Boolean) as SubtitleSource[];
          const filterPreferred = (items: SubtitleSource[]) => playbackPreferences.addonSubtitleLoadMode === "preferred" && effectiveSubtitleLanguage
            ? items.filter(subtitle => subtitle.url === forcedSubtitleUrl
              || matchesPreferredLanguage(subtitle.lang, effectiveSubtitleLanguage)
              || matchesPreferredLanguage(subtitle.label, effectiveSubtitleLanguage))
            : items;

          // Ask every enabled addon at once and try compatible URL encodings in
          // parallel. The old nested loops serialized addons × IDs × URL forms,
          // so a few slow addons could hold playback/download for minutes.
          const lookupIds = [...immediateIds];
          const immediateResults = await Promise.all(lookupIds.flatMap(id =>
            buildSubtitleTargets(base, requestType, id, extraArgs).map(async target => {
              if (DEBUG_SUBTITLES) console.info("[AETHERIO:SUBTITLES] request", { addon: addon.name, target });
              return fetchJsonWithTimeout(target).catch(() => null);
            }),
          ));
          let found = filterPreferred(immediateResults.flatMap(normalizeResult));

          // Resolve IMDb in parallel with the fast first pass; only wait for it
          // when ID/hash lookups returned no usable tracks.
          if (!found.length && supportsImdb) {
            const imdbId = await imdbIdPromise;
            if (imdbId) {
              const imdbTargets = buildSubtitleTargets(base, requestType, imdbId, extraArgs);
              const imdbResults = await Promise.all(imdbTargets.map(target => fetchJsonWithTimeout(target).catch(() => null)));
              found = filterPreferred(imdbResults.flatMap(normalizeResult));
            }
          }
          return found;
        } catch {
          // Subtitle addons are optional; keep playback moving.
          return [] as SubtitleSource[];
        }
      }));
      loaded.push(...addonResults.flat());

      if (!cancelled) {
        const next = dedupe(loaded);
        writePageDataCache("subtitles", cacheKey, next);
        setSubtitles(prev => {
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
    forcedSubtitleUrl,
    disabled,
    playbackPreferences.addonSubtitleLoadMode,
    playbackPreferences.preferredSubtitleLanguage,
    originalLanguage,
    query?.type,
    query?.id,
    query?.season,
    query?.episode,
    subtitleLookup,
    stream?.id,
    videoId,
  ]);

  return { subtitles, loading, ready };
}
