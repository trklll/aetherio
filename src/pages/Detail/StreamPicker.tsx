import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Play, RefreshCw, Wifi } from "lucide-react";
import { getTmdbApiKey } from "../../config/apiKeys";
import { getCachedLastLink, saveLastLink, streamCacheKey, usePlaybackPreferences } from "../../config/playbackPreferences";
import { useStreams } from "../../hooks/useStreams";
import { useAddonStore } from "../../store/addonStore";
import { AUTO_NEXT_SOURCE_KEY, IMG, SELECTED_MEDIA_META_KEY, TMDB, getDetailLogoKey, resolveTmdbId } from "../Player/utils";
import type { MediaStream, StreamKind, StreamQuery } from "../../types/stream";
import PageContainer from "../../components/layout/PageContainer";
import { readCachedLogo, sanitizeLogoUrl, writeCachedLogo } from "../../utils/artwork";

interface PickerMeta {
  name: string;
  background?: string;
  poster?: string;
  logo?: string;
}

const SELECTED_STREAM_KEY = "aetherio-selected-stream";
const SELECTED_ENGINE_KEY = "aetherio-selected-engine";
const AUTO_PLAY_PARAM = "autoplay";

interface AutoNextSourceHint {
  addonId?: string;
  addonName?: string;
  name?: string;
  title?: string;
}

function getStreamKind(stream: MediaStream): StreamKind {
  const url = (stream.url ?? stream.externalUrl ?? "").toLowerCase();
  if (stream.infoHash || url.startsWith("magnet:") || url.startsWith("stremio:")) return "p2p";
  if (url.startsWith("http://") || url.startsWith("https://")) return "https";
  if (url) return "external";
  return "unknown";
}

