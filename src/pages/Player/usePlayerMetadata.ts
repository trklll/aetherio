import { useEffect, useState } from "react";
import { tmdbFetch } from "../../config/apiKeys";
import { useAddonStore } from "../../store/addonStore";
import type { MediaStream, StreamQuery } from "../../types/stream";
import { readCachedLogo, sanitizeLogoUrl } from "../../utils/artwork";
import type { EpisodeOption } from "./types";
import { IMG, getDetailLogoKey, resolveTmdbId } from "./utils";

export function useEpisodeMetadata(query: StreamQuery | null) {
  const [episodeOptions, setEpisodeOptions] = useState<EpisodeOption[]>([]);
  const [seriesLogoUrl, setSeriesLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!query?.season || !query.episode || query.type === "movie") {
      setEpisodeOptions([]);
      setSeriesLogoUrl(null);
      return;
    }
    let cancelled = false;

    const loadEpisodes = async () => {
      try {
        const tmdbId = await resolveTmdbId(query.type, query.id);
        if (!tmdbId) return;
        const [seasonJson, detailsJson] = await Promise.all([
          tmdbFetch<any>(`/tv/${tmdbId}/season/${query.season}`, { params: { language: "es-ES" } }),
          tmdbFetch<any>(`/tv/${tmdbId}`, { params: { language: "es-ES", append_to_response: "images", include_image_language: "es,null,en" } }),
        ]);
        if (!seasonJson) return;
        if (cancelled) return;

        const logos = detailsJson?.images?.logos ?? [];
        const logoPath = logos.find((item: any) => typeof item?.file_path === "string")?.file_path;
        setSeriesLogoUrl(logoPath ? `${IMG}/original${logoPath}` : null);

        setEpisodeOptions((seasonJson.episodes ?? []).map((episode: any) => ({
          id: `${tmdbId}:${query.season}:${episode.episode_number}`,
          episode: episode.episode_number,
          season: query.season!,
          name: episode.name ?? `Episodio ${episode.episode_number}`,
          overview: typeof episode.overview === "string" ? episode.overview : undefined,
          airDate: episode.air_date,
          still: episode.still_path ? `${IMG}/original${episode.still_path}` : undefined,
        })));
      } catch {
        if (!cancelled) {
          setEpisodeOptions([]);
          setSeriesLogoUrl(null);
        }
      }
    };

    void loadEpisodes();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return { episodeOptions, seriesLogoUrl };
}

export function usePlayerLogos(query: StreamQuery | null, stream: MediaStream | null) {
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const [addonLogoUrl, setAddonLogoUrl] = useState<string | null>(null);
  const [detailLogoUrl, setDetailLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAddonLogo = async () => {
      if (!query || !stream?.addonId || query.id.startsWith("mal:")) {
        setAddonLogoUrl(null);
        return;
      }

      const addon = getEnabledAddons().find(item => item.id === stream.addonId);
      if (!addon) {
        setAddonLogoUrl(null);
        return;
      }

      const supportsMeta = (addon.manifest?.resources ?? []).some((resource: any) => {
        if (typeof resource === "string") return resource === "meta";
        return resource?.name === "meta";
      });
      if (!supportsMeta) {
        setAddonLogoUrl(null);
        return;
      }
      const types = addon.manifest?.types;
      if (Array.isArray(types) && types.length > 0 && !types.includes(query.type)) {
        setAddonLogoUrl(null);
        return;
      }
      const idPrefixes = addon.manifest?.idPrefixes;
      if (query.id.startsWith("tmdb:") && (!Array.isArray(idPrefixes) || !idPrefixes.includes("tmdb"))) {
        setAddonLogoUrl(null);
        return;
      }
      if (Array.isArray(idPrefixes) && idPrefixes.length > 0 && !idPrefixes.some((prefix: string) => query.id.startsWith(prefix))) {
        setAddonLogoUrl(null);
        return;
      }

      try {
        const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
        const metaUrl = `${base}/meta/${query.type}/${query.id}.json`;
        const response = await fetch(metaUrl);
        if (!response.ok) {
          if (!cancelled) setAddonLogoUrl(null);
          return;
        }

        const json = await response.json();
        if (cancelled) return;

        setAddonLogoUrl(sanitizeLogoUrl(json?.meta?.logo) ?? null);
      } catch {
        if (!cancelled) setAddonLogoUrl(null);
      }
    };

    setDetailLogoUrl(query ? readCachedLogo(getDetailLogoKey(query.type, query.id)) : null);
    void loadAddonLogo();

    return () => {
      cancelled = true;
    };
  }, [getEnabledAddons, query, stream?.addonId]);

  return { addonLogoUrl, detailLogoUrl };
}
