import { useEffect, useState } from "react";
import { tmdbFetch } from "../config/apiKeys";
import { useAddonStore, type InstalledAddon } from "../store/addonStore";
import type { MediaStream, StreamQuery } from "../types/stream";

export function useOriginalLanguage(query: StreamQuery | null, stream?: MediaStream | null) {
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const [originalLanguage, setOriginalLanguage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!query) {
        setOriginalLanguage(null);
        return;
      }

      const fromStream = extractOriginalLanguage(stream);
      if (fromStream) {
        setOriginalLanguage(fromStream);
        return;
      }

      const tmdbLanguage = await fetchTmdbOriginalLanguage(query).catch(() => null);
      if (cancelled) return;
      if (tmdbLanguage) {
        setOriginalLanguage(tmdbLanguage);
        return;
      }

      const addonLanguage = await fetchAddonOriginalLanguage(query, stream, getEnabledAddons()).catch(() => null);
      if (!cancelled) setOriginalLanguage(addonLanguage);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [getEnabledAddons, query, stream]);

  return originalLanguage;
}

async function fetchTmdbOriginalLanguage(query: StreamQuery) {
  const tmdbId = await resolveTmdbId(query);
  if (!tmdbId) return null;

  const tmdbType = query.type === "movie" ? "movie" : "tv";
  const json = await tmdbFetch(`/${tmdbType}/${tmdbId}`);
  if (!json) return null;
  return extractOriginalLanguage(json);
}

async function resolveTmdbId(query: StreamQuery) {
  if (query.id.startsWith("tmdb:")) return query.id.slice(5);
  if (!query.id.startsWith("tt")) return null;
  const mediaType = query.type === "movie" ? "movie_results" : "tv_results";
  const json = await tmdbFetch(`/find/${query.id}`, { params: { external_source: "imdb_id" } });
  if (!json) return null;
  const id = json[mediaType]?.[0]?.id;
  return id ? String(id) : null;
}

async function fetchAddonOriginalLanguage(query: StreamQuery, stream: MediaStream | null | undefined, addons: InstalledAddon[]) {
  const preferredAddons = stream?.addonId
    ? addons.filter(addon => addon.id === stream.addonId)
    : addons;

  for (const addon of preferredAddons) {
    if (!addonSupportsMeta(addon, query.type, query.id)) continue;
    try {
      const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
      const response = await fetch(`${base}/meta/${query.type}/${encodeURIComponent(query.id)}.json`);
      if (!response.ok) continue;
      const json = await response.json();
      const language = extractOriginalLanguage(json?.meta ?? json);
      if (language) return language;
    } catch {
      // Try the next addon.
    }
  }

  return null;
}

function addonSupportsMeta(addon: any, type: string, id: string) {
  const resources = addon.manifest?.resources ?? [];
  const supportsMeta = resources.some((resource: any) => {
    if (typeof resource === "string") return resource === "meta";
    return resource?.name === "meta";
  });
  if (!supportsMeta && resources.length > 0) return false;

  const types = addon.manifest?.types;
  if (Array.isArray(types) && types.length > 0 && !types.includes(type)) return false;

  const prefixes = addon.manifest?.idPrefixes;
  if (id.startsWith("tmdb:") && (!Array.isArray(prefixes) || !prefixes.includes("tmdb"))) return false;
  if (Array.isArray(prefixes) && prefixes.length > 0 && !prefixes.some((prefix: string) => id.startsWith(prefix))) return false;

  return true;
}

function extractOriginalLanguage(source: unknown) {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  const value =
    record.original_language ??
    record.originalLanguage ??
    record.originalLang ??
    record.language ??
    record.lang;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}