function formatBytes(value?: number) {
  if (!value) return null;
  const gb = value / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(value / 1024 / 1024)} MB`;
}

function buildPlayerSearch(params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const key of ["type", "id", "season", "ep"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
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

export default function StreamPicker() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const playbackPreferences = usePlaybackPreferences();
  const autoSelectedKeyRef = useRef("");
  const [meta, setMeta] = useState<PickerMeta | null>(null);

  const query = useMemo<StreamQuery | null>(() => {
    const type = params.get("type");
    const id = params.get("id");
    if (!type || !id) return null;
    const season = Number(params.get("season"));
    const episode = Number(params.get("ep"));
    return {
      type,
      id,
      season: Number.isFinite(season) && season > 0 ? season : undefined,
      episode: Number.isFinite(episode) && episode > 0 ? episode : undefined,
    };
  }, [params]);

  const { streams, loading, error, reload, streamId } = useStreams(query);
  const autoplayRequested = params.get(AUTO_PLAY_PARAM) === "1";

  useEffect(() => {
    let cancelled = false;
    setMeta(null);

    async function loadMeta() {
      if (!query) return;
      const cachedLogo = readCachedLogo(getDetailLogoKey(query.type, query.id)) ?? undefined;
      let nextMeta: PickerMeta = {
        name: query.id,
        logo: cachedLogo,
      };

      for (const addon of getEnabledAddons()) {
        try {
          if (!addonSupportsMeta(addon, query.type, query.id)) continue;
          const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
          const response = await fetch(`${base}/meta/${query.type}/${query.id}.json`);
          if (!response.ok) continue;
          const json = await response.json();
          const item = json.meta ?? json;
          nextMeta = {
            name: item.name ?? nextMeta.name,
            background: item.background ?? item.backdrop ?? nextMeta.background,
            poster: item.poster ?? nextMeta.poster,
            logo: sanitizeLogoUrl(item.logo) ?? nextMeta.logo,
          };
          break;
        } catch {
          // Keep trying other addons.
        }
      }

      try {
        const tmdbId = await resolveTmdbId(query.type, query.id);
        const tmdbKey = getTmdbApiKey();
        if (tmdbId && tmdbKey) {
          const tmdbType = query.type === "movie" ? "movie" : "tv";
          const [detailsResponse, imagesResponse] = await Promise.all([
            fetch(`${TMDB}/${tmdbType}/${tmdbId}?api_key=${tmdbKey}&language=es-ES`),
            fetch(`${TMDB}/${tmdbType}/${tmdbId}/images?api_key=${tmdbKey}&include_image_language=es,en,null`),
          ]);
          const details = detailsResponse.ok ? await detailsResponse.json() : null;
          const images = imagesResponse.ok ? await imagesResponse.json() : null;
          const logoPath = images?.logos?.find((item: any) => typeof item?.file_path === "string")?.file_path;
          nextMeta = {
            name: nextMeta.name !== query.id ? nextMeta.name : (details?.title ?? details?.name ?? nextMeta.name),
            background: nextMeta.background ?? (details?.backdrop_path ? `${IMG}/w1280${details.backdrop_path}` : undefined),
            poster: nextMeta.poster ?? (details?.poster_path ? `${IMG}/w780${details.poster_path}` : undefined),
            logo: nextMeta.logo ?? (logoPath ? `${IMG}/w500${logoPath}` : undefined),
          };
        }
      } catch {
        // TMDB is fallback-only.
      }

      if (!cancelled) {
        if (nextMeta.logo) nextMeta.logo = writeCachedLogo(getDetailLogoKey(query.type, query.id), nextMeta.logo);
        setMeta(nextMeta);
      }
    }

    loadMeta();
    return () => { cancelled = true; };
  }, [getEnabledAddons, query]);

  function selectStream(stream: MediaStream) {
    if (!query) return;
    saveLastLink(streamCacheKey(query.type, query.id, query.season, query.episode), stream);
    sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(stream));
    sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: meta?.name ?? query.id,
      logo: meta?.logo,
      background: meta?.background ?? meta?.poster,
    }));
    navigate(`/player?${buildPlayerSearch(params)}`);
  }

  useEffect(() => {
    if (!query || !meta || !streamId) return;
    if (playbackPreferences.sourceSelectionMode === "manual") return;

    const autoKey = [
      streamId,
      playbackPreferences.reuseLastLink ? "reuse" : "no-reuse",
      playbackPreferences.lastLinkCacheHours,
      playbackPreferences.sourceSelectionMode,
    ].join(":");
    if (autoSelectedKeyRef.current === autoKey) return;

    const cacheKey = streamCacheKey(query.type, query.id, query.season, query.episode);
    if (playbackPreferences.reuseLastLink) {
      const cached = getCachedLastLink(cacheKey, playbackPreferences.lastLinkCacheHours);
      if (cached) {
        autoSelectedKeyRef.current = autoKey;
        selectStream(cached);
        return;
      }
    }

    if (playbackPreferences.sourceSelectionMode === "first" && !loading && streams[0]) {
      autoSelectedKeyRef.current = autoKey;
      selectStream(streams[0]);
    }
  }, [
    loading,
    meta,
    playbackPreferences.lastLinkCacheHours,
    playbackPreferences.reuseLastLink,
    playbackPreferences.sourceSelectionMode,
    query,
    streamId,
    streams,
  ]);

  useEffect(() => {
    if (!autoplayRequested || !query || loading || streams.length === 0) return;
    const hint = readAutoNextSourceHint();
    const matched = hint ? pickBestMatchingSource(streams, hint) : null;
    const next = matched ?? streams[0];
    if (!next) return;
    sessionStorage.removeItem(AUTO_NEXT_SOURCE_KEY);
    selectStream(next);
  }, [autoplayRequested, loading, query, streams]);

  if (!query) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white/60">
        Faltan datos para cargar fuentes.
      </div>
    );
  }

  const background = meta?.background ?? meta?.poster;
  const episodeLabel = query.season && query.episode ? `Temporada ${query.season}, Episodio ${query.episode}` : "Pelicula";

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {background && (
        <img src={background} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover object-center" />
      )}
      <div className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.48) 46%, rgba(0,0,0,0.76) 100%)" }} />

      <PageContainer fullBleed className="relative z-10 grid min-h-screen grid-cols-[minmax(320px,0.82fr)_minmax(420px,1fr)] gap-10 pb-12 pt-24">
        <section className="flex flex-col justify-end pb-8">
          {meta?.logo ? (
            <img src={meta.logo} alt={meta.name} decoding="async" className="mb-5 max-h-28 max-w-[320px] object-contain drop-shadow-2xl" />
          ) : (
            <h1 className="mb-5 max-w-xl text-5xl font-black leading-none text-white">{meta?.name ?? query.id}</h1>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/64">
            <span className="liquid-glass-pill px-3 py-1">{query.type === "anime" ? "Anime" : query.type === "movie" ? "Film" : "Serie"}</span>
            <span className="liquid-glass-pill px-3 py-1">{episodeLabel}</span>
            <span className="liquid-glass-pill px-3 py-1">Fuentes disponibles</span>
          </div>
        </section>

        <section className="flex min-h-0 flex-col justify-center">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase text-white/42">Fuentes cargadas</p>
              <h2 className="text-2xl font-bold text-white">{loading ? "Buscando reproduccion" : `${streams.length} opciones`}</h2>
            </div>
            <button
              onClick={reload}
              className="liquid-glass flex h-10 w-10 items-center justify-center rounded-md text-white/80 transition hover:text-white"
              title="Recargar fuentes"
            >
              <RefreshCw size={18} />
            </button>
          </div>

          <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-2">
            {loading && [0, 1, 2, 3].map(item => <SourceSkeleton key={item} />)}
            {!loading && error && <p className="liquid-glass rounded-lg p-5 text-sm text-white/70">{error}</p>}
            {!loading && !error && streams.length === 0 && (
              <p className="liquid-glass rounded-lg p-5 text-sm text-white/70">No se encontraron fuentes para este contenido.</p>
            )}
            {!loading && streams.map(stream => (
              <SourceCard key={stream.id} stream={stream} onSelect={() => selectStream(stream)} />
            ))}
          </div>
        </section>
      </PageContainer>
    </div>
  );
}

function readAutoNextSourceHint(): AutoNextSourceHint | null {
  try {
    const raw = sessionStorage.getItem(AUTO_NEXT_SOURCE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AutoNextSourceHint;
  } catch {
    return null;
  }
}

function pickBestMatchingSource(streams: MediaStream[], hint: AutoNextSourceHint) {
  const scored = streams
    .map(stream => ({ stream, score: sourceScore(stream, hint) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score > 0 ? best.stream : null;
}

function sourceScore(stream: MediaStream, hint: AutoNextSourceHint) {
  const normalize = (value?: string) => (value ?? "").trim().toLowerCase();
  const addonId = normalize(hint.addonId);
  const addonName = normalize(hint.addonName);
  const name = normalize(hint.name);
  const title = normalize(hint.title);
  let score = 0;

  if (addonId && normalize(stream.addonId) === addonId) score += 8;
  if (addonName && normalize(stream.addonName) === addonName) score += 4;
  if (name && normalize(stream.name) === name) score += 3;
  if (title) {
    const streamTitle = normalize(stream.title);
    const streamDescription = normalize(stream.description);
    if (streamTitle && streamTitle === title) score += 3;
    if (streamDescription && streamDescription.includes(title)) score += 1;
  }

  return score;
}

function SourceSkeleton() {
  return <div className="skeleton h-24 rounded-lg" />;
}

function SourceCard({ stream, onSelect }: { stream: MediaStream; onSelect: () => void }) {
  const kind = getStreamKind(stream);
  const size = formatBytes(stream.behaviorHints?.videoSize);
  const title = stream.title ?? stream.description ?? stream.name;
  const isDirect = kind === "https";

  return (
    <button
      onClick={onSelect}
      className="liquid-glass group flex w-full items-center gap-4 rounded-lg p-4 text-left transition hover:bg-white/16"
    >
      <span className="min-w-0 flex-1">
        <span className="mb-1 flex items-center gap-2">
          <span className="truncate text-base font-bold text-white">{stream.name}</span>
        </span>
        <span className="line-clamp-2 text-sm leading-relaxed text-white/58">{title}</span>
        <span className="mt-2 flex flex-wrap gap-2 text-xs text-white/44">
          <span>{stream.addonName}</span>
          <span>{kind.toUpperCase()}</span>
          <span>libmpv</span>
          {size && <span>{size}</span>}
          {stream.subtitles?.length ? <span>Subtitulos</span> : null}
        </span>
      </span>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-black opacity-90 transition group-hover:opacity-100">
        {isDirect ? <Play size={20} fill="black" /> : <Wifi size={20} />}
      </span>
    </button>
  );
}
