import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AudioLines, Captions, Check, ChevronDown, Film, Play, RefreshCw, X } from "lucide-react";
import { tmdbFetch } from "../../config/apiKeys";
import { useHomePreferences } from "../../config/homePreferences";
import { useMdbListSettings, type MdbListRatings } from "../../config/mdblist";
import {
  getCachedLastLink,
  LANGUAGE_OPTIONS,
  saveLastLink,
  streamCacheKey,
  usePlaybackPreferences,
} from "../../config/playbackPreferences";
import { useOriginalLanguage } from "../../hooks/useOriginalLanguage";
import { useSubtitles } from "../../hooks/useSubtitles";
import { useStreams } from "../../hooks/useStreams";
import { useScrapedStreams } from "../../hooks/useScrapedStreams";
import { isPlayableMediaStream } from "../../utils/playableMedia";
import { sortStreamsSpanishFirst } from "../../utils/streamLanguagePriority";
import { useAddonStore } from "../../store/addonStore";
import type { MediaStream, StreamQuery } from "../../types/stream";
import type { SubtitleSource } from "../../types/subtitle";
import PageContainer from "../../components/layout/PageContainer";
import MDBListRatingsRow from "../../components/ratings/MDBListRatingsRow";
import ContextMenu from "../../components/ui/ContextMenu";
import { fetchMdbListRatingsForMedia } from "../../services/MDBListService";
import { readCachedLogo, sanitizeLogoUrl, writeCachedLogo } from "../../utils/artwork";
import { pickPreferredTmdbBackdrop, sortTmdbBackdropsByPreference } from "../../utils/tmdbArtwork";
import {
  buildContinueWatchingKey,
  getExactResumeForQuery,
  markEpisodeAsWatched,
  readPlaybackStateEntries,
  removeContinueWatchingEntry,
} from "../../utils/continueWatching";
import { readDetailMediaMeta, readDetailBackgroundOverride } from "../../utils/mediaMetadata";
import { tweenTo } from "../../utils/motion";
import { getStreamFormatBadges, type StreamFormatBadge } from "../../utils/streamFormatters";
import { syncTraktMarkedUnwatched, syncTraktMarkedWatched, syncTraktRemovePlayback } from "../../trakt";
import {
  AUTO_NEXT_SOURCE_KEY,
  IMG,
  SELECTED_ENGINE_KEY,
  SELECTED_MEDIA_META_KEY,
  SELECTED_PLAYBACK_OVERRIDES_KEY,
  SELECTED_STREAM_KEY,
  getDetailLogoKey,
  playbackOverrideQueryKey,
  resolveTmdbId,
} from "../Player/utils";

interface EpisodePageMeta {
  name: string;
  background?: string;
  poster?: string;
  logo?: string;
  alternateImages?: string[];
  episodeImages?: string[];
  description?: string;
  genres?: string[];
  director?: string;
  writer?: string;
  episodeTitle?: string;
  episodeOriginalTitle?: string;
  episodeOverview?: string;
  episodeStill?: string;
  runtime?: number;
  airDate?: string;
  mdbListRatings?: MdbListRatings;
  voteAverage?: number;
}

interface AutoNextSourceHint {
  addonId?: string;
  addonName?: string;
  name?: string;
  title?: string;
}

type SelectOption = {
  value: string;
  label: string;
};

type LanguageMention = {
  code: string;
  label: string;
};

const AUTO_PLAY_PARAM = "autoplay";
const CONTINUE_PLAY_PARAM = "continue";
const FROM_PLAYER_PARAM = "fromPlayer";
const AUTO_OPTION = "auto";
const NO_SUBTITLES_OPTION = "none";

function numberValue(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : undefined;
}

export default function EpisodiePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const getEnabledAddons = useAddonStore(s => s.getEnabledAddons);
  const playbackPreferences = usePlaybackPreferences();
  const mdbListSettings = useMdbListSettings();
  const fullMdbListSettings = useMemo(() => ({
    ...mdbListSettings,
    showTrakt: true,
    showImdb: true,
    showTmdb: true,
    showLetterboxd: true,
    showTomatoes: true,
    showMetacritic: true,
  }), [mdbListSettings]);
  const { allowTmdbArtworkFallback } = useHomePreferences();
  const autoSelectedKeyRef = useRef("");
  const [meta, setMeta] = useState<EpisodePageMeta | null>(null);
  const [metaReady, setMetaReady] = useState(false);
  const [selectedStreamId, setSelectedStreamId] = useState("");
  const [audioChoice, setAudioChoice] = useState(AUTO_OPTION);
  const [subtitleChoice, setSubtitleChoice] = useState(AUTO_OPTION);
  const [openMenu, setOpenMenu] = useState<"audio" | "subtitle" | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [watchedVersion, setWatchedVersion] = useState(0);
  const [heroStillIndex, setHeroStillIndex] = useState(0);
  const [playerTransitioning, setPlayerTransitioning] = useState(false);
  const playerTransitionTimerRef = useRef<number | null>(null);

  const query = useMemo<StreamQuery | null>(() => {
    const type = params.get("type");
    const id = params.get("id");
    if (!type || !id) return null;
    const season = Number(params.get("season"));
    const episode = Number(params.get("ep"));
    return {
      type,
      id,
      season: Number.isFinite(season) && season >= 0 ? season : undefined,
      episode: Number.isFinite(episode) && episode > 0 ? episode : undefined,
    };
  }, [params]);

  const { streams, loading, error, reload, streamId } = useStreams(query);
  const { streams: scrapedStreams, loading: scrapedLoading, error: scrapedError } = useScrapedStreams(query, meta?.name);
  const allStreams = useMemo(
    () => sortStreamsSpanishFirst([...streams, ...scrapedStreams].filter(isPlayableMediaStream)),
    [streams, scrapedStreams],
  );
  const selectedStream = useMemo(
    () => allStreams.find(stream => stream.id === selectedStreamId) ?? allStreams[0] ?? null,
    [selectedStreamId, allStreams],
  );
  const originalLanguage = useOriginalLanguage(query, selectedStream);
  const autoplayRequested = params.get(AUTO_PLAY_PARAM) === "1";
  const continueRequested = params.get(CONTINUE_PLAY_PARAM) === "1";
  const returnedFromPlayer = params.get(FROM_PLAYER_PARAM) === "1";
  const episodeTitleParam = params.get("epTitle")?.trim() ?? "";
  const { subtitles: addonSubtitles } = useSubtitles(query, selectedStream, subtitleChoice);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setMetaReady(false);

    async function loadMeta() {
      if (!query) return;
      const resume = getExactResumeForQuery(query);
      const cached = readDetailMediaMeta(query.type, query.id);
      const backgroundOverride = readDetailBackgroundOverride(query.type, query.id);
      const lockedBackground = ensureOriginalTmdbImage(backgroundOverride);
      const cachedLogo = readCachedLogo(getDetailLogoKey(query.type, query.id)) ?? undefined;
      const shouldUseTmdbArtwork = allowTmdbArtworkFallback || query.id.startsWith("tmdb:");
      let nextMeta: EpisodePageMeta = {
        name: cached?.name ?? resume?.name ?? query.id,
        background: lockedBackground ?? ensureOriginalTmdbImage(cached?.background) ?? resume?.background,
        poster: cached?.poster ?? resume?.poster,
        logo: sanitizeLogoUrl(cached?.logo) ?? cachedLogo ?? resume?.logo,
        mdbListRatings: cached?.mdbListRatings,
        description: cached?.description,
        episodeTitle: episodeTitleParam,
        episodeStill: resume?.episodeStill,
        episodeOverview: resume?.episodeName === episodeTitleParam ? undefined : resume?.episodeName,
      };

      for (const addon of getEnabledAddons()) {
        try {
          const base = addon.url.replace(/\/manifest\.json$/, "").replace(/\/$/, "");
          let item: any | null = null;
          let addonEpisode: any | null = null;
          for (const metaType of metaTypeCandidates(query.type)) {
            if (!addonSupportsMeta(addon, metaType, query.id)) continue;
            const response = await fetch(`${base}/meta/${metaType}/${encodeURIComponent(query.id)}.json`);
            if (!response.ok) continue;
            const json = await response.json();
            item = json.meta ?? json;
            addonEpisode = findAddonEpisode(item, query);
            break;
          }
          if (!item) continue;
          const addonAlternateImages = collectArtworkCandidates(
            item.screenshots,
            item.stills,
            item.sceneStills,
            item.videoStills,
          );
          const addonEpisodeImages = collectArtworkCandidates(
            addonEpisode?.screenshots,
            addonEpisode?.stills,
            addonEpisode?.sceneStills,
            addonEpisode?.videoStills,
            addonEpisode?.images,
            addonEpisode?.backgrounds,
            addonEpisode?.backdrops,
            addonEpisode?.thumbnail,
            addonEpisode?.still,
            addonEpisode?.background,
            addonEpisode?.poster,
          );
          nextMeta = {
            ...nextMeta,
            name: item.name ?? nextMeta.name,
            background: lockedBackground
              ? nextMeta.background
              : ensureOriginalTmdbImage(pickArtwork(item.background, item.backdrop)) ?? nextMeta.background,
            poster: pickArtwork(item.poster) ?? nextMeta.poster,
            logo: sanitizeLogoUrl(item.logo) ?? nextMeta.logo,
            alternateImages: uniqueArtwork([...(nextMeta.alternateImages ?? []), ...addonAlternateImages]),
            description: item.description ?? item.overview ?? nextMeta.description,
            genres: normalizeList(item.genres ?? item.genre) ?? nextMeta.genres,
            director: normalizeCredit(item.director) ?? nextMeta.director,
            writer: normalizeCredit(item.writer) ?? normalizeCredit(item.writers) ?? nextMeta.writer,
            episodeTitle: addonEpisode?.title ?? addonEpisode?.name ?? nextMeta.episodeTitle,
            episodeOriginalTitle: addonEpisode?.originalTitle ?? addonEpisode?.original_name ?? nextMeta.episodeOriginalTitle,
            episodeOverview: addonEpisode?.overview ?? addonEpisode?.description ?? nextMeta.episodeOverview,
            episodeStill: ensureOriginalTmdbImage(pickArtwork(addonEpisode?.thumbnail, addonEpisode?.still, addonEpisode?.background, addonEpisode?.poster)) ?? nextMeta.episodeStill,
            episodeImages: uniqueArtwork([...(nextMeta.episodeImages ?? []), ...addonEpisodeImages]),
            runtime: runtimeMinutes(addonEpisode?.runtime ?? addonEpisode?.duration) ?? nextMeta.runtime,
            airDate: addonEpisode?.released ?? addonEpisode?.air_date ?? nextMeta.airDate,
          };
          break;
        } catch {
          // Keep trying other addons.
        }
      }

      try {
        const tmdbId = await resolveTmdbId(query.type, query.id);
        if (tmdbId) {
          const tmdbType = query.type === "movie" ? "movie" : "tv";
          const [details, images, episode, episodeImages] = await Promise.all([
            tmdbFetch(`/${tmdbType}/${tmdbId}`, { params: { language: "es-ES", append_to_response: "external_ids" } }),
            tmdbFetch(`/${tmdbType}/${tmdbId}/images`, { params: { include_image_language: "es,en,null" } }),
            query.type !== "movie" && typeof query.season === "number" && query.episode
              ? tmdbFetch(`/tv/${tmdbId}/season/${query.season}/episode/${query.episode}`, { params: { language: "es-ES" } })
              : Promise.resolve(null),
            query.type !== "movie" && typeof query.season === "number" && query.episode
              ? tmdbFetch(`/tv/${tmdbId}/season/${query.season}/episode/${query.episode}/images`)
              : Promise.resolve(null),
          ]);
          const logoPath = pickTmdbLogo(images?.logos);
          const tmdbBackdrops = mapTmdbScreenshotBackdrops(images?.backdrops);
          const preferredBackdrop = pickPreferredTmdbBackdrop(images?.backdrops, details?.backdrop_path);
          const mdbListRatings = await fetchMdbListRatingsForMedia({
            settings: fullMdbListSettings,
            mediaType: query.type,
            mediaId: `tmdb:${tmdbId}`,
            imdbId: details?.external_ids?.imdb_id ?? details?.imdb_id,
          }).catch(() => null);
          nextMeta = {
            ...nextMeta,
            name: nextMeta.name !== query.id ? nextMeta.name : (details?.title ?? details?.name ?? nextMeta.name),
            background: shouldUseTmdbArtwork && !backgroundOverride && preferredBackdrop && (!nextMeta.background || isTmdbImageUrl(nextMeta.background))
              ? preferredBackdrop
              : nextMeta.background,
            poster: nextMeta.poster ?? (shouldUseTmdbArtwork && details?.poster_path ? `${IMG}/w780${details.poster_path}` : undefined),
            logo: nextMeta.logo ?? (shouldUseTmdbArtwork && logoPath ? `${IMG}/w500${logoPath}` : undefined),
            alternateImages: uniqueArtwork([...(nextMeta.alternateImages ?? []), ...tmdbBackdrops]),
            description: nextMeta.description ?? details?.overview,
            genres: nextMeta.genres ?? normalizeList((details?.genres ?? []).map((genre: any) => genre?.name).filter(Boolean)),
            runtime: nextMeta.runtime ?? runtimeMinutes(details?.runtime),
            airDate: nextMeta.airDate ?? (details?.release_date ?? details?.first_air_date),
            mdbListRatings: mdbListRatings ?? nextMeta.mdbListRatings,
            voteAverage: numberValue(details?.vote_average) ?? nextMeta.voteAverage,
          };

          if (query.type === "movie") {
            nextMeta = {
              ...nextMeta,
              episodeStill: pickRandomArtwork(nextMeta.alternateImages, [
                nextMeta.background,
                details?.backdrop_path ? `${IMG}/original${details.backdrop_path}` : undefined,
              ]) ?? nextMeta.episodeStill,
            };
          }

          if (episode) {
            nextMeta = {
              ...nextMeta,
              episodeTitle: nextMeta.episodeTitle || episode.name,
              episodeOverview: episode.overview || nextMeta.episodeOverview,
              episodeStill: episode.still_path ? `${IMG}/original${episode.still_path}` : nextMeta.episodeStill,
              episodeImages: uniqueArtwork([
                ...(nextMeta.episodeImages ?? []),
                ...mapTmdbEpisodeStills(episodeImages?.stills),
              ]),
              runtime: runtimeMinutes(episode.runtime) ?? nextMeta.runtime,
              airDate: episode.air_date ?? nextMeta.airDate,
              voteAverage: numberValue(episode.vote_average) ?? nextMeta.voteAverage,
              director: nextMeta.director ?? pickCrew(episode.crew, "Director"),
              writer: nextMeta.writer ?? pickCrew(episode.crew, "Writer") ?? pickCrew(episode.crew, "Screenplay"),
            };
          }
        }
      } catch {
        // TMDB is fallback-only.
      }

      if (!nextMeta.mdbListRatings) {
        const fallbackRatings = await fetchMdbListRatingsForMedia({
          settings: fullMdbListSettings,
          mediaType: query.type,
          mediaId: query.id,
          imdbId: query.id.startsWith("tt") ? query.id : undefined,
        }).catch(() => null);
        if (fallbackRatings) {
          nextMeta = {
            ...nextMeta,
            mdbListRatings: fallbackRatings,
          };
        }
      }

      if (lockedBackground) {
        nextMeta = {
          ...nextMeta,
          background: lockedBackground,
        };
      }

      if (!cancelled) {
        if (nextMeta.logo) nextMeta.logo = writeCachedLogo(getDetailLogoKey(query.type, query.id), nextMeta.logo) ?? nextMeta.logo;
        setMeta(nextMeta);
        setMetaReady(true);
      }
    }

    void loadMeta();
    return () => { cancelled = true; };
  }, [allowTmdbArtworkFallback, episodeTitleParam, fullMdbListSettings, getEnabledAddons, query]);

  useEffect(() => {
    if (!query?.type || !query?.id) return;
    const detailParams = new URLSearchParams({ fromStreams: "1" });
    if (params.get("fromSearch") === "1") {
      detailParams.set("fromSearch", "1");
      const searchQuery = params.get("q");
      if (searchQuery) detailParams.set("q", searchQuery);
    }
    const detailPath = `/detail/${encodeURIComponent(query.type)}/${encodeURIComponent(query.id)}?${detailParams.toString()}`;
    window.history.pushState({ aetherioEpisodeBackGuard: true }, "");

    const onPopState = () => {
      navigate(detailPath, { replace: true });
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate, query?.id, query?.type]);

  useEffect(() => {
    if (!allStreams.length) {
      setSelectedStreamId("");
      return;
    }
    setSelectedStreamId(current => {
      if (current && allStreams.some(stream => stream.id === current)) return current;
      return pickDefaultStream(allStreams, query, playbackPreferences, continueRequested, autoplayRequested, originalLanguage)?.id ?? allStreams[0].id;
    });
  }, [
    autoplayRequested,
    continueRequested,
    originalLanguage,
    playbackPreferences.lastLinkCacheHours,
    playbackPreferences.preferredSubtitleLanguage,
    playbackPreferences.reuseLastLink,
    query,
    allStreams,
  ]);

  useEffect(() => {
    if (!query || returnedFromPlayer || loading || scrapedLoading || !metaReady || !allStreams.length) return;
    const cached = getPreferredCachedStream(query, playbackPreferences);
    const nextStream = pickDefaultStream(allStreams, query, playbackPreferences, continueRequested, autoplayRequested, originalLanguage);
    const shouldAutoPlay = continueRequested
      ? playbackPreferences.reuseLastLink && Boolean(nextStream)
      : autoplayRequested
        || playbackPreferences.sourceSelectionMode === "first"
        || Boolean(playbackPreferences.sourceSelectionMode === "manual" && cached);
    if (!shouldAutoPlay) return;

    if (!nextStream) return;
    const autoKey = [
      streamId || `${query.type}:${query.id}:${query.season ?? ""}:${query.episode ?? ""}`,
      autoplayRequested ? "autoplay" : continueRequested ? "continue" : playbackPreferences.sourceSelectionMode,
      nextStream.id,
    ].join(":");
    if (autoSelectedKeyRef.current === autoKey) return;
    autoSelectedKeyRef.current = autoKey;
    playStream(nextStream, { replace: true, transition: false });
  }, [
    autoplayRequested,
    continueRequested,
    loading,
    scrapedLoading,
    metaReady,
    originalLanguage,
    playbackPreferences.lastLinkCacheHours,
    playbackPreferences.preferredSubtitleLanguage,
    playbackPreferences.reuseLastLink,
    playbackPreferences.sourceSelectionMode,
    query,
    returnedFromPlayer,
    streamId,
    allStreams,
  ]);

  useEffect(() => () => {
    if (playerTransitionTimerRef.current !== null) {
      window.clearTimeout(playerTransitionTimerRef.current);
      playerTransitionTimerRef.current = null;
    }
  }, []);

  const allSubtitles = useMemo(
    () => buildSubtitleOptions(selectedStream, addonSubtitles),
    [addonSubtitles, selectedStream],
  );
  const legacyAudioCodes = useMemo(() => extractStreamAudioLanguages(selectedStream), [selectedStream]);
  const streamAudioMentions = useMemo(() => extractStreamAudioMentions(selectedStream), [selectedStream]);
  const subtitleMentions = useMemo(() => extractSubtitleMentions(allSubtitles), [allSubtitles]);
  const autoAudioLabel = useMemo(
    () => resolveAutoLanguageLabel(
      streamAudioMentions,
      playbackPreferences.firstAudioLanguage,
      originalLanguage,
      legacyAudioCodes[0] ? formatLanguageChoice(legacyAudioCodes[0], originalLanguage) : undefined,
    ),
    [legacyAudioCodes, originalLanguage, playbackPreferences.firstAudioLanguage, streamAudioMentions],
  );
  const autoSubtitleLabel = useMemo(
    () => resolveAutoLanguageLabel(subtitleMentions, playbackPreferences.preferredSubtitleLanguage, originalLanguage),
    [originalLanguage, playbackPreferences.preferredSubtitleLanguage, subtitleMentions],
  );
  const audioOptions = useMemo<SelectOption[]>(() => [
    {
      value: AUTO_OPTION,
      label: `Auto - ${autoAudioLabel}`,
    },
    ...streamAudioMentions.map(item => ({
      value: item.code,
      label: item.label,
    })),
  ], [autoAudioLabel, streamAudioMentions]);
  const subtitleOptions = useMemo<SelectOption[]>(() => [
    {
      value: AUTO_OPTION,
      label: `Auto - ${autoSubtitleLabel}`,
    },
    { value: NO_SUBTITLES_OPTION, label: "Sin subtitulos" },
    ...allSubtitles.map(subtitle => ({ value: `ext:${subtitle.url}`, label: subtitle.label })),
  ], [allSubtitles, autoSubtitleLabel]);
  const preferredAudioAvailable = useMemo(() => {
    if (!selectedStream) return false;
    return streamSupportsPreferredAudio(selectedStream, playbackPreferences.firstAudioLanguage, originalLanguage);
  }, [originalLanguage, playbackPreferences.firstAudioLanguage, selectedStream]);
  const preferredSubtitleAvailable = useMemo(() => {
    if (subtitleOptions.length <= 2) return false;
    if (!playbackPreferences.preferredSubtitleLanguage) return true;
    const preferred = normalizeLanguageToken(resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage));
    return subtitleOptions.some(option => option.value.startsWith("ext:") && normalizeLanguageToken(option.label).includes(preferred));
  }, [originalLanguage, playbackPreferences.preferredSubtitleLanguage, subtitleOptions]);
  const watchedEntry = useMemo(() => {
    if (!query) return null;
    const key = buildContinueWatchingKey(query);
    return readPlaybackStateEntries().find(entry => entry.key === key && entry.completed) ?? null;
  }, [query, watchedVersion]);
  const heroStillKey = useMemo(() => {
    const backgroundKey = artworkKey(ensureOriginalTmdbImage(meta?.background));
    if (query?.type === "movie") {
      return uniqueArtwork([meta?.episodeStill, ...(meta?.alternateImages ?? [])])
        .filter(value => artworkKey(value) !== backgroundKey)
        .slice(0, 8)
        .join("|");
    }
    return uniqueArtwork([meta?.episodeStill, ...(meta?.episodeImages ?? [])])
      .filter(value => artworkKey(value) !== backgroundKey)
      .slice(0, 8)
      .join("|");
  }, [meta?.alternateImages, meta?.background, meta?.episodeImages, meta?.episodeStill, query?.type]);
  const heroStills = useMemo(() => heroStillKey ? heroStillKey.split("|").filter(Boolean) : [], [heroStillKey]);
  const detailReturnParams = useMemo(() => {
    const next = new URLSearchParams({ fromStreams: "1" });
    if (params.get("fromSearch") === "1") {
      next.set("fromSearch", "1");
      const searchQuery = params.get("q");
      if (searchQuery) next.set("q", searchQuery);
    }
    return next.toString();
  }, [params]);

  useEffect(() => {
    setHeroStillIndex(0);
  }, [heroStillKey]);

  useEffect(() => {
    if (heroStills.length <= 1) return;
    const timer = window.setInterval(() => {
      setHeroStillIndex(index => (index + 1) % heroStills.length);
    }, 6200);
    return () => window.clearInterval(timer);
  }, [heroStills.length]);

  useEffect(() => {
    if (subtitleChoice === AUTO_OPTION || subtitleChoice === NO_SUBTITLES_OPTION) return;
    if (subtitleOptions.some(option => option.value === subtitleChoice)) return;
    setSubtitleChoice(AUTO_OPTION);
  }, [subtitleChoice, subtitleOptions]);

  if (!query) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white/60">
        Faltan datos para cargar el episodio.
      </div>
    );
  }

  if (!metaReady || !meta) {
    return <div className="skeleton min-h-screen w-full bg-[#1f1f1f]" />;
  }

  const episodeTitle = meta?.episodeTitle || episodeTitleParam || (query.type === "movie" ? meta?.name : `Episodio ${query.episode ?? 1}`);
  const mainTitle = meta?.name ?? query.id;
  const heroStill = heroStills[heroStillIndex % Math.max(heroStills.length, 1)]
    ?? ensureOriginalTmdbImage(meta?.episodeStill)
    ?? ensureOriginalTmdbImage(meta?.poster)
    ?? ensureOriginalTmdbImage(meta?.background);
  const background = ensureOriginalTmdbImage(meta?.background) ?? meta?.poster;
  const description = meta?.episodeOverview || meta?.description || "Selecciona la fuente, audio y subtitulos antes de reproducir.";
  const sourceSummary = selectedStream ? formatSourceSummary(selectedStream) : (loading || scrapedLoading) ? "Buscando fuentes..." : "Sin fuente seleccionada";
  const showEpisodeHeading = query.type !== "movie";
  const detailPath = `/detail/${encodeURIComponent(query.type)}/${encodeURIComponent(query.id)}?${detailReturnParams}`;

  function playStream(stream: MediaStream, options?: { replace?: boolean; transition?: boolean }) {
    if (!query) return;
    const resume = getExactResumeForQuery(query);
    const playbackBackground = ensureOriginalTmdbImage(meta?.background)
      ?? meta?.poster
      ?? ensureOriginalTmdbImage(resume?.background)
      ?? resume?.poster;
    const playbackSelection = resolvePlaybackSelections({
      audioChoice,
      subtitleChoice,
      audioOptions,
      subtitleOptions,
      subtitles: allSubtitles,
      preferredAudio: playbackPreferences.firstAudioLanguage,
      preferredAudioFallback: playbackPreferences.secondAudioLanguage,
      preferredSubtitle: playbackPreferences.preferredSubtitleLanguage,
      preferredSubtitleFallback: playbackPreferences.secondSubtitleLanguage,
      originalLanguage,
    });
    saveLastLink(streamCacheKey(query.type, query.id, query.season, query.episode), stream);
    writePlaybackOverrides(query, playbackSelection);
    sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(stream));
    sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: mainTitle,
      logo: meta?.logo ?? resume?.logo,
      background: playbackBackground,
      poster: meta?.poster ?? resume?.poster,
      resumeKey: resume?.key,
      resumeTime: resume?.currentTime,
    }));
    const to = `/player?${buildPlayerSearch(params)}`;
    if (options?.transition === false) {
      navigate(to, { replace: options?.replace ?? false });
      return;
    }

    setPlayerTransitioning(true);
    if (playerTransitionTimerRef.current !== null) window.clearTimeout(playerTransitionTimerRef.current);
    playerTransitionTimerRef.current = window.setTimeout(() => {
      navigate(to, { replace: options?.replace ?? false });
    }, 620);
  }

  function markCurrentWatched() {
    if (!query) return;
    if (watchedEntry) {
      const removed = removeContinueWatchingEntry(watchedEntry.key);
      setWatchedVersion(version => version + 1);
      void syncTraktMarkedUnwatched(removed ?? watchedEntry);
      void syncTraktRemovePlayback(removed ?? watchedEntry);
      return;
    }
    const marked = markEpisodeAsWatched({
      query,
      name: mainTitle,
      episodeName: episodeTitle,
      runtimeSeconds: (meta?.runtime ?? 0) * 60,
      logo: sanitizeLogoUrl(meta?.logo),
      background: ensureOriginalTmdbImage(meta?.background),
      poster: meta?.poster,
      episodeStill: ensureOriginalTmdbImage(meta?.episodeStill),
    });
    setWatchedVersion(version => version + 1);
    void syncTraktMarkedWatched(marked);
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#111111] text-white">
      <div className="pick-streams-background absolute left-0 top-0 overflow-hidden" aria-hidden="true">
        {background ? (
          <img
            src={background}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-top opacity-50 grayscale"
          />
        ) : null}
        <div className="absolute inset-0 bg-black/62" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b0b0c]/76 via-[#171719]/78 to-[#1f1f1f]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_0%,rgba(0,0,0,0)_42%)]" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#1f1f1f] via-[#1f1f1f]/82 to-transparent" />
      </div>

      {playerTransitioning ? (
        <div className="aetherio-player-handoff fixed inset-0 z-[9999] overflow-hidden bg-[#080808]">
          {background ? (
            <img
              src={background}
              alt=""
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover object-center grayscale"
            />
          ) : null}
          <div className="absolute inset-0 bg-black/66" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/70 to-black/92" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/18">
              <div className="aetherio-player-handoff-bar h-full w-1/2 rounded-full bg-white/92" />
            </div>
          </div>
        </div>
      ) : null}

      <PageContainer fullBleed className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1680px] flex-col pb-9 pt-[88px]">
        <section className="episode-page-layout grid min-h-[calc(100vh-160px)] grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(380px,0.94fr)_minmax(460px,1.06fr)]">
          <div className="episode-hero-main flex min-w-0 flex-col justify-end pb-1">
            <div className="episode-media-card liquid-glass-dark relative mb-8 aspect-video w-full max-w-[560px] overflow-hidden rounded-2xl border-white/[0.08]">
              {heroStills.length > 1 ? (
                heroStills.map((still, index) => {
                  const active = index === heroStillIndex % heroStills.length;
                  return <EpisodeHeroStill key={still} src={still} alt={mainTitle} active={active} />;
                })
              ) : heroStill ? (
                <img src={heroStill} alt={episodeTitle} decoding="async" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/42">
                  <Film size={40} />
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/46 via-transparent to-white/[0.04]" />
            </div>

            <div className="episode-hero-copy max-w-[760px] pl-1">
              {meta?.logo ? (
                <button
                  type="button"
                  onClick={() => navigate(detailPath)}
                  className="mb-5 rounded-md bg-transparent p-0 text-left gsap-transition hover:opacity-90"
                  aria-label="Ir al detalle"
                  title="Ir al detalle"
                >
                  <img src={meta.logo} alt={mainTitle} decoding="async" className="max-h-[96px] max-w-[360px] object-contain drop-shadow-[0_10px_34px_rgba(0,0,0,0.72)]" />
                </button>
              ) : (
                <h1 className="mb-5 text-[clamp(2.75rem,5vw,5rem)] font-light uppercase leading-none tracking-normal text-white">
                  {mainTitle}
                </h1>
              )}

              {showEpisodeHeading ? (
                <h2 className="max-w-[760px] text-xl font-extrabold text-white/84">
                  {episodeTitle}
                </h2>
              ) : null}
              {showEpisodeHeading && meta?.episodeOriginalTitle ? (
                <p className="mt-2 text-sm font-semibold text-white/48">{meta.episodeOriginalTitle}</p>
              ) : null}

              <div className={`episode-metadata ${showEpisodeHeading ? "mt-4" : "mt-1"} flex flex-wrap items-center gap-4 text-sm font-bold text-white/70`}>
                {meta?.airDate ? <span>{formatDate(meta.airDate)}</span> : null}
                {meta?.runtime ? <span>{formatRuntime(meta.runtime)}</span> : null}
                {meta?.mdbListRatings ? (
                  <MDBListRatingsRow ratings={meta.mdbListRatings} compact />
                ) : null}
                {meta?.runtime ? <span>Termina a {formatEndTime(meta.runtime)}</span> : null}
              </div>

              <div className="episode-actions mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={!selectedStream || loading}
                  onClick={() => selectedStream && playStream(selectedStream)}
                  className="inline-flex h-12 min-w-[156px] items-center justify-center gap-3 rounded-full bg-white px-7 text-base font-extrabold text-black shadow-[0_14px_38px_rgba(0,0,0,0.38)] gsap-transition hover:bg-white/92 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Play size={18} fill="black" />
                  Reproducir
                </button>
                <IconGhostButton label={watchedEntry ? "Quitar visto" : "Marcar como visto"} active={Boolean(watchedEntry)} onClick={markCurrentWatched}>
                  {watchedEntry ? <X size={21} /> : <Check size={21} />}
                </IconGhostButton>
                <IconGhostButton label="Recargar fuentes" onClick={reload}><RefreshCw size={20} /></IconGhostButton>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-5 self-end">
            <div className="liquid-glass rounded-2xl p-5">
              <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-4 py-1.5" data-menu-id="source">
                <span className="flex items-center justify-center text-white/76" title="Fuente">
                  <Film size={22} />
                </span>
                <button
                  type="button"
                  disabled={allStreams.length === 0}
                  onClick={() => setSourcePickerOpen(true)}
                  className="flex h-10 min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.075] bg-white/[0.08] px-3 text-left text-sm font-semibold text-white/80 gsap-transition hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45"
                  aria-haspopup="dialog"
                  aria-expanded={sourcePickerOpen}
                >
                  <span className="min-w-0 truncate">
                    {selectedStream ? formatSourceOption(selectedStream) : loading ? "Buscando fuentes..." : "Sin fuentes disponibles"}
                  </span>
                </button>
              </div>
              <GlassSelector
                id="audio"
                icon={<AudioLines size={22} />}
                label="Audio"
                valueLabel={audioOptions.find(option => option.value === audioChoice)?.label ?? "Auto"}
                open={openMenu === "audio"}
                onToggle={() => setOpenMenu(current => current === "audio" ? null : "audio")}
                onClose={() => setOpenMenu(null)}
                items={audioOptions.map(option => ({
                  label: option.label,
                  selected: option.value === audioChoice,
                  onSelect: () => setAudioChoice(option.value),
                })).concat(
                  preferredAudioAvailable || !playbackPreferences.firstAudioLanguage
                    ? []
                    : [{ label: "No hay fuente con audio preferido", selected: false, onSelect: () => undefined }],
                )}
              />
              <GlassSelector
                id="subtitle"
                icon={<Captions size={22} />}
                label="Subtitulos"
                valueLabel={subtitleOptions.find(option => option.value === subtitleChoice)?.label ?? "Auto"}
                open={openMenu === "subtitle"}
                disabled={false}
                onToggle={() => setOpenMenu(current => current === "subtitle" ? null : "subtitle")}
                onClose={() => setOpenMenu(null)}
                items={subtitleOptions.map(option => ({
                  label: option.label,
                  selected: option.value === subtitleChoice,
                  onSelect: () => setSubtitleChoice(option.value),
                })).concat(
                  preferredSubtitleAvailable || !playbackPreferences.preferredSubtitleLanguage
                    ? []
                    : [{ label: "No hay subtitulos preferidos disponibles", selected: false, onSelect: () => undefined }],
                )}
              />
              {error || scrapedError ? <p className="mt-3 rounded-xl border border-white/[0.08] bg-black/24 px-4 py-3 text-sm font-semibold text-white/58">{error ?? scrapedError}</p> : null}
              <p className="mt-4 line-clamp-2 pl-[46px] text-sm font-semibold text-white/50">{sourceSummary}</p>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
              <div className="liquid-glass rounded-2xl p-6">
                <p className="text-base font-normal leading-relaxed text-white/66">{description}</p>
              </div>
              <div className="liquid-glass overflow-hidden rounded-2xl">
                <InfoRow label="Géneros" value={meta?.genres?.join(", ") || "Animacion, Accion, Aventura"} />
                <InfoRow label="Dirección" value={meta?.director || "-"} />
                <InfoRow label="Guión" value={meta?.writer || "-"} />
              </div>
            </div>
          </div>
        </section>
      </PageContainer>
      <SourcePickerPopup
        open={sourcePickerOpen}
        title="Seleccionar fuente"
        loading={(loading || scrapedLoading) && allStreams.length === 0}
        streams={allStreams}
        selectedStreamId={selectedStreamId}
        onSelect={streamId => {
          setSelectedStreamId(streamId);
          setSourcePickerOpen(false);
        }}
        onClose={() => setSourcePickerOpen(false)}
      />
    </div>
  );
}

function EpisodeHeroStill({ src, alt, active }: { src: string; alt: string; active: boolean }) {
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    tweenTo(imageRef.current, { opacity: active ? 1 : 0 }, 0.9);
    tweenTo(imageRef.current, { scale: active ? 1.035 : 1 }, 3.1);
  }, [active]);

  return (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
      style={{ opacity: 0, transform: "scale(1)" }}
    />
  );
}

function writePlaybackOverrides(query: StreamQuery, selection: ReturnType<typeof resolvePlaybackSelections>) {
  const override: Record<string, unknown> = {
    queryKey: playbackOverrideQueryKey(query),
    selectedAudio: selection.selectedAudio,
    selectedAudioLanguage: selection.selectedAudioLanguage,
    selectedAudioLabel: selection.selectedAudioLabel,
    forceSubtitleSelection: true,
    selectedSubtitle: selection.selectedSubtitle,
    selectedSubtitleLanguage: selection.selectedSubtitleLanguage,
    selectedSubtitleLabel: selection.selectedSubtitleLabel,
  };
  sessionStorage.setItem(SELECTED_PLAYBACK_OVERRIDES_KEY, JSON.stringify(override));
}

function resolvePlaybackSelections({
  audioChoice,
  subtitleChoice,
  audioOptions,
  subtitleOptions,
  subtitles,
  preferredAudio,
  preferredAudioFallback,
  preferredSubtitle,
  preferredSubtitleFallback,
  originalLanguage,
}: {
  audioChoice: string;
  subtitleChoice: string;
  audioOptions: SelectOption[];
  subtitleOptions: SelectOption[];
  subtitles: SubtitleSource[];
  preferredAudio: string;
  preferredAudioFallback: string;
  preferredSubtitle: string;
  preferredSubtitleFallback: string;
  originalLanguage: string | null;
}) {
  const audioCandidates = audioOptions.filter(option => option.value !== AUTO_OPTION && option.value !== NO_SUBTITLES_OPTION);
  const subtitleCandidates = subtitleOptions.filter(option => option.value !== AUTO_OPTION);
  const resolvedAudio = audioChoice === AUTO_OPTION
    ? pickLanguageOption(audioCandidates, [preferredAudio, preferredAudioFallback], originalLanguage)
    : audioOptions.find(option => option.value === audioChoice) ?? null;
  const resolvedSubtitle = subtitleChoice === AUTO_OPTION
    ? pickLanguageOption(subtitleCandidates, [preferredSubtitle, preferredSubtitleFallback], originalLanguage)
    : subtitleOptions.find(option => option.value === subtitleChoice) ?? null;
  const subtitleValue = resolvedSubtitle?.value === NO_SUBTITLES_OPTION ? "" : (resolvedSubtitle?.value ?? "");
  const subtitleMeta = subtitleValue.startsWith("ext:")
    ? subtitles.find(item => `ext:${item.url}` === subtitleValue)
    : null;

  return {
    selectedAudio: resolvedAudio?.value ?? "",
    selectedAudioLanguage: normalizeLanguageToken(resolvedAudio?.label),
    selectedAudioLabel: resolvedAudio?.label ?? "",
    selectedSubtitle: subtitleValue,
    selectedSubtitleLanguage: subtitleMeta?.lang ?? normalizeLanguageToken(resolvedSubtitle?.label),
    selectedSubtitleLabel: resolvedSubtitle?.label ?? "",
  };
}

function IconGhostButton({
  children,
  label,
  onClick,
  active = false,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full border gsap-transition ${
        active
          ? "border-white/[0.14] bg-white/[0.16] text-white"
          : "border-white/[0.07] bg-white/[0.06] text-white/82 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[116px_minmax(0,1fr)] border-b border-white/[0.08] px-4 py-3 last:border-b-0">
      <span className="text-sm font-extrabold text-white/72">{label}</span>
      <span className="min-w-0 text-right text-sm font-semibold text-white/54">{value}</span>
    </div>
  );
}

function GlassSelector({
  id,
  icon,
  label,
  valueLabel,
  items,
  open,
  onToggle,
  onClose,
  disabled = false,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  valueLabel: string;
  items: Array<{ label: string; selected: boolean; onSelect: () => void }>;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-4 py-1.5" data-menu-id={id}>
      <span className="flex items-center justify-center text-white/76" title={label}>{icon}</span>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex h-10 min-w-0 items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm font-semibold gsap-transition ${
          open
            ? "border-white/[0.18] bg-white/[0.16] text-white"
            : "border-white/[0.075] bg-white/[0.08] text-white/80 hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{valueLabel}</span>
        <ChevronDown size={16} className="shrink-0 text-white/54" />
      </button>
      <ContextMenu
        open={open && !disabled}
        anchorRef={buttonRef}
        onClose={onClose}
        width={360}
        maxHeight={320}
        placement="below-start"
        items={items.map(item => ({
          label: item.label,
          icon: item.selected ? <Check size={14} /> : undefined,
          onSelect: item.onSelect,
        }))}
      />
    </div>
  );
}

function SourcePickerPopup({
  open,
  title,
  loading,
  streams,
  selectedStreamId,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  loading: boolean;
  streams: MediaStream[];
  selectedStreamId: string;
  onSelect: (streamId: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="aetherio-popup-backdrop fixed inset-0 z-[90] flex items-center justify-center bg-black/88 px-4 backdrop-blur-xl"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="aetherio-popup-card liquid-glass max-h-[80vh] w-full max-w-[980px] overflow-hidden rounded-3xl border border-white/[0.18] bg-[#040509ee]"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <p className="text-base font-bold text-white/90">{title}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-white/78 gsap-transition hover:bg-white/[0.12] hover:text-white"
            aria-label="Cerrar selector de fuentes"
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[calc(80vh-68px)] overflow-y-auto p-3">
          {loading ? (
            <p className="px-3 py-2 text-sm font-semibold text-white/62">Buscando fuentes...</p>
          ) : streams.length === 0 ? (
            <p className="px-3 py-2 text-sm font-semibold text-white/58">Sin fuentes disponibles.</p>
          ) : (
            <div className="grid gap-2">
              {streams.map(stream => {
                const selected = stream.id === selectedStreamId;
                const formatBadges = getStreamFormatBadges(stream);
                const languageMetadata = formatStreamLanguageMetadata(stream);
                return (
                  <button
                    key={stream.id}
                    type="button"
                    onClick={() => onSelect(stream.id)}
                    className={`rounded-2xl border px-4 py-3 text-left gsap-transition ${
                      selected
                        ? "border-white/[0.24] bg-white/[0.22] text-white"
                        : "border-white/[0.1] bg-black/60 text-white/86 hover:bg-black/72"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="line-clamp-2 break-words text-[16px] font-bold leading-6 text-white [overflow-wrap:anywhere]">
                          {extractSourceFileName(stream)}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold text-white/54">
                          {formatSourceSummary(stream)}
                        </p>
                        <p className="mt-2 break-words text-[13px] font-semibold leading-5 text-white/76 [overflow-wrap:anywhere]">
                          {formatSourceCardMetadata(stream)}
                        </p>
                        {languageMetadata ? (
                          <p className="mt-1 break-words text-[13px] font-semibold leading-5 text-white/76 [overflow-wrap:anywhere]">
                            {languageMetadata}
                          </p>
                        ) : null}
                        {formatBadges.length ? <StreamFormatBadges badges={formatBadges} /> : null}
                      </div>
                      {selected ? <Check size={16} className="mt-0.5 shrink-0 text-white" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StreamFormatBadges({ badges }: { badges: StreamFormatBadge[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Formatos detectados">
      {badges.map(badge => (
        <span
          key={badge.id}
          title={badge.label}
          aria-label={badge.label}
          className="flex h-7 min-w-[42px] max-w-[104px] items-center justify-center overflow-hidden rounded-lg border border-white/[0.09] bg-black/48 px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        >
          <img
            src={badge.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className={badge.overscan
              ? "h-[74px] w-[108px] max-w-none shrink-0 object-contain"
              : "max-h-[18px] max-w-[88px] object-contain"
            }
          />
        </span>
      ))}
    </div>
  );
}

function buildPlayerSearch(params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const key of ["type", "id", "season", "ep", "fromSearch", "q"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next.toString();
}

function pickDefaultStream(
  streams: MediaStream[],
  query: StreamQuery | null,
  playbackPreferences: ReturnType<typeof usePlaybackPreferences>,
  continueRequested: boolean,
  autoplayRequested: boolean,
  originalLanguage: string | null,
) {
  if (!query || streams.length === 0) return null;
  if (autoplayRequested) {
    const hint = readAutoNextSourceHint();
    const matched = hint ? pickBestMatchingSource(streams, hint) : null;
    if (matched) return matched;
  }
  if (continueRequested) {
    if (!playbackPreferences.reuseLastLink) return null;
    const resume = getExactResumeForQuery(query);
    const preferred = resume ? pickStreamByResume(streams, resume.streamId) : null;
    if (preferred) return preferred;
    return getPreferredCachedStream(query, playbackPreferences);
  }
  const cached = getPreferredCachedStream(query, playbackPreferences);
  if (cached) return cached;
  return pickStreamByPreferences(
    streams,
    playbackPreferences.firstAudioLanguage,
    playbackPreferences.preferredSubtitleLanguage,
    originalLanguage,
  ) ?? streams[0] ?? null;
}

function pickStreamByPreferences(
  streams: MediaStream[],
  preferredAudio: string,
  preferredSubtitle: string,
  originalLanguage: string | null,
) {
  if (!streams.length) return null;
  const preferredSubtitleNorm = normalizeLanguageToken(resolvePreferredLanguage(preferredSubtitle, originalLanguage));
  const scored = streams
    .map(stream => {
      let score = 0;
      if (streamSupportsPreferredAudio(stream, preferredAudio, originalLanguage)) score += 6;
      if (!preferredSubtitleNorm) score += 2;
      else if ((stream.subtitles ?? []).some(item => normalizeLanguageToken(item.lang ?? item.language).includes(preferredSubtitleNorm))) score += 2;
      return { stream, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.stream ?? null;
}

function getPreferredCachedStream(query: StreamQuery, playbackPreferences: ReturnType<typeof usePlaybackPreferences>) {
  if (!playbackPreferences.reuseLastLink) return null;
  return getCachedLastLink(
    streamCacheKey(query.type, query.id, query.season, query.episode),
    playbackPreferences.lastLinkCacheHours,
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

function pickStreamByResume(streams: MediaStream[], resumeStreamId?: string) {
  if (!resumeStreamId) return null;
  const byId = streams.find(stream => stream.id === resumeStreamId);
  if (byId) return byId;
  const resumeParts = resumeStreamId.split("|");
  const resumeUrl = (resumeParts[1] ?? "").trim().toLowerCase();
  if (!resumeUrl) return null;
  return streams.find(stream => (stream.url ?? "").trim().toLowerCase() === resumeUrl) ?? null;
}

function buildSubtitleOptions(stream: MediaStream | null, addonSubtitles: SubtitleSource[]) {
  const embedded = (stream?.subtitles ?? [])
    .filter(item => item.url)
    .map((item, index): SubtitleSource => ({
      id: `stream-${index}-${item.url}`,
      addonId: stream?.addonId ?? "stream",
      addonName: stream?.addonName ?? "Stream",
      url: item.url!,
      lang: item.lang ?? item.language ?? "und",
      label: item.title ?? item.lang ?? item.language ?? "Subtitulos del stream",
    }));
  const seen = new Set<string>();
  const merged = [...embedded, ...addonSubtitles];
  return merged.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function extractStreamAudioLanguages(stream: MediaStream | null) {
  return extractStreamAudioMentions(stream).map(item => item.code);
}

function extractStreamAudioMentions(stream: MediaStream | null) {
  if (!stream) return [];
  const sourceText = [
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
  ].filter(Boolean).join(" ");
  return dedupeLanguageMentions(extractLanguageMentionsFromText(sourceText));
}

function extractSubtitleMentions(subtitles: SubtitleSource[]) {
  const mentions: LanguageMention[] = [];
  for (const subtitle of subtitles) {
    mentions.push(...extractLanguageMentionsFromText(`${subtitle.lang ?? ""} ${subtitle.label ?? ""}`));
  }
  return dedupeLanguageMentions(mentions);
}

function resolveAutoLanguageLabel(
  mentions: LanguageMention[],
  preferredLanguage: string,
  originalLanguage: string | null,
  fallbackLabel?: string,
) {
  if (!mentions.length) return fallbackLabel ?? formatLanguageChoice(preferredLanguage, originalLanguage);
  const preferred = normalizeLanguageToken(resolvePreferredLanguage(preferredLanguage, originalLanguage));
  if (!preferred) return mentions[0].label;
  const aliases = audioLanguageAliases(preferred);
  const matched = mentions.find(item => {
    const token = normalizeLanguageToken(`${item.code} ${item.label}`);
    return aliases.some(alias => token.includes(normalizeLanguageToken(alias)));
  });
  return (matched ?? mentions[0]).label;
}

function dedupeLanguageMentions(mentions: LanguageMention[]) {
  const seen = new Set<string>();
  const deduped: LanguageMention[] = [];
  for (const mention of mentions) {
    const code = normalizeLanguageToken(mention.code);
    const label = mention.label.trim();
    if (!code || !label) continue;
    const key = `${code}:${normalizeLanguageToken(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ code, label });
  }
  return deduped;
}

function extractLanguageMentionsFromText(value: string) {
  if (!value.trim()) return [] as LanguageMention[];
  const patterns: Array<{ code: string; regex: RegExp }> = [
    { code: "es", regex: /\b(spanish|español|espanol|castellano|latino|spa|esp|es)\b/gi },
    { code: "en", regex: /\b(english|ingles|inglés|eng|en)\b/gi },
    { code: "ja", regex: /\b(japanese|japones|japonés|jpn|ja|jp)\b/gi },
    { code: "pt", regex: /\b(portuguese|portugues|português|por|pt|pt-br)\b/gi },
    { code: "fr", regex: /\b(french|frances|français|fra|fr)\b/gi },
    { code: "de", regex: /\b(german|aleman|alemán|deu|ger|de)\b/gi },
    { code: "it", regex: /\b(italian|italiano|ita|it)\b/gi },
    { code: "ru", regex: /\b(russian|ruso|rus|ru)\b/gi },
    { code: "ko", regex: /\b(korean|coreano|kor|ko)\b/gi },
    { code: "zh", regex: /\b(chinese|chino|zho|zh)\b/gi },
  ];
  const hits: Array<LanguageMention & { index: number }> = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(value)) !== null) {
      const raw = match[0] ?? "";
      const label = raw.length <= 3 ? raw.toUpperCase() : raw;
      hits.push({ code: pattern.code, label, index: match.index });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.map(({ code, label }) => ({ code, label }));
}

function formatSourceOption(stream: MediaStream) {
  const fileName = extractSourceFileName(stream);
  const mbps = extractSourceMbps(stream);
  const size = extractSourceSize(stream);
  const sourceName = stream.addonId.startsWith("nuvio-provider:")
    ? [stream.addonName, stream.name].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ")
    : stream.addonId === "scraper"
      ? [stream.addonName, fileName].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ")
      : fileName;
  return [sourceName, mbps, size].filter(Boolean).join(" - ");
}

function formatSourceSummary(stream: MediaStream) {
  const provider = stream.addonId.startsWith("nuvio-provider:") && stream.name !== stream.addonName
    ? ` · ${stream.name}`
    : "";
  return `Presentado por ${stream.addonName}${provider}`;
}

function formatSourceCardMetadata(stream: MediaStream) {
  const hints = stream.behaviorHints ?? {};
  const detected = extractRenderedStreamMetadata(stream);
  const size = firstPositiveNumber(stream.size, hints.videoSize, hints.size, detected.size);
  const folderSize = firstPositiveNumber(stream.folderSize, hints.folderSize, detected.folderSize);
  const indexer = firstNonEmptyText(stream.indexer, hints.indexer, detected.indexer);
  const duration = firstPositiveNumber(stream.duration, hints.duration, detected.duration);
  const sections = [`Size: ${size ? formatBytes10(size) : "—"}${folderSize ? ` / ${formatBytes10(folderSize)}` : ""}`];
  if (indexer) sections.push(`Source: ${indexer}`);
  if (duration) sections.push(`Duration: ${formatDuration(duration)}`);
  return sections.join(" | ");
}

function formatStreamLanguageMetadata(stream: MediaStream) {
  const languages = uniqueTextValues(stream.languages ?? []);
  const subtitles = uniqueTextValues((stream.subtitles ?? []).map(subtitle =>
    subtitle.language ?? subtitle.lang ?? subtitle.title,
  ));
  const sections: string[] = [];
  if (languages.length) sections.push(`Languages: ${languages.join(", ")}`);
  if (subtitles.length) sections.push(`Subtitles: ${subtitles.join(", ")}`);
  return sections.join(" | ");
}

function uniqueTextValues(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map(value => value.trim())
    .filter((value, index, items) => items.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index);
}

function extractSourceFileName(stream: MediaStream) {
  const filename = stream.behaviorHints?.filename?.trim();
  if (filename) return filename;
  const fromTitle = (stream.title ?? stream.name).trim();
  return fromTitle || stream.name;
}

function extractSourceMbps(stream: MediaStream) {
  const source = [stream.name, stream.title, stream.description, stream.behaviorHints?.filename]
    .filter(Boolean)
    .join(" ");
  const match = source.match(/(\d+(?:[.,]\d+)?)\s*mbps/i);
  if (!match) return "";
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value.toFixed(value < 10 ? 1 : 0)} Mbps`;
}

function extractSourceSize(stream: MediaStream) {
  const bytes = Number(stream.size ?? stream.behaviorHints?.videoSize ?? 0);
  if (Number.isFinite(bytes) && bytes > 0) {
    return formatBytes10(bytes);
  }
  const source = [stream.name, stream.title, stream.description, stream.behaviorHints?.filename]
    .filter(Boolean)
    .join(" ");
  const match = source.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb)\b/i);
  if (!match) return "";
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${value.toFixed(value < 10 ? 2 : 1)} ${match[2].toUpperCase()}`;
}

function extractRenderedStreamMetadata(stream: MediaStream) {
  const text = [stream.name, stream.title, stream.description, stream.behaviorHints?.filename]
    .filter(Boolean)
    .join(" | ");
  const byteValues: number[] = [];
  for (const match of text.matchAll(/(?:📦\s*)?(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|kb)\b/gi)) {
    const value = Number(match[1].replace(",", "."));
    const bytes = value * ({ tb: 1e12, gb: 1e9, mb: 1e6, kb: 1e3 }[match[2].toLowerCase()] ?? 1);
    if (Number.isFinite(bytes) && bytes > 0 && !byteValues.some(item => Math.abs(item - bytes) < 1)) byteValues.push(bytes);
  }
  const indexer = text.match(/(?:source|indexer|📡|⚙️?)\s*:?\s*([^|\n·]+)/i)?.[1]?.trim();
  const durationText = text.match(/(?:duration|⏱️)\s*:?\s*(\d{1,2}:\d{2}(?::\d{2})?|\d+\s*h(?:\s*\d+\s*m)?|\d+\s*m(?:\s*\d+\s*s)?|\d+\s*s|\d+)/i)?.[1];
  return {
    size: byteValues[0],
    folderSize: byteValues[1],
    indexer,
    duration: parseDuration(durationText),
  };
}

function firstPositiveNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function formatBytes10(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  const value = bytes / (1000 ** Math.max(0, unitIndex));
  const maximumFractionDigits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value)} ${units[Math.max(0, unitIndex)]}`;
}

function formatDuration(durationSeconds: number) {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : "", !hours && !minutes ? `${seconds}s` : ""]
    .filter(Boolean)
    .join(" ");
}

function parseDuration(value?: string) {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(normalized)) {
    const parts = normalized.split(":").map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  const hours = Number(normalized.match(/(\d+)\s*h/)?.[1] ?? 0);
  const minutes = Number(normalized.match(/(\d+)\s*m/)?.[1] ?? 0);
  const seconds = Number(normalized.match(/(\d+)\s*s/)?.[1] ?? 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total > 0) return total;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function formatLanguageChoice(value: string, originalLanguage: string | null) {
  if (!value) return "Sin preferencia";
  if (value === "original") return originalLanguage ? `Original (${originalLanguage.toUpperCase()})` : "Original";
  return LANGUAGE_OPTIONS.find(option => option.value === value)?.label ?? value.toUpperCase();
}

function normalizeLanguageToken(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pickLanguageOption(options: SelectOption[], preferredValues: string[], originalLanguage: string | null) {
  const resolved = preferredValues
    .map(value => normalizeLanguageToken(resolvePreferredLanguage(value, originalLanguage)))
    .filter(Boolean);
  for (const preferred of resolved) {
    const hit = options.find(option => normalizeLanguageToken(option.label).includes(preferred));
    if (hit) return hit;
  }
  return options[0] ?? null;
}

function resolvePreferredLanguage(value: string, originalLanguage: string | null) {
  if (value === "original") return originalLanguage ?? "";
  return value;
}

function audioLanguageAliases(preferred: string) {
  const aliasMap: Record<string, string[]> = {
    es: ["es", "esp", "spa", "spanish", "castellano", "lat", "latino", "espanol"],
    en: ["en", "eng", "english", "ingles"],
    ja: ["ja", "jpn", "japanese", "japones", "jp"],
    pt: ["pt", "por", "portuguese", "portugues", "br"],
    it: ["it", "ita", "italian", "italiano"],
    fr: ["fr", "fre", "french", "frances"],
    de: ["de", "ger", "german", "aleman"],
  };
  return aliasMap[preferred] ?? [preferred];
}

function streamSupportsPreferredAudio(stream: MediaStream, preferredAudio: string, originalLanguage: string | null) {
  const preferred = normalizeLanguageToken(resolvePreferredLanguage(preferredAudio, originalLanguage));
  if (!preferred) return true;
  const text = normalizeLanguageToken([
    stream.name,
    stream.title,
    stream.description,
    stream.behaviorHints?.filename,
  ].filter(Boolean).join(" "));
  if (!text) return false;
  const aliases = audioLanguageAliases(preferred);
  return aliases.some(alias => text.includes(alias));
}

function ensureOriginalTmdbImage(url?: string) {
  if (!url) return undefined;
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${IMG}/original/`);
}

function normalizeArtworkCandidate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/")) return `${IMG}/original${trimmed}`;
  return ensureOriginalTmdbImage(trimmed);
}

function collectArtworkCandidates(...values: unknown[]): string[] {
  const results: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      const normalized = normalizeArtworkCandidate(value);
      if (normalized) results.push(normalized);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["file_path", "url", "src", "background", "backdrop", "thumbnail", "still", "landscape"]) {
        visit(record[key]);
      }
    }
  };
  values.forEach(visit);
  return uniqueArtwork(results);
}

function uniqueArtwork(values: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    const normalized = normalizeArtworkCandidate(value);
    if (!normalized) continue;
    const key = artworkKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(normalized);
  }
  return list;
}

function pickRandomArtwork(values: Array<string | undefined | null> | undefined, excluded: Array<string | undefined | null>) {
  const excludedKeys = new Set(excluded.map(value => artworkKey(normalizeArtworkCandidate(value))).filter(Boolean));
  const candidates = uniqueArtwork(values ?? []).filter(value => !excludedKeys.has(artworkKey(value)));
  if (!candidates.length) return undefined;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function artworkKey(value?: string) {
  return (value ?? "")
    .replace(/\/t\/p\/(?:w\d+|original)\//i, "/t/p/size/")
    .replace(/[?#].*$/, "")
    .toLowerCase();
}

function isTmdbImageUrl(value?: string | null) {
  return Boolean(value && /image\.tmdb\.org\/t\/p\//i.test(value));
}

function pickArtwork(...values: Array<string | undefined | null>) {
  return values.find((value): value is string => Boolean(value));
}

function runtimeMinutes(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric > 300 ? Math.round(numeric / 60) : Math.round(numeric);
  if (typeof value !== "string") return undefined;
  const hours = value.match(/(\d+)\s*h/i);
  const minutes = value.match(/(\d+)\s*m/i);
  if (hours || minutes) return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return undefined;
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) {
    const list = value.map(item => typeof item === "string" ? item : item?.name).filter(Boolean);
    return list.length ? list : undefined;
  }
  if (typeof value === "string" && value.trim()) return value.split(",").map(item => item.trim()).filter(Boolean);
  return undefined;
}

function normalizeCredit(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function findAddonEpisode(meta: any, query: StreamQuery) {
  if (typeof query.season !== "number" || !query.episode || !Array.isArray(meta?.videos)) return null;
  return meta.videos.find((video: any) => {
    const season = Number(video?.season ?? video?.season_number ?? video?.seasonNumber);
    const episode = Number(video?.episode ?? video?.episode_number ?? video?.episodeNumber ?? video?.number);
    return season === query.season && episode === query.episode;
  }) ?? null;
}

function pickTmdbLogo(logos: any[] | undefined) {
  if (!Array.isArray(logos)) return undefined;
  return (
    logos.find(item => item?.iso_639_1 === "es" && typeof item?.file_path === "string")
    ?? logos.find(item => item?.iso_639_1 === "en" && typeof item?.file_path === "string")
    ?? logos.find(item => item?.iso_639_1 === null && typeof item?.file_path === "string")
    ?? logos.find(item => typeof item?.file_path === "string")
  )?.file_path;
}

function mapTmdbScreenshotBackdrops(backdrops: any[] | undefined) {
  if (!Array.isArray(backdrops)) return [];
  const preferred = sortTmdbBackdropsByPreference(backdrops);
  if (preferred.length) return preferred;
  return backdrops
    .filter(item => (
      typeof item?.file_path === "string" &&
      (item.iso_639_1 === null || item.iso_639_1 === undefined || item.iso_639_1 === "") &&
      isCinematicAspectRatio(item.aspect_ratio)
    ))
    .sort((a, b) => {
      const scoreA = Number(a.vote_average ?? 0) + Math.min(Number(a.vote_count ?? 0), 50) / 100;
      const scoreB = Number(b.vote_average ?? 0) + Math.min(Number(b.vote_count ?? 0), 50) / 100;
      return scoreB - scoreA;
    })
    .map(item => `${IMG}/original${item.file_path}`);
}

function mapTmdbEpisodeStills(stills: any[] | undefined) {
  if (!Array.isArray(stills)) return [];
  return stills
    .filter(item => (
      typeof item?.file_path === "string" &&
      (item.iso_639_1 === null || item.iso_639_1 === undefined || item.iso_639_1 === "") &&
      isCinematicAspectRatio(item.aspect_ratio)
    ))
    .sort((a, b) => Number(b.vote_average ?? 0) - Number(a.vote_average ?? 0))
    .map(item => `${IMG}/original${item.file_path}`);
}

function isCinematicAspectRatio(value: unknown) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return true;
  return ratio >= 1.65 && ratio <= 1.95;
}

function pickCrew(crew: any[] | undefined, job: string) {
  if (!Array.isArray(crew)) return undefined;
  const people = crew
    .filter(item => String(item?.job ?? "").toLowerCase() === job.toLowerCase())
    .map(item => item?.name)
    .filter(Boolean);
  return people.length ? people.join(", ") : undefined;
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

function metaTypeCandidates(type: string) {
  const normalized = type.trim().toLowerCase();
  if (normalized === "series") return ["series", "tv"];
  if (normalized === "tv") return ["tv", "series"];
  return [normalized];
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

function formatRuntime(minutes: number) {
  const rounded = Math.round(minutes);
  if (!Number.isFinite(rounded) || rounded <= 0) return "";
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function formatEndTime(runtimeMinutesValue: number) {
  const date = new Date(Date.now() + runtimeMinutesValue * 60_000);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
