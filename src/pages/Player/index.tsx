import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, SkipForward } from "lucide-react";
import {
  matchesPreferredLanguage,
  resolvePreferredLanguage,
  savePlaybackPreferences,
  usePlaybackPreferences,
} from "../../config/playbackPreferences";
import { useOriginalLanguage } from "../../hooks/useOriginalLanguage";
import { useSubtitles } from "../../hooks/useSubtitles";
import type { MediaStream } from "../../types/stream";
import type { SubtitleSource } from "../../types/subtitle";
import {
  buildContinueWatchingKey,
  buildMediaKey,
  getContinueWatchingAudioSelection,
  getExactResumeForQuery,
  getResumeStartTime,
  saveContinueWatchingAudioSelection,
  saveContinueWatchingProgress,
  saveNextEpisodePrompt,
  updateContinueWatchingSelection,
  type ContinueWatchingEntry,
} from "../../utils/continueWatching";
import { sanitizeLogoUrl } from "../../utils/artwork";
import { isPlayableMediaStream } from "../../utils/playableMedia";
import { readDetailMediaMeta, resolveDetailBackground } from "../../utils/mediaMetadata";
import { sendTraktScrobble, syncTraktProgressEntry } from "../../trakt";
import {
  getNativePlaybackStatus,
  getPlaybackCapabilities,
  isAndroidRuntime,
  openExternalUrl,
  sendNativePlaybackCommand,
  setNativeMpvVideoProfile,
  setNativeAutocrop,
  setNativeMpvSurfaceVisible,
  stopNativePlayback,
} from "../../runtime/platform";
import type { ChapterOption, MpvTrack, VideoScaleMode } from "./types";
import EpisodePanel from "./EpisodePanel";
import SourcePanel from "./SourcePanel";
import PlayerControls from "./PlayerControls";
import PlayerLoadingOverlay from "./PlayerLoadingOverlay";
import UpNext from "../../components/upnext/UpNext";
import { useRelatedRecommendation } from "../../hooks/useRelatedRecommendation";
import { useControlsVisibility } from "./useControlsVisibility";
import { useEpisodeMetadata, usePlayerLogos } from "./usePlayerMetadata";
import { usePlayerKeyboardShortcuts } from "./usePlayerKeyboardShortcuts";
import { useMpvStatus } from "./useMpvStatus";
import { useSkipIntro } from "./useSkipIntro";
import SubtitleSyncDialog from "./SubtitleSyncDialog";
import { gsap } from "../../utils/motion";
import { getUpNextMiniRect } from "../../utils/upnextMiniRect";
import {
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS,
} from "./subtitleSync/config";
import { formatAutoSyncDelay } from "./subtitleSync/parser";
import { getSavedSubtitleDelayMs, saveSubtitleDelayMs } from "./subtitleSync/storage";
import { useSubtitleSync } from "./subtitleSync/useSubtitleSync";
import {
  VIDEO_ENHANCEMENT_OPTIONS,
  readVideoEnhancementProfile,
  saveVideoEnhancementProfile,
} from "./videoEnhancements";
import { LOCAL_FILES_DROPPED_EVENT } from "../../utils/localMedia";
import { useDiscordPresence } from "../../hooks/useDiscordPresence";
import {
  AUTO_NEXT_SOURCE_KEY,
  AVAILABLE_STREAMS_KEY,
  SELECTED_ENGINE_KEY,
  SELECTED_MEDIA_META_KEY,
  SELECTED_PLAYBACK_OVERRIDES_KEY,
  SELECTED_STREAM_KEY,
  buildQuery,
  formatTime,
  getPlaybackTarget,
  getStreamKind,
  openExternal,
  playbackOverrideQueryKey,
} from "./utils";

const DEBUG_AUTOPLAY = false;
const DEBUG_AUTO_LANG = true;
const DEBUG_RESUME = true;
const DIRECT_STARTUP_GATE_TIMEOUT_MS = 900;
const P2P_STARTUP_GATE_TIMEOUT_MS = 3500;
const LOAD_FAILURE_TIMEOUT_MS = 12_000;
const P2P_LOAD_FAILURE_TIMEOUT_MS = 180000;
const DIRECT_FIRST_FRAME_TIMEOUT_MS = 8_000;
const DIRECT_STREAM_FALLBACKS_KEY = "aetherio-direct-stream-fallbacks";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/";

interface MpvAutocropResult {
  enabled: boolean;
  sourceCropApplied?: boolean;
  crop?: string | null;
  warning?: string;
}

interface SelectedPlaybackOverrides {
  queryKey?: string;
  selectedAudio?: string;
  selectedAudioLabel?: string;
  selectedAudioLanguage?: string;
  selectedSubtitle?: string;
  selectedSubtitleLabel?: string;
  selectedSubtitleLanguage?: string;
  forceSubtitleSelection?: boolean;
}

function ensureOriginalTmdbImage(url?: string) {
  if (!url) return "";
  return url.replace(/https:\/\/image\.tmdb\.org\/t\/p\/(?:w\d+|original)\//i, `${TMDB_IMAGE_BASE}original/`);
}

function readSelectedMediaResumeTime() {
  try {
    const raw = sessionStorage.getItem(SELECTED_MEDIA_META_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { resumeTime?: number };
    return Number.isFinite(parsed.resumeTime) ? Math.max(0, Number(parsed.resumeTime)) : 0;
  } catch {
    return 0;
  }
}

function readSelectedPlaybackOverrides(query: ReturnType<typeof buildQuery>): SelectedPlaybackOverrides | null {
  if (!query) return null;
  try {
    const raw = sessionStorage.getItem(SELECTED_PLAYBACK_OVERRIDES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SelectedPlaybackOverrides;
    if (parsed.queryKey !== playbackOverrideQueryKey(query)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function PlayerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mpvLaunchKeyRef = useRef("");
  const mpvRecoveryKeyRef = useRef("");
  const launchStartedAtRef = useRef(0);
  const nextEpisodeAutoKeyRef = useRef("");
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const lastProgressTimeRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastContinueSaveAtRef = useRef(0);
  const lastAudibleVolumeRef = useRef(0.86);
  const lastMpvFileLoadedRef = useRef(false);
  const lastMpvCacheRef = useRef(-1);
  const lastMpvPauseRef = useRef<boolean | null>(null);
  const autoAudioAppliedRef = useRef(false);
  const autoSubtitleAppliedRef = useRef(false);
  const manualAudioSelectionRef = useRef(false);
  const manualSubtitleSelectionRef = useRef(false);
  const autoAudioAttemptsRef = useRef(0);
  const autoSubtitleAttemptsRef = useRef(0);
  const autoAudioTimerRef = useRef<number | null>(null);
  const autoSubtitleTimerRef = useRef<number | null>(null);
  const selectedMpvAudioRef = useRef("");
  const selectedMpvSubtitleRef = useRef("");
  const desiredAudioSelectionRef = useRef("");
  const desiredSubtitleSelectionRef = useRef("");
  const desiredAudioSelectionSetRef = useRef(false);
  const desiredSubtitleSelectionSetRef = useRef(false);
  const startupGateActiveRef = useRef(false);
  const startupGatePausedRef = useRef(false);
  const startupGateStartedAtRef = useRef(0);
  const startupGateLastAudioApplyAtRef = useRef(0);
  const mpvFileLoadedAtRef = useRef(0);
  const startupKickCountRef = useRef(0);
  const resumeSeekAppliedRef = useRef("");
  const resumeSeekAttemptsRef = useRef(0);
  const resumeSeekTimerRef = useRef<number | null>(null);
  const resumeSeekTargetRef = useRef(0);
  const resumeSeekSettledRef = useRef(true);
  const resumeSeekStartedAtRef = useRef(0);
  const savedAudioRestoreKeyRef = useRef("");
  const savedAudioRestoreAttemptsRef = useRef(0);
  const savedAudioRestoreTimerRef = useRef<number | null>(null);
  const holdSpeedTimerRef = useRef<number | null>(null);
  const holdSpeedActiveRef = useRef(false);
  const holdSpeedRestoreRef = useRef(1);
  const ignoreNextScreenClickRef = useRef(false);
  const traktStartedKeyRef = useRef("");
  const traktStoppedKeyRef = useRef("");
  const nextEpisodePromptKeyRef = useRef("");
  const directFallbacksRef = useRef<MediaStream[]>([]);
  const attemptedDirectTargetsRef = useRef(new Set<string>());

  const [stream, setStream] = useState<MediaStream | null>(null);
  const isP2pStream = getStreamKind(stream) === "p2p";
  const startupGateTimeoutMs = isP2pStream
    ? P2P_STARTUP_GATE_TIMEOUT_MS
    : DIRECT_STARTUP_GATE_TIMEOUT_MS;
  const [selectedMediaName, setSelectedMediaName] = useState("");
  const [selectedMediaBackground, setSelectedMediaBackground] = useState("");
  const [selectedMediaLogo, setSelectedMediaLogo] = useState("");
  const [selectedMediaPoster, setSelectedMediaPoster] = useState("");
  const [selectedResumeTime, setSelectedResumeTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [manualPaused, setManualPaused] = useState(false);
  const playbackPreferences = usePlaybackPreferences();
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.86);
  const { controlsVisible, wakeControls, holdControls, releaseControls } = useControlsVisibility(3000);
  const [selectedMpvSubtitle, setSelectedMpvSubtitle] = useState("");
  const [selectedMpvAudio, setSelectedMpvAudio] = useState("");
  const [selectedSpeed, setSelectedSpeed] = useState("1");
  const [selectedVideoProfile, setSelectedVideoProfile] = useState(readVideoEnhancementProfile);
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [subtitleScalePercent, setSubtitleScalePercent] = useState(100);
  const [subtitleVerticalPercent, setSubtitleVerticalPercent] = useState(5);
  const [mpvStatus, setMpvStatus] = useState<string | null>(null);
  const [mpvBundled, setMpvBundled] = useState<boolean | null>(null);
  const [mpvTracks, setMpvTracks] = useState<MpvTrack[]>([]);
  const [mpvVideoWidth, setMpvVideoWidth] = useState<number | null>(null);
  const [mpvVideoHeight, setMpvVideoHeight] = useState<number | null>(null);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([]);
  const [activeSidePanel, setActiveSidePanel] = useState<"episodes" | "sources" | null>(null);
  const [availableStreams, setAvailableStreams] = useState<MediaStream[]>([]);
  const [showUpNext, setShowUpNext] = useState(false);
  const upNextShownKeyRef = useRef("");
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [mpvReadyForCommands, setMpvReadyForCommands] = useState(false);
  const [mpvFileLoaded, setMpvFileLoaded] = useState(false);
  const [mpvPausedForCache, setMpvPausedForCache] = useState(false);
  const [mpvCacheBuffering, setMpvCacheBuffering] = useState<number>(0);
  const [stalledPlayback, setStalledPlayback] = useState(false);
  const [videoScaleMode, setVideoScaleMode] = useState<VideoScaleMode>("original");
  const [loadingOverlayVisible, setLoadingOverlayVisible] = useState(false);
  const [isLeavingPlayer, setIsLeavingPlayer] = useState(false);
  const leavingPlayerRef = useRef(false);
  const loadingOverlayTimerRef = useRef<number | null>(null);
  const loadingOverlayShownAtRef = useRef(0);
  const manualPausedRef = useRef(false);
  const seekBufferingRef = useRef(false);
  const seekStartedAtRef = useRef(0);
  const [seekBuffering, setSeekBuffering] = useState(false);
  const [fileDropNotice, setFileDropNotice] = useState("");
  const fileDropNoticeTimerRef = useRef<number | null>(null);
  const [subtitleSyncNotice, setSubtitleSyncNotice] = useState("");
  const subtitleSyncNoticeTimerRef = useRef<number | null>(null);
  const [videoFilterNotice, setVideoFilterNotice] = useState("");
  const videoFilterNoticeTimerRef = useRef<number | null>(null);
  const localPlaybackKey = params.get("local");

  const query = useMemo(() => buildQuery(params), [
  params.get("type"),
  params.get("id"),
  params.get("season"),
  params.get("ep"),
  ]);
  const { episodeOptions, seriesLogoUrl } = useEpisodeMetadata(query);
  const { addonLogoUrl, detailLogoUrl } = usePlayerLogos(query, stream);
  const safeStream = stream ?? null;
  const isIframeStream = safeStream?.behaviorHints?.scraperPlayback === "iframe";
  const androidPlayback = isAndroidRuntime();
  const trailerRequested = params.get("trailer") === "1";
  const isTrailerStream = trailerRequested || Boolean(safeStream?.ytId);
  const metadataQuery = isTrailerStream ? null : query;
  const originalLanguage = useOriginalLanguage(metadataQuery, safeStream);
  const resumeEntry = useMemo(() => getExactResumeForQuery(query), [query]);
  const savedAudioSelection = useMemo(() => getContinueWatchingAudioSelection(query), [query]);
  const selectedPlaybackOverrides = useMemo(() => readSelectedPlaybackOverrides(query), [query]);
  const { subtitles: addonSubtitles, loading: subtitlesLoading, ready: subtitlesReady } = useSubtitles(
    metadataQuery,
    safeStream,
    selectedPlaybackOverrides?.selectedSubtitle ?? resumeEntry?.selectedSubtitle ?? "",
  );
  const { recommendation: relatedRecommendation } = useRelatedRecommendation(query);
  const related = { recommendation: relatedRecommendation };

  useEffect(() => {
    if (!query) return;
    setSubtitleDelayMs(getSavedSubtitleDelayMs(query));
  }, [query]);

  const hasMpvError = !isLeavingPlayer && !androidPlayback && (mpvBundled === false || mpvStatus?.startsWith("MPV no"));
  const nativeSurfaceVisible = !androidPlayback && !isIframeStream && Boolean(stream && playbackStarted && !hasMpvError);

  const currentEpisode = query?.season && query?.episode
    ? episodeOptions.find(ep => ep.episode === query.episode) ?? null
    : null;

  useDiscordPresence({
    enabled: playbackPreferences.enableDiscordRichPresence && !androidPlayback,
    hasStream: Boolean(stream),
    playbackStarted,
    playing: playing && !manualPaused,
    manualPaused,
    currentTime,
    duration,
    query,
    stream: safeStream,
    mediaName: selectedMediaName,
    episodeName: currentEpisode?.name,
    posterUrl: selectedMediaPoster || undefined,
    isTrailer: isTrailerStream,
  });

  useEffect(() => {
    leavingPlayerRef.current = isLeavingPlayer;
  }, [isLeavingPlayer]);

  useEffect(() => {
    document.documentElement.classList.toggle("aetherio-player-window", nativeSurfaceVisible);
    window.dispatchEvent(new CustomEvent("aetherio-player-transparency", {
      detail: { transparent: nativeSurfaceVisible },
    }));

    return () => {
      document.documentElement.classList.remove("aetherio-player-window");
      window.dispatchEvent(new CustomEvent("aetherio-player-transparency", {
        detail: { transparent: false },
      }));
    };
  }, [nativeSurfaceVisible]);

  useEffect(() => {
    if (androidPlayback) return;
    void setNativeMpvSurfaceVisible(nativeSurfaceVisible).catch(error => {
      console.warn("[AETHERIO:PLAYER:SURFACE] visibility sync failed", String(error));
    });
    return () => {
      void setNativeMpvSurfaceVisible(false).catch(() => undefined);
    };
  }, [androidPlayback, nativeSurfaceVisible]);

  function debugLog(event: string, extra?: Record<string, unknown>) {
    if (!DEBUG_AUTOPLAY) return;
    const payload = {
      event,
      ts: Number(performance.now().toFixed(1)),
      engine: "mpv",
      currentTime: Number(currentTimeRef.current.toFixed(3)),
      playbackStarted,
      mpvFileLoaded,
      mpvPausedForCache,
      mpvCacheBuffering,
      stalledPlayback,
      ...extra,
    };
    console.info("[AETHERIO:PLAYER]", payload);
  }

  function autoLangLog(event: string, extra?: Record<string, unknown>) {
    if (!DEBUG_AUTO_LANG) return;
    console.info("[AETHERIO:PLAYER:AUTO-LANG]", {
      event,
      ts: Number(performance.now().toFixed(1)),
      preferredAudio1: playbackPreferences.firstAudioLanguage,
      preferredAudio2: playbackPreferences.secondAudioLanguage,
      preferredSubtitle: playbackPreferences.preferredSubtitleLanguage,
      originalLanguage,
      selectedMpvAudio: selectedMpvAudioRef.current,
      selectedMpvSubtitle: selectedMpvSubtitleRef.current,
      ...extra,
    });
  }

  function resumeLog(event: string, extra?: Record<string, unknown>) {
    if (!DEBUG_RESUME) return;
    console.info("[AETHERIO:PLAYER:RESUME]", {
      event,
      ts: Number(performance.now().toFixed(1)),
      query: query ? `${query.type}:${query.id}:${query.season ?? "-"}:${query.episode ?? "-"}` : null,
      streamId: stream?.id ?? null,
      currentTime: Number(currentTimeRef.current.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      target: Number(resumeSeekTargetRef.current.toFixed(3)),
      settled: resumeSeekSettledRef.current,
      attempts: resumeSeekAttemptsRef.current,
      mpvReadyForCommands,
      mpvFileLoaded,
      ...extra,
    });
  }

  useEffect(() => {
    const saved = sessionStorage.getItem(SELECTED_STREAM_KEY);
    const savedMediaMeta = sessionStorage.getItem(SELECTED_MEDIA_META_KEY);
    const savedAvailableStreams = sessionStorage.getItem(AVAILABLE_STREAMS_KEY);
    try {
      const parsedAvailable = savedAvailableStreams ? JSON.parse(savedAvailableStreams) as unknown : [];
      setAvailableStreams(Array.isArray(parsedAvailable)
        ? parsedAvailable.filter((candidate): candidate is MediaStream => (
            Boolean(candidate)
            && typeof candidate === "object"
            && isPlayableMediaStream(candidate as MediaStream)
          ))
        : []);
    } catch {
      setAvailableStreams([]);
    }
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as MediaStream;
      if (savedMediaMeta) {
        try {
          const parsedMeta = JSON.parse(savedMediaMeta) as { name?: string; logo?: string; background?: string; poster?: string; resumeTime?: number };
          const metadataSeed = query ? readDetailMediaMeta(query.type, query.id) : undefined;
          const background = query
            ? resolveDetailBackground(query.type, query.id, parsedMeta.background ?? metadataSeed?.background ?? parsedMeta.poster)
            : parsedMeta.background ?? parsedMeta.poster;
          setSelectedMediaName(typeof parsedMeta.name === "string" ? parsedMeta.name : "");
          setSelectedMediaBackground(typeof background === "string" ? background : "");
          setSelectedMediaLogo(sanitizeLogoUrl(parsedMeta.logo) ?? "");
          setSelectedMediaPoster(typeof parsedMeta.poster === "string" && parsedMeta.poster ? parsedMeta.poster : (typeof background === "string" ? background : ""));
          setSelectedResumeTime(Number.isFinite(parsedMeta.resumeTime) ? Math.max(0, Number(parsedMeta.resumeTime)) : 0);
        } catch {
          setSelectedMediaName("");
          setSelectedMediaBackground("");
          setSelectedMediaLogo("");
          setSelectedMediaPoster("");
          setSelectedResumeTime(0);
        }
      }
      try {
        const rawFallbacks = sessionStorage.getItem(DIRECT_STREAM_FALLBACKS_KEY);
        const parsedFallbacks = rawFallbacks ? JSON.parse(rawFallbacks) as unknown : [];
        directFallbacksRef.current = Array.isArray(parsedFallbacks)
          ? parsedFallbacks
              .filter((candidate): candidate is MediaStream => (
                Boolean(candidate)
                && typeof candidate === "object"
                && isPlayableMediaStream(candidate as MediaStream)
                && getStreamKind(candidate as MediaStream) === "https"
              ))
              .slice(0, 6)
          : [];
      } catch {
        directFallbacksRef.current = [];
      }
      const selectedTarget = getPlaybackTarget(parsed);
      if (selectedTarget) attemptedDirectTargetsRef.current.add(selectedTarget);
      setStream(parsed);
      sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    } catch {
      setStream(null);
    }
  }, [localPlaybackKey]);

  useEffect(() => {
    if (isP2pStream || !mpvStatus?.startsWith("MPV no pudo cargar esta fuente") || leavingPlayerRef.current) return;
    const next = directFallbacksRef.current.find(candidate => {
      const target = getPlaybackTarget(candidate);
      return target && !attemptedDirectTargetsRef.current.has(target);
    });
    if (!next) return;
    const failed = stream;
    const nextTarget = getPlaybackTarget(next);
    attemptedDirectTargetsRef.current.add(nextTarget);
    sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(next));
    console.warn("[AETHERIO:DIRECT] automatic fallback", {
      failedProvider: failed?.addonName ?? failed?.name,
      nextProvider: next.addonName ?? next.name,
      attempted: attemptedDirectTargetsRef.current.size,
      remaining: directFallbacksRef.current.filter(candidate => (
        !attemptedDirectTargetsRef.current.has(getPlaybackTarget(candidate))
      )).length,
    });
    setMpvStatus(`La fuente ${failed?.name ?? "seleccionada"} no respondio. Probando ${next.name ?? next.addonName ?? "otra fuente"}...`);
    setStream(next);
  }, [isP2pStream, mpvStatus, stream]);

  useEffect(() => {
    getPlaybackCapabilities()
      .then(result => setMpvBundled(result.mpvBundled))
      .catch(() => setMpvBundled(false));
  }, []);

  useMpvStatus({
    lastMpvFileLoadedRef,
    lastMpvCacheRef,
    lastMpvPauseRef,
    debugLog,
    setCurrentTime,
    setDuration,
    setPlaying: next => {
      setPlaying(prev => {
        if (manualPausedRef.current) return false;
        return typeof next === "function" ? next(prev) : next;
      });
    },
    setMpvFileLoaded,
    setMpvPausedForCache,
    setMpvCacheBuffering,
    setMpvTracks,
    setMpvVideoWidth,
    setMpvVideoHeight,
    setSelectedMpvSubtitle: next => {
      setSelectedMpvSubtitle(prev => {
        const nextValue = typeof next === "function" ? next(prev) : next;
        const desired = desiredSubtitleSelectionRef.current;
        if (desiredSubtitleSelectionSetRef.current && desired.startsWith("ext:") && nextValue.startsWith("track:")) {
          return prev === desired ? prev : desired;
        }
        if (nextValue.startsWith("track:") && prev.startsWith("ext:")) {
          const trackId = Number(nextValue.slice(6));
          const matchedTrack = mpvTracks.find(track => Number(track.id) === trackId);
          if (matchedTrack && subtitleTrackMatchesUrl(String(matchedTrack.title ?? ""), prev.slice(4))) {
            return prev;
          }
        }
        return prev === nextValue ? prev : nextValue;
      });
    },
    setSelectedMpvAudio,
    setSelectedSpeed,
    setChapterIndex,
    setChapterOptions,
    setMpvStatus: next => {
      if (leavingPlayerRef.current) return;
      setMpvStatus(next);
    },
    onPlaybackRestart: () => {
      seekBufferingRef.current = false;
      seekStartedAtRef.current = 0;
      lastProgressAtRef.current = Date.now();
      setSeekBuffering(false);
      setStalledPlayback(false);
    },
    isP2pStream,
    enabled: !androidPlayback && !isIframeStream,
  });

  useEffect(() => {
    selectedMpvAudioRef.current = selectedMpvAudio;
  }, [selectedMpvAudio]);

  useEffect(() => {
    selectedMpvSubtitleRef.current = selectedMpvSubtitle;
  }, [selectedMpvSubtitle]);

  useEffect(() => {
    if (mpvFileLoaded) {
      mpvFileLoadedAtRef.current = Date.now();
      startupKickCountRef.current = 0;
      window.performance?.mark?.("player:file_loaded");
    } else {
      mpvFileLoadedAtRef.current = 0;
      seekBufferingRef.current = false;
      seekStartedAtRef.current = 0;
      setSeekBuffering(false);
    }
  }, [mpvFileLoaded]);

  useEffect(() => {
    if (mpvFileLoaded) {
      applyVideoScale(videoScaleMode);
      void sendMpvCommand(["set_property", "volume", Math.round(volume * 100)]);
      const hwdec = playbackPreferences.hardwareDecoding === "disabled"
        ? "no"
        : playbackPreferences.hardwareDecoding === "enabled"
          ? "auto"
          : "auto-safe";
      void sendMpvCommand(["set_property", "hwdec", hwdec]);
      void setNativeMpvVideoProfile(selectedVideoProfile)
        .then(result => {
          if (!result) return;
          console.info("[AETHERIO:VIDEO-FILTER]", result);
        })
        .catch(error => {
          console.error("[AETHERIO:VIDEO-FILTER] No se pudo aplicar la mejora.", error);
          setMpvStatus(`Mejoras de vídeo: ${String(error)}`);
        });
    }
  }, [mpvFileLoaded, playbackPreferences.hardwareDecoding, selectedVideoProfile, videoScaleMode, volume]);

  const applySubtitleSettings = useCallback((input?: {
    delayMs?: number;
    scalePercent?: number;
    verticalPercent?: number;
  }) => {
    if (!mpvReadyForCommands && !mpvFileLoaded) return;
    const delayMs = input?.delayMs ?? subtitleDelayMs;
    const scalePercent = input?.scalePercent ?? subtitleScalePercent;
    const verticalPercent = input?.verticalPercent ?? subtitleVerticalPercent;
    const delaySeconds = Number((delayMs / 1000).toFixed(2));
    const scale = Number((scalePercent / 100).toFixed(2));
    const subPos = Math.max(0, Math.min(150, 100 - verticalPercent));
    void sendMpvCommand(["set_property", "sub-delay", delaySeconds]);
    void sendMpvCommand(["set_property", "sub-scale", scale]);
    void sendMpvCommand(["set_property", "sub-pos", subPos]);
    void sendMpvCommand(["set_property", "sub-use-margins", true]);
  }, [mpvFileLoaded, mpvReadyForCommands, subtitleDelayMs, subtitleScalePercent, subtitleVerticalPercent]);

  const applyExternalSubtitle = useCallback((url: string) => {
    const existing = mpvTracks.find(track => {
      const kind = String(track.type ?? "").toLowerCase();
      if (!(kind === "sub" || kind === "subtitle" || kind.includes("sub"))) return false;
      return subtitleTrackMatchesUrl(String(track.title ?? ""), url);
    });
    if (existing) {
      void sendMpvCommand(["set_property", "sid", Number(existing.id)]);
      return;
    }
    void sendMpvCommand(["sub-add", url, "select"]);
    window.setTimeout(() => applySubtitleSettings(), 160);
  }, [applySubtitleSettings, mpvTracks]);

  const handleSubtitleSyncApply = useCallback((delayMs: number) => {
    setSubtitleDelayMs(delayMs);
    applySubtitleSettings({ delayMs });
    saveSubtitleDelayMs(query, delayMs);
    setSubtitleSyncNotice(`Sync aplicado: ${formatAutoSyncDelay(delayMs)}`);
    if (subtitleSyncNoticeTimerRef.current !== null) {
      window.clearTimeout(subtitleSyncNoticeTimerRef.current);
    }
    subtitleSyncNoticeTimerRef.current = window.setTimeout(() => {
      subtitleSyncNoticeTimerRef.current = null;
      setSubtitleSyncNotice("");
    }, 2400);
  }, [applySubtitleSettings, query]);

  useEffect(() => {
    if (!mpvFileLoaded) return;
    applySubtitleSettings();
  }, [applySubtitleSettings, mpvFileLoaded]);

  useEffect(() => {
    const onLocalFilesDropped = (event: Event) => {
      const paths = (event as CustomEvent<string[]>).detail ?? [];
      if (!paths.length) return;
      if (!mpvReadyForCommands) {
        setFileDropNotice("Espera a que el vídeo termine de abrir.");
        return;
      }
      paths.forEach(path => {
        void sendMpvCommand(["sub-add", path, "select"]);
      });
      window.setTimeout(() => applySubtitleSettings(), 160);
      setFileDropNotice(paths.length === 1
        ? "Subtítulo añadido"
        : `${paths.length} subtítulos añadidos`);
      if (fileDropNoticeTimerRef.current !== null) {
        window.clearTimeout(fileDropNoticeTimerRef.current);
      }
      fileDropNoticeTimerRef.current = window.setTimeout(() => {
        fileDropNoticeTimerRef.current = null;
        setFileDropNotice("");
      }, 2400);
    };
    window.addEventListener(LOCAL_FILES_DROPPED_EVENT, onLocalFilesDropped);
    return () => window.removeEventListener(LOCAL_FILES_DROPPED_EVENT, onLocalFilesDropped);
  }, [applySubtitleSettings, mpvReadyForCommands]);

  useEffect(() => () => {
    if (holdSpeedTimerRef.current !== null) {
      window.clearTimeout(holdSpeedTimerRef.current);
      holdSpeedTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (fileDropNoticeTimerRef.current !== null) {
      window.clearTimeout(fileDropNoticeTimerRef.current);
    }
  }, []);

  useEffect(() => () => {
    if (videoFilterNoticeTimerRef.current !== null) {
      window.clearTimeout(videoFilterNoticeTimerRef.current);
    }
  }, []);

  useEffect(() => () => {
    if (loadingOverlayTimerRef.current !== null) {
      window.clearTimeout(loadingOverlayTimerRef.current);
      loadingOverlayTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    currentTimeRef.current = currentTime;
    if (Math.abs(currentTime - lastProgressTimeRef.current) > 0.08) {
      lastProgressTimeRef.current = currentTime;
      lastProgressAtRef.current = Date.now();
      setStalledPlayback(false);
      if (seekBufferingRef.current && Date.now() - seekStartedAtRef.current > 450) {
        seekBufferingRef.current = false;
        seekStartedAtRef.current = 0;
        setSeekBuffering(false);
      }
    }
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    manualPausedRef.current = manualPaused;
    if (manualPaused) {
      seekBufferingRef.current = false;
      seekStartedAtRef.current = 0;
      setSeekBuffering(false);
      setStalledPlayback(false);
      return;
    }

    const interval = window.setInterval(() => {
      const cacheHint = mpvPausedForCache;
      const hasStarted = playbackStarted || currentTimeRef.current > 1;

      if (!hasStarted) {
        setStalledPlayback(false);
        return;
      }

      if (cacheHint) {
        setStalledPlayback(true);
        return;
      }

      setStalledPlayback(Date.now() - lastProgressAtRef.current > 4000);
    }, 500);

    return () => window.clearInterval(interval);
  }, [manualPaused, mpvFileLoaded, mpvPausedForCache, playbackStarted]);

  useEffect(() => {
    if (!stream || !stalledPlayback || !playbackStarted || manualPaused) return;
      const interval = window.setInterval(() => {
        if (manualPausedRef.current) return;
        void sendMpvCommand(["set_property", "pause", false]);
        void sendMpvCommand(["set_property", "speed", 1.0]);
      }, 1500);
    return () => window.clearInterval(interval);
  }, [manualPaused, playbackStarted, stalledPlayback, stream]);

  useEffect(() => {
    if (!stream || manualPaused || startupGateActiveRef.current || playbackStarted || !mpvReadyForCommands || !mpvFileLoaded) return;

    const interval = window.setInterval(() => {
      if (manualPausedRef.current || currentTimeRef.current > 0.05) return;
      if (!mpvFileLoadedAtRef.current || Date.now() - mpvFileLoadedAtRef.current < 1800) return;
      if (startupKickCountRef.current >= 6) return;

      startupKickCountRef.current += 1;
      debugLog("mpv startup kick", {
        attempt: startupKickCountRef.current,
        pausedForCache: mpvPausedForCache,
        cacheBuffering: mpvCacheBuffering,
      });
      void sendMpvCommand(["set_property", "cache-pause", false]);
      void sendMpvCommand(["set_property", "pause", false]);
      void sendMpvCommand(["set_property", "speed", 1.0]);
    }, 700);

    return () => window.clearInterval(interval);
  }, [manualPaused, mpvCacheBuffering, mpvFileLoaded, mpvPausedForCache, mpvReadyForCommands, playbackStarted, stream]);

  useEffect(() => {
    if (currentTime > 0.05) {
      startupGateActiveRef.current = false;
      startupGatePausedRef.current = false;
      setPlaybackStarted(true);
      window.performance?.mark?.("player:first_frame");
      setMpvStatus(prev => (
        prev?.startsWith("MPV no pudo cargar esta fuente") || prev?.startsWith("El torrent no entrego datos")
          ? null
          : prev
      ));
    }
  }, [currentTime]);

  useEffect(() => {
    if (!mpvFileLoaded) return;
    setMpvStatus(prev => (
      prev?.startsWith("MPV no pudo cargar esta fuente") || prev?.startsWith("El torrent no entrego datos")
        ? null
        : prev
    ));
  }, [mpvFileLoaded]);

  useEffect(() => {
    if (!stream || !mpvReadyForCommands || !startupGateActiveRef.current || manualPaused) return;
    const elapsed = Date.now() - startupGateStartedAtRef.current;
    const delay = Math.max(100, startupGateTimeoutMs - elapsed);
    const timer = window.setTimeout(() => {
      if (!startupGateActiveRef.current || manualPausedRef.current) return;
      releaseStartupGate("startup gate hard timeout");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [manualPaused, mpvReadyForCommands, startupGateTimeoutMs, stream]);

  useEffect(() => {
    if (
      !stream
      || !mpvReadyForCommands
      || mpvFileLoaded
      || playbackStarted
      || mpvStatus?.startsWith("MPV no")
      || mpvStatus?.startsWith("El torrent no entrego datos")
    ) return;
    const timer = window.setTimeout(() => {
      if (lastMpvFileLoadedRef.current || currentTimeRef.current > 0.05) return;
      startupGateActiveRef.current = false;
      startupGatePausedRef.current = false;
      setPlaying(false);
      setPlaybackStarted(false);
      setStalledPlayback(false);
      setMpvStatus(isP2pStream
        ? "El torrent no entrego datos reproducibles. Puede no tener peers disponibles."
        : "MPV no pudo cargar esta fuente. Puede estar expirada o bloqueada por el servidor.");
    }, isP2pStream ? P2P_LOAD_FAILURE_TIMEOUT_MS : LOAD_FAILURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isP2pStream, mpvFileLoaded, mpvReadyForCommands, mpvStatus, playbackStarted, stream]);

  useEffect(() => {
    if (!stream || isP2pStream || !mpvFileLoaded || playbackStarted || manualPaused) return;
    const timer = window.setTimeout(() => {
      if (currentTimeRef.current > 0.05 || manualPausedRef.current || playbackStarted) return;
      setMpvStatus("MPV no pudo cargar esta fuente. El archivo abrio, pero no entrego cuadros reproducibles.");
    }, DIRECT_FIRST_FRAME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isP2pStream, manualPaused, mpvFileLoaded, playbackStarted, stream]);

  useEffect(() => {
    if (!playbackStarted || startupKickCountRef.current === 0) return;
    void sendMpvCommand(["set_property", "cache-pause", true]);
  }, [playbackStarted]);

  useEffect(() => {
    if (query?.type === "movie") {
      setActiveSidePanel(current => current === "episodes" ? null : current);
    }
  }, [query?.type]);

  const allSubtitles = useMemo<SubtitleSource[]>(() => {
  if (!stream) return [];
    const embedded = (stream?.subtitles ?? [])
      .filter(item => item.url)
      .map((item, index) => ({
        id: `stream-${index}-${item.url}`,
        addonId: stream?.addonId ?? "stream",
        addonName: stream?.addonName ?? "Stream",
        url: item.url!,
        lang: item.lang ?? item.language ?? "und",
        label: item.title ?? item.lang ?? item.language ?? "Subtítulos del stream",
      }));
    const seen = new Set<string>();
    return [...embedded, ...addonSubtitles].filter(item => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [addonSubtitles, stream]);

  const audioOptions = useMemo(
    () =>
      mpvTracks
        .map(track => ({
          ...track,
          parsedId: Number(track.id),
          kind: String(track.type ?? "").toLowerCase(),
        }))
        .filter(track => Number.isFinite(track.parsedId) && (track.kind === "audio" || track.kind === "a" || track.kind.includes("audio")))
        .map(track => ({
          value: `track:${track.parsedId}`,
          label: track.title && track.lang ? `${track.lang} - ${track.title}` : track.title ?? track.lang ?? `Audio ${track.parsedId}`,
        })),
    [mpvTracks],
  );

  const subtitleOptions = useMemo(() => {
    const internal = mpvTracks
      .map(track => ({
        ...track,
        parsedId: Number(track.id),
        kind: String(track.type ?? "").toLowerCase(),
      }))
      .filter(track => Number.isFinite(track.parsedId) && (track.kind === "sub" || track.kind === "subtitle" || track.kind.includes("sub")))
      .flatMap(track => {
        const title = String(track.title ?? "");
        const externalMatch = allSubtitles.find(subtitle => subtitleTrackMatchesUrl(title, subtitle.url));
        if (externalMatch) return [];
        const languageKey = normalizeSubtitleLanguageKey(track.lang ?? title);
        if (looksLikeSubtitleUrl(title)) {
          const languageLabel = formatSubtitleLanguageLabel(languageKey, String(track.lang ?? ""));
          return [{
            value: `track:${track.parsedId}`,
            label: languageLabel,
            languageKey,
            languageLabel,
            sourceLabel: "Externo",
          }];
        }
        return [{
          value: `track:${track.parsedId}`,
          label: track.title && track.lang ? `${track.lang} - ${track.title}` : track.title ?? track.lang ?? `Subtítulo ${track.parsedId}`,
          languageKey,
          languageLabel: formatSubtitleLanguageLabel(languageKey, String(track.lang ?? "")),
          sourceLabel: "Embebido",
        }];
      });
    const external = allSubtitles.map(subtitle => {
      const languageKey = normalizeSubtitleLanguageKey(subtitle.lang || subtitle.label);
      return {
        value: `ext:${subtitle.url}`,
        label: subtitle.label,
        languageKey,
        languageLabel: formatSubtitleLanguageLabel(languageKey, subtitle.lang),
        sourceLabel: subtitle.addonName || "Externo",
      };
    });
    return [...internal, ...external];
  }, [allSubtitles, mpvTracks]);

  const subtitleSync = useSubtitleSync({
    selectedSubtitleValue: selectedMpvSubtitle,
    streamUrl: stream?.url ?? null,
    streamHeaders: stream?.behaviorHints?.headers as Record<string, string> | undefined,
    getPositionMs: async () => {
      try {
        const status = await getNativePlaybackStatus();
        return Number(status.timePos ?? 0) * 1000;
      } catch {
        return 0;
      }
    },
    onApplyDelay: handleSubtitleSyncApply,
  });

  useEffect(() => {
    if (!subtitleSync.open) return;
    holdControls();
    return () => releaseControls(1);
  }, [subtitleSync.open, holdControls, releaseControls]);

  const audioSelectionMeta = (value: string) => {
    const track = findMpvTrackByValue(value, mpvTracks);
    return {
      selectedAudio: value,
      selectedAudioLabel: audioOptions.find(option => option.value === value)?.label ?? "",
      selectedAudioLanguage: detectPreferredLanguageCode(value, mpvTracks, audioOptions),
      selectedAudioTrackLang: String(track?.lang ?? ""),
      selectedAudioTrackTitle: String(track?.title ?? ""),
    };
  };

  const subtitleSelectionMeta = (value: string) => ({
    selectedSubtitle: value,
    selectedSubtitleLabel: subtitleOptions.find(option => option.value === value)?.label ?? "",
    selectedSubtitleLanguage: detectPreferredLanguageCode(value, mpvTracks, subtitleOptions),
  });

  const persistAudioPreference = (value: string) => {
    const detectedLanguage = detectPreferredLanguageCode(value, mpvTracks, audioOptions);
    if (!detectedLanguage || detectedLanguage === playbackPreferences.firstAudioLanguage) return;
    savePlaybackPreferences({
      ...playbackPreferences,
      firstAudioLanguage: detectedLanguage,
    });
    autoLangLog("audio preference saved", { value, detectedLanguage });
  };

  const persistSubtitlePreference = (value: string) => {
    const detectedLanguage = detectPreferredLanguageCode(value, mpvTracks, subtitleOptions);
    if (!detectedLanguage || detectedLanguage === playbackPreferences.preferredSubtitleLanguage) return;
    savePlaybackPreferences({
      ...playbackPreferences,
      preferredSubtitleLanguage: detectedLanguage,
    });
    autoLangLog("subtitle preference saved", { value, detectedLanguage });
  };

  const speedOptions = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
  const normalizedAudioOptions = audioOptions.length > 0
    ? audioOptions
    : (selectedMpvAudio ? [{ value: selectedMpvAudio, label: `Audio ${selectedMpvAudio.replace("track:", "")}` }] : []);
  const panelItems = episodeOptions.length > 0
    ? episodeOptions.map(item => ({
      key: item.id,
      title: `${item.episode}. ${item.name}`,
      subtitle: item.airDate ?? `T${item.season} E${item.episode}`,
      image: item.still,
      active: item.episode === query?.episode,
      onClick: () => {
        if (item.episode === query?.episode) return;
        void stopNativePlayback().finally(() => {
          navigate(`/episode?type=${query?.type}&id=${encodeURIComponent(query?.id ?? "")}&season=${item.season}&ep=${item.episode}`);
        });
      },
    }))
    : chapterOptions.map(item => ({
      key: `chapter:${item.index}`,
      title: item.title,
      subtitle: formatTime(item.time),
      image: undefined,
      active: item.index === chapterIndex,
      onClick: () => {
        void sendMpvCommand(["set_property", "chapter", item.index]);
      },
    }));

  const title = useMemo(() => {
    const type = params.get("type");
    const season = params.get("season");
    const episode = params.get("ep");
    if (type !== "movie" && season && episode) return `Temporada ${season}, Episodio ${episode}`;
    return "";
  }, [params]);

  function togglePlay() {
    if (showUpNext) return;
    if (startupGateActiveRef.current) {
      startupGateActiveRef.current = false;
      startupGatePausedRef.current = false;
    }
    if (!playbackStarted && mpvFileLoaded) {
      manualPausedRef.current = false;
      setManualPaused(false);
      setPlaying(true);
      setStalledPlayback(false);
      lastProgressAtRef.current = Date.now();
      void sendMpvCommand(["set_property", "cache-pause", false]);
      void sendMpvCommand(["set_property", "pause", false]);
      void sendMpvCommand(["set_property", "speed", Number(selectedSpeed) || 1.0]);
      return;
    }

    const nextPlaying = !playing;
    const nextManualPaused = !nextPlaying;
    manualPausedRef.current = nextManualPaused;
    setManualPaused(nextManualPaused);
    setPlaying(nextPlaying);
    setStalledPlayback(false);
    lastProgressAtRef.current = Date.now();
    void sendMpvCommand(["set_property", "pause", nextManualPaused]);
    if (nextPlaying) {
      window.setTimeout(() => {
        if (manualPausedRef.current) return;
        lastProgressAtRef.current = Date.now();
        void sendMpvCommand(["set_property", "pause", false]);
        void sendMpvCommand(["set_property", "speed", Number(selectedSpeed) || 1.0]);
      }, 140);
    }
  }

  function seek(value: number) {
    if (showUpNext) return;
    debugLog("seek() called", { value });
    seekBufferingRef.current = true;
    seekStartedAtRef.current = Date.now();
    lastProgressAtRef.current = Date.now();
    setSeekBuffering(true);
    setStalledPlayback(false);
    setCurrentTime(value);
    void sendMpvCommand(["seek", value, "absolute", "exact"]).catch(() => {
      seekBufferingRef.current = false;
      seekStartedAtRef.current = 0;
      setSeekBuffering(false);
    });
  }

  function jump(offset: number) {
    if (showUpNext) return;
    debugLog("jump() called", { offset });
    void sendMpvCommand(["seek", offset, "relative"]);
  }

  function applyVolume(nextVolume: number) {
    if (showUpNext) return;
    const clamped = Math.min(2, Math.max(0, nextVolume));
    if (clamped > 0) lastAudibleVolumeRef.current = clamped;
    setVolume(clamped);
    void sendMpvCommand(["set_property", "volume", Math.round(clamped * 100)]);
  }

  function toggleMute() {
    applyVolume(volume === 0 ? Math.max(0.01, lastAudibleVolumeRef.current) : 0);
  }

  function applyVideoScale(mode: VideoScaleMode) {
    const isCrop = mode === "crop";
    void setNativeAutocrop(isCrop)
      .then(result => {
        const cropResult = result as MpvAutocropResult;
        debugLog("mpv_autocrop resolved", { result: cropResult });
        void sendMpvCommand(["set_property", "video-zoom", 0]);
        void sendMpvCommand(["set_property", "video-align-x", 0]);
        void sendMpvCommand(["set_property", "video-align-y", 0]);
        void sendMpvCommand(["set_property", "video-pan-x", 0]);
        void sendMpvCommand(["set_property", "video-pan-y", 0]);
        void sendMpvCommand(["set_property", "video-recenter", true]);
        if (!isCrop) {
          void sendMpvCommand(["set_property", "panscan", 0]);
          void sendMpvCommand(["set_property", "video-crop", ""]);
          return;
        }
        if (cropResult.sourceCropApplied) {
          void sendMpvCommand(["set_property", "panscan", 0]);
        } else {
          void sendMpvCommand(["set_property", "video-crop", ""]);
          void sendMpvCommand(["set_property", "panscan", 0.45]);
        }
      })
      .catch(error => {
        debugLog("mpv_autocrop fallback", { error: String(error) });
        void sendMpvCommand(["set_property", "video-crop", ""]);
        void sendMpvCommand(["set_property", "panscan", isCrop ? 0.45 : 0]);
        void sendMpvCommand(["set_property", "video-zoom", 0]);
        void sendMpvCommand(["set_property", "video-align-x", 0]);
        void sendMpvCommand(["set_property", "video-align-y", 0]);
        void sendMpvCommand(["set_property", "video-pan-x", 0]);
        void sendMpvCommand(["set_property", "video-pan-y", 0]);
        void sendMpvCommand(["set_property", "video-recenter", true]);
      });
  }

  function toggleVideoScale() {
    const nextMode = videoScaleMode === "original" ? "crop" : "original";
    setVideoScaleMode(nextMode);
    applyVideoScale(nextMode);
  }

  function applyVideoProfile(profile: string) {
    const normalized = saveVideoEnhancementProfile(profile);
    setSelectedVideoProfile(normalized);
    const label = VIDEO_ENHANCEMENT_OPTIONS.find(opt => opt.value === normalized)?.label ?? normalized;
    const showNotice = (text: string) => {
      setVideoFilterNotice(text);
      if (videoFilterNoticeTimerRef.current !== null) window.clearTimeout(videoFilterNoticeTimerRef.current);
      videoFilterNoticeTimerRef.current = window.setTimeout(() => {
        videoFilterNoticeTimerRef.current = null;
        setVideoFilterNotice("");
      }, 2600);
    };
    if (!mpvFileLoaded) {
      showNotice(`Mejora guardada: ${label} (se aplicará al cargar)`);
      return;
    }
    console.info("[AETHERIO:VIDEO-FILTER] applying", { profile: normalized, label });
    setMpvStatus(`Aplicando mejora: ${label}...`);
    void setNativeMpvVideoProfile(normalized)
      .then(result => {
        console.info("[AETHERIO:VIDEO-FILTER] verified", result);
        setMpvStatus(null);
        const verified = (result as { verified?: boolean })?.verified !== false;
        showNotice(verified ? `Mejora activa: ${label}` : `Mejora aplicada con advertencia: ${label}`);
      })
      .catch(error => {
        console.error("[AETHERIO:VIDEO-FILTER] failed", { profile: normalized, error });
        setMpvStatus(`Mejoras de vídeo: ${String(error)}`);
        showNotice(`Error mejora: ${String(error).slice(0, 80)}`);
      });
  }

  async function launchMpv(showOpening = true) {
    if (!stream || isIframeStream) return;
    if (showOpening) setMpvStatus(androidPlayback
      ? "Abriendo reproductor Android TV..."
      : isP2pStream
        ? "Preparando stream P2P..."
        : "Abriendo MPV...");
    launchStartedAtRef.current = Date.now();
    const resumeStartTime = Math.max(resumeSeekTargetRef.current, getResumeStartTime(query), selectedResumeTime, readSelectedMediaResumeTime());
    const { error } = await openExternal(stream, undefined, resumeStartTime, query?.episode);
    setMpvReadyForCommands(!error);
    setPlaying(false);
    setManualPaused(false);
    manualPausedRef.current = false;
    setMpvStatus(error ? `${androidPlayback ? "Android TV" : "MPV"} no inicio: ${error}` : null);
    if (!error) {
      if (androidPlayback) {
        startupGateActiveRef.current = false;
        setMpvFileLoaded(true);
        setPlaybackStarted(true);
        setPlaying(true);
      } else {
        void sendMpvCommand(["set_property", "pause", startupGateActiveRef.current]);
        applyVideoScale(videoScaleMode);
      }
    }
  }

  async function retryMpvPlayback() {
    setMpvStatus(androidPlayback
      ? "Reiniciando reproductor Android TV..."
      : isP2pStream
        ? "Reiniciando stream P2P..."
        : "Reiniciando MPV...");
    await launchMpv(false);
  }

  async function sendMpvCommand(command: unknown[]) {
    debugLog("mpv_command send", { command });
    try {
      await sendNativePlaybackCommand(command);
      debugLog("mpv_command ok", { command });
    } catch (error) {
      debugLog("mpv_command error", { command, error: String(error) });
      if (!androidPlayback) setMpvStatus(`MPV: ${String(error)}`);
    }
  }

  function releaseStartupGate(reason: string) {
    startupGateActiveRef.current = false;
    startupGatePausedRef.current = false;
    autoLangLog(reason);
    if (manualPausedRef.current) return;
    setPlaying(true);
    setStalledPlayback(false);
    lastProgressAtRef.current = Date.now();
    void sendMpvCommand(["set_property", "cache-pause", false]);
    void sendMpvCommand(["set_property", "pause", false]);
    void sendMpvCommand(["set_property", "speed", Number(selectedSpeed) || 1.0]);
  }

  function getStreamsPath() {
    if (!query?.type || !query?.id) return null;
    const next = new URLSearchParams({ type: query.type, id: query.id });
    if (query.season) next.set("season", String(query.season));
    if (query.episode) next.set("ep", String(query.episode));
    next.set("fromPlayer", "1");
    return `/episode?${next.toString()}`;
  }

  function getDetailPath() {
    if (!query?.type || !query?.id) return null;
    return `/detail/${encodeURIComponent(query.type)}/${encodeURIComponent(query.id)}`;
  }

  function goBack() {
    leavingPlayerRef.current = true;
    setIsLeavingPlayer(true);
    setMpvStatus(null);
    // Atrás SIEMPRE lleva a la page detail del medio que se estaba viendo
    // (no a pickstreams), tal como pide la UX.
    const detailPath = getDetailPath();
    const streamsPath = getStreamsPath();
    saveCurrentProgressNow("goBack");
    sendCurrentTraktPlaybackEvent(shouldStopTraktPlayback() ? "stop" : "pause");
    void stopNativePlayback()
      .finally(() => {
        if (detailPath) {
          navigate(detailPath, { replace: true });
          return;
        }
        if (streamsPath) {
          navigate(streamsPath, { replace: true });
          return;
        }
        navigate(-1);
      });
  }

  function selectSource(nextStream: MediaStream) {
    if (nextStream.id === stream?.id) {
      setActiveSidePanel(null);
      return;
    }
    const resumeTime = currentTimeRef.current;
    saveCurrentProgressNow("changeSource");
    setSelectedResumeTime(resumeTime);
    try {
      const rawMeta = sessionStorage.getItem(SELECTED_MEDIA_META_KEY);
      const mediaMeta = rawMeta ? JSON.parse(rawMeta) as Record<string, unknown> : {};
      sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
        ...mediaMeta,
        resumeTime,
      }));
      sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(nextStream));
    } catch {
      sessionStorage.setItem(SELECTED_STREAM_KEY, JSON.stringify(nextStream));
    }
    const directFallbacks = availableStreams
      .filter(candidate => (
        candidate.id !== nextStream.id
        && getStreamKind(candidate) === "https"
        && candidate.behaviorHints?.scraperPlayback !== "iframe"
      ))
      .slice(0, 6);
    directFallbacksRef.current = directFallbacks;
    const nextTarget = getPlaybackTarget(nextStream);
    attemptedDirectTargetsRef.current = new Set(nextTarget ? [nextTarget] : []);
    sessionStorage.setItem(DIRECT_STREAM_FALLBACKS_KEY, JSON.stringify(directFallbacks));
    console.info("[AETHERIO:SOURCE-PANEL] switching source", {
      from: stream?.addonName ?? stream?.name,
      to: nextStream.addonName ?? nextStream.name,
      resumeTime,
    });
    setActiveSidePanel(null);
    setStream(nextStream);
  }

  function navigateEpisode(direction: "prev" | "next") {
    if (!query?.season || !query.episode) return;
    const currentIndex = episodeOptions.findIndex(episode => episode.episode === query.episode);
    if (currentIndex === -1) return;
    const nextEpisode = episodeOptions[currentIndex + (direction === "next" ? 1 : -1)];
    if (!nextEpisode) return;
    if (direction === "next" && stream && playbackPreferences.preferBingeGroup) {
      sessionStorage.setItem(AUTO_NEXT_SOURCE_KEY, JSON.stringify({
        addonId: stream.addonId,
        addonName: stream.addonName,
        name: stream.name,
        title: stream.title,
        bingeGroup: stream.behaviorHints?.bingeGroup,
      }));
    } else {
      sessionStorage.removeItem(AUTO_NEXT_SOURCE_KEY);
    }
    saveCurrentProgressNow(`navigate-${direction}`);
    sendCurrentTraktPlaybackEvent(shouldStopTraktPlayback() ? "stop" : "pause");
    void stopNativePlayback().finally(() => {
      const autoplay = direction === "next" ? "&autoplay=1" : "";
      navigate(`/episode?type=${query.type}&id=${encodeURIComponent(query.id)}&season=${nextEpisode.season}&ep=${nextEpisode.episode}${autoplay}`);
    });
  }

  function handleScreenClick(event: MouseEvent<HTMLDivElement>) {
    if (showUpNext) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-player-interactive]")) return;
    if (ignoreNextScreenClickRef.current) {
      ignoreNextScreenClickRef.current = false;
      return;
    }
    if (Date.now() - launchStartedAtRef.current < 1200) return;
    wakeControls();
    if (!showFallbackPanel && mpvReadyForCommands && playbackStarted) {
      togglePlay();
    }
  }

  function startHoldToAccelerate(event: PointerEvent<HTMLDivElement>) {
    if (showUpNext) return;
    wakeControls();
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-player-interactive]")) return;
    if (!playbackPreferences.holdToAccelerate || showFallbackPanel || manualPaused || !mpvReadyForCommands || !playbackStarted) return;
    if (holdSpeedTimerRef.current !== null) window.clearTimeout(holdSpeedTimerRef.current);
    holdSpeedTimerRef.current = window.setTimeout(() => {
      holdSpeedTimerRef.current = null;
      holdSpeedActiveRef.current = true;
      ignoreNextScreenClickRef.current = true;
      holdSpeedRestoreRef.current = Number(selectedSpeed) || 1;
      void sendMpvCommand(["set_property", "speed", playbackPreferences.holdToAccelerateSpeed]);
    }, 260);
  }

  function stopHoldToAccelerate() {
    if (holdSpeedTimerRef.current !== null) {
      window.clearTimeout(holdSpeedTimerRef.current);
      holdSpeedTimerRef.current = null;
    }
    if (!holdSpeedActiveRef.current) return;
    holdSpeedActiveRef.current = false;
    void sendMpvCommand(["set_property", "speed", holdSpeedRestoreRef.current]);
  }

  function startSpaceAcceleration() {
    if (
      !playbackPreferences.holdToAccelerate
      || showFallbackPanel
      || manualPaused
      || !mpvReadyForCommands
      || !playbackStarted
    ) {
      return false;
    }
    holdSpeedRestoreRef.current = Number(selectedSpeed) || 1;
    void sendMpvCommand(["set_property", "speed", playbackPreferences.holdToAccelerateSpeed]);
    return true;
  }

  function stopSpaceAcceleration() {
    void sendMpvCommand(["set_property", "speed", holdSpeedRestoreRef.current]);
  }

  useEffect(() => {
    if (!stream || isIframeStream) return;
    const launchKey = getPlaybackTarget(stream);
    if (mpvLaunchKeyRef.current === launchKey) return;
    let cancelled = false;

    mpvLaunchKeyRef.current = launchKey;
    mpvRecoveryKeyRef.current = "";
    launchStartedAtRef.current = Date.now();
    lastProgressTimeRef.current = 0;
    lastProgressAtRef.current = Date.now();
    currentTimeRef.current = 0;
    lastContinueSaveAtRef.current = 0;
    resumeSeekAppliedRef.current = "";
    resumeSeekAttemptsRef.current = 0;
    resumeSeekTargetRef.current = Math.max(getResumeStartTime(query), selectedResumeTime, readSelectedMediaResumeTime());
    savedAudioRestoreKeyRef.current = "";
    savedAudioRestoreAttemptsRef.current = 0;
    if (savedAudioRestoreTimerRef.current) {
      window.clearTimeout(savedAudioRestoreTimerRef.current);
      savedAudioRestoreTimerRef.current = null;
    }
    resumeSeekSettledRef.current = resumeSeekTargetRef.current < 12;
    resumeSeekStartedAtRef.current = 0;
    resumeLog("session init", {
      streamId: stream.id,
      source: stream.addonName ?? stream.name,
      resumeTargetFromStorage: resumeSeekTargetRef.current,
      resumeWillSeek: !resumeSeekSettledRef.current,
    });
    if (resumeSeekTimerRef.current) {
      window.clearTimeout(resumeSeekTimerRef.current);
      resumeSeekTimerRef.current = null;
    }
    mpvFileLoadedAtRef.current = 0;
    startupKickCountRef.current = 0;
    setStalledPlayback(false);
    setPlaybackStarted(false);
    startupGateActiveRef.current = !androidPlayback && !stream.ytId;
    startupGatePausedRef.current = false;
    startupGateStartedAtRef.current = Date.now();
    startupGateLastAudioApplyAtRef.current = 0;
    autoAudioAppliedRef.current = false;
    autoSubtitleAppliedRef.current = false;
    manualAudioSelectionRef.current = false;
    manualSubtitleSelectionRef.current = false;
    const hasOverrideAudioSelection = Boolean(selectedPlaybackOverrides?.selectedAudioLanguage || selectedPlaybackOverrides?.selectedAudio);
    const hasOverrideSubtitleSelection = Boolean(selectedPlaybackOverrides?.forceSubtitleSelection);
    const hasResumeAudioSelection = hasOverrideAudioSelection || Boolean(savedAudioSelection || (resumeEntry && Object.prototype.hasOwnProperty.call(resumeEntry, "selectedAudio")));
    const hasResumeSubtitleSelection = hasOverrideSubtitleSelection || Boolean(resumeEntry && Object.prototype.hasOwnProperty.call(resumeEntry, "selectedSubtitle"));
    desiredAudioSelectionRef.current = selectedPlaybackOverrides?.selectedAudio ?? savedAudioSelection?.value ?? resumeEntry?.selectedAudio ?? "";
    desiredSubtitleSelectionRef.current = hasOverrideSubtitleSelection ? selectedPlaybackOverrides?.selectedSubtitle ?? "" : resumeEntry?.selectedSubtitle ?? "";
    desiredAudioSelectionSetRef.current = hasResumeAudioSelection;
    desiredSubtitleSelectionSetRef.current = hasResumeSubtitleSelection;
    autoAudioAttemptsRef.current = 0;
    autoSubtitleAttemptsRef.current = 0;
    if (autoAudioTimerRef.current) {
      window.clearTimeout(autoAudioTimerRef.current);
      autoAudioTimerRef.current = null;
    }
    if (autoSubtitleTimerRef.current) {
      window.clearTimeout(autoSubtitleTimerRef.current);
      autoSubtitleTimerRef.current = null;
    }
    setMpvReadyForCommands(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    setManualPaused(false);
    manualPausedRef.current = false;
    setMpvStatus(androidPlayback
      ? "Abriendo reproductor Android TV..."
      : isP2pStream
        ? "Preparando stream P2P..."
        : "Abriendo MPV...");
    debugLog("native playback open called", {
      streamId: stream.id,
      source: stream.addonName ?? stream.name,
      kind: getStreamKind(stream),
      androidPlayback,
    });

    const resumeStartTime = resumeSeekTargetRef.current;
    void openExternal(stream, undefined, resumeStartTime, query?.episode).then(({ error }) => {
      if (cancelled || leavingPlayerRef.current) return;
      setPlaying(false);
      setMpvReadyForCommands(!error);
      setManualPaused(false);
      manualPausedRef.current = false;
      setMpvStatus(error ? `${androidPlayback ? "Android TV" : "MPV"} no inicio: ${error}` : null);
      if (!error) {
        if (androidPlayback) {
          startupGateActiveRef.current = false;
          setMpvFileLoaded(true);
          setPlaybackStarted(true);
          setPlaying(true);
        } else {
          void sendMpvCommand(["set_property", "pause", startupGateActiveRef.current]);
          applyVideoScale(videoScaleMode);
        }
      }
      debugLog(error ? "native playback open error" : "native playback open resolved", { error, androidPlayback });
    });

    return () => {
      cancelled = true;
      if (resumeSeekTimerRef.current) {
        window.clearTimeout(resumeSeekTimerRef.current);
        resumeSeekTimerRef.current = null;
      }
      if (savedAudioRestoreTimerRef.current) {
        window.clearTimeout(savedAudioRestoreTimerRef.current);
        savedAudioRestoreTimerRef.current = null;
      }
      resumeSeekSettledRef.current = true;
      resumeSeekTargetRef.current = 0;
      resumeSeekStartedAtRef.current = 0;
      setPlaying(false);
      setMpvReadyForCommands(false);
      setManualPaused(false);
      manualPausedRef.current = false;
      mpvLaunchKeyRef.current = "";
      mpvRecoveryKeyRef.current = "";
      setStalledPlayback(false);
      setMpvStatus(null);
      void stopNativePlayback();
    };
  }, [
    androidPlayback,
    isIframeStream,
    query,
    selectedPlaybackOverrides?.forceSubtitleSelection,
    selectedPlaybackOverrides?.selectedAudio,
    selectedPlaybackOverrides?.selectedAudioLanguage,
    selectedPlaybackOverrides?.selectedSubtitle,
    selectedResumeTime,
    stream,
  ]);

  useEffect(() => {
    if (!query?.type || !query?.id) return;
    const returnPath = (trailerRequested || isTrailerStream) ? getDetailPath() : getStreamsPath();
    if (!returnPath) return;
    window.history.pushState({ aetherioPlayerBackGuard: true }, "");

    const onPopState = () => {
      leavingPlayerRef.current = true;
      setIsLeavingPlayer(true);
      setMpvStatus(null);
      void stopNativePlayback()
        .finally(() => navigate(returnPath, { replace: true }));
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [isTrailerStream, navigate, query?.episode, query?.id, query?.season, query?.type, trailerRequested]);

  useEffect(() => {
    if (!playbackStarted || !mpvReadyForCommands || !subtitlesReady || !subtitleOptions.length) return;
    if (manualSubtitleSelectionRef.current) {
      autoLangLog("subtitle skipped: manual selection");
      return;
    }
    const overrideSubtitleWasStored = Boolean(selectedPlaybackOverrides?.forceSubtitleSelection);
    const resumeSubtitleWasStored = overrideSubtitleWasStored || Boolean(resumeEntry && Object.prototype.hasOwnProperty.call(resumeEntry, "selectedSubtitle"));
    const resumeSubtitle = overrideSubtitleWasStored ? selectedPlaybackOverrides?.selectedSubtitle ?? "" : resumeEntry?.selectedSubtitle ?? "";
    const resumeSubtitleExists = Boolean(resumeSubtitle) && subtitleOptions.some(option => option.value === resumeSubtitle);
    const preferredSubtitleLanguages = [
      resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage),
      resolvePreferredLanguage(playbackPreferences.secondSubtitleLanguage, originalLanguage),
    ];
    const preferredFromSettings = pickInitialTrackOptionFromLanguages(subtitleOptions, preferredSubtitleLanguages);
    if (resumeSubtitleWasStored && !resumeSubtitle) {
      autoSubtitleAppliedRef.current = true;
      desiredSubtitleSelectionRef.current = "";
      desiredSubtitleSelectionSetRef.current = true;
      if (selectedMpvSubtitle) {
        setSelectedMpvSubtitle("");
        void sendMpvCommand(["set_property", "sid", "no"]);
      }
      autoLangLog("subtitle restored: none");
      return;
    }
    const targetSubtitle = overrideSubtitleWasStored
      ? (resumeSubtitleExists ? resumeSubtitle : "")
      : preferredFromSettings?.value ?? (resumeSubtitleExists ? resumeSubtitle : "");
    if (!targetSubtitle) {
      autoSubtitleAppliedRef.current = true;
      autoLangLog("subtitle no target", { preferredLanguage: preferredSubtitleLanguages.filter(Boolean).join(","), options: subtitleOptions.length });
      return;
    }
    if (selectedMpvSubtitle === targetSubtitle) {
      autoSubtitleAppliedRef.current = true;
      autoLangLog("subtitle already applied", { targetSubtitle, attempts: autoSubtitleAttemptsRef.current });
      return;
    }
    if (autoSubtitleAttemptsRef.current >= 8) {
      autoLangLog("subtitle max attempts reached", { targetSubtitle, attempts: autoSubtitleAttemptsRef.current });
      return;
    }
    autoSubtitleAttemptsRef.current += 1;
    autoSubtitleAppliedRef.current = false;
    autoLangLog("subtitle apply", {
      preferredLanguage: preferredSubtitleLanguages.filter(Boolean).join(","),
      resumeSubtitle,
      targetSubtitle,
      attempt: autoSubtitleAttemptsRef.current,
      options: subtitleOptions.slice(0, 6).map(option => option.label),
    });
    setSelectedMpvSubtitle(targetSubtitle);
    desiredSubtitleSelectionRef.current = targetSubtitle;
    desiredSubtitleSelectionSetRef.current = true;
    if (targetSubtitle.startsWith("track:")) {
      void sendMpvCommand(["set_property", "sid", Number(targetSubtitle.slice(6))]);
    } else if (targetSubtitle.startsWith("ext:")) {
      applyExternalSubtitle(targetSubtitle.slice(4));
    }
    if (autoSubtitleTimerRef.current) window.clearTimeout(autoSubtitleTimerRef.current);
    autoSubtitleTimerRef.current = window.setTimeout(() => {
      autoSubtitleTimerRef.current = null;
      if (manualSubtitleSelectionRef.current) return;
      if (selectedMpvSubtitleRef.current === targetSubtitle) return;
      if (autoSubtitleAttemptsRef.current >= 8) {
        autoLangLog("subtitle retry blocked: max attempts", { targetSubtitle, attempts: autoSubtitleAttemptsRef.current });
        return;
      }
      autoSubtitleAttemptsRef.current += 1;
      autoLangLog("subtitle retry", { targetSubtitle, attempt: autoSubtitleAttemptsRef.current });
      if (targetSubtitle.startsWith("track:")) {
        void sendMpvCommand(["set_property", "sid", Number(targetSubtitle.slice(6))]);
      } else if (targetSubtitle.startsWith("ext:")) {
        applyExternalSubtitle(targetSubtitle.slice(4));
      }
    }, 380);
  }, [
    mpvReadyForCommands,
    originalLanguage,
    playbackPreferences.preferredSubtitleLanguage,
    playbackPreferences.secondSubtitleLanguage,
    playbackStarted,
    resumeEntry?.selectedSubtitle,
    selectedPlaybackOverrides?.forceSubtitleSelection,
    selectedPlaybackOverrides?.selectedSubtitle,
    selectedMpvSubtitle,
    subtitleOptions,
    subtitlesReady,
    applySubtitleSettings,
    applyExternalSubtitle,
  ]);

  useEffect(() => {
    if (!mpvReadyForCommands || !mpvFileLoaded || !audioOptions.length) return;
    if (manualAudioSelectionRef.current) {
      autoLangLog("audio skipped: manual selection");
      return;
    }
    const overrideAudioLanguage = resolvePreferredLanguage(selectedPlaybackOverrides?.selectedAudioLanguage ?? "", originalLanguage);
    const resumeAudio = selectedPlaybackOverrides?.selectedAudio ?? savedAudioSelection?.value ?? resumeEntry?.selectedAudio ?? "";
    const storedAudio = pickStoredTrackOption(audioOptions, {
      value: resumeAudio,
      label: selectedPlaybackOverrides?.selectedAudioLabel ?? savedAudioSelection?.label ?? resumeEntry?.selectedAudioLabel,
      language: overrideAudioLanguage || savedAudioSelection?.language || resumeEntry?.selectedAudioLanguage,
      trackLang: savedAudioSelection?.trackLang,
      trackTitle: savedAudioSelection?.trackTitle,
    });
    const targetAudio = storedAudio?.value
      ? storedAudio.value
      : (pickInitialAudioTrack(
          mpvTracks,
          [
            resolvePreferredLanguage(playbackPreferences.firstAudioLanguage, originalLanguage),
            resolvePreferredLanguage(playbackPreferences.secondAudioLanguage, originalLanguage),
          ],
          audioOptions,
        )?.value ?? "");
    if (!targetAudio.startsWith("track:")) {
      autoAudioAppliedRef.current = true;
      autoLangLog("audio no target", {
        options: audioOptions.length,
        preferredResolved: [
          resolvePreferredLanguage(playbackPreferences.firstAudioLanguage, originalLanguage),
          resolvePreferredLanguage(playbackPreferences.secondAudioLanguage, originalLanguage),
        ],
        trackLangs: mpvTracks.map(track => `${track.id}:${track.lang ?? ""}:${track.title ?? ""}`),
      });
      return;
    }
    if (selectedMpvAudio === targetAudio) {
      autoAudioAppliedRef.current = true;
      autoLangLog("audio already applied", { targetAudio, attempts: autoAudioAttemptsRef.current });
      return;
    }
    if (autoAudioAttemptsRef.current >= 8) {
      autoLangLog("audio max attempts reached", { targetAudio, attempts: autoAudioAttemptsRef.current });
      return;
    }
    autoAudioAttemptsRef.current += 1;
    autoAudioAppliedRef.current = false;
    autoLangLog("audio apply", {
      resumeAudio,
      resumeAudioLabel: selectedPlaybackOverrides?.selectedAudioLabel ?? savedAudioSelection?.label ?? resumeEntry?.selectedAudioLabel,
      resumeAudioLanguage: overrideAudioLanguage || savedAudioSelection?.language || resumeEntry?.selectedAudioLanguage,
      resumeAudioTrackLang: savedAudioSelection?.trackLang,
      resumeAudioTrackTitle: savedAudioSelection?.trackTitle,
      targetAudio,
      attempt: autoAudioAttemptsRef.current,
      options: audioOptions.slice(0, 6).map(option => option.label),
    });
    setSelectedMpvAudio(targetAudio);
    desiredAudioSelectionRef.current = targetAudio;
    desiredAudioSelectionSetRef.current = true;
    void sendMpvCommand(["set_property", "aid", Number(targetAudio.slice(6))]);
    if (autoAudioTimerRef.current) window.clearTimeout(autoAudioTimerRef.current);
    autoAudioTimerRef.current = window.setTimeout(() => {
      autoAudioTimerRef.current = null;
      if (manualAudioSelectionRef.current) return;
      if (selectedMpvAudioRef.current === targetAudio) return;
      if (autoAudioAttemptsRef.current >= 8) {
        autoLangLog("audio retry blocked: max attempts", { targetAudio, attempts: autoAudioAttemptsRef.current });
        return;
      }
      autoAudioAttemptsRef.current += 1;
      autoLangLog("audio retry", { targetAudio, attempt: autoAudioAttemptsRef.current });
      void sendMpvCommand(["set_property", "aid", Number(targetAudio.slice(6))]);
    }, 380);
  }, [
    audioOptions,
    mpvTracks,
    mpvFileLoaded,
    mpvReadyForCommands,
    originalLanguage,
    playbackPreferences.firstAudioLanguage,
    playbackPreferences.secondAudioLanguage,
    resumeEntry?.selectedAudio,
    resumeEntry?.selectedAudioLabel,
    resumeEntry?.selectedAudioLanguage,
    savedAudioSelection?.label,
    savedAudioSelection?.language,
    savedAudioSelection?.trackLang,
    savedAudioSelection?.trackTitle,
    savedAudioSelection?.value,
    selectedPlaybackOverrides?.selectedAudio,
    selectedPlaybackOverrides?.selectedAudioLabel,
    selectedPlaybackOverrides?.selectedAudioLanguage,
    selectedMpvAudio,
  ]);

  useEffect(() => {
    if (
      !mpvReadyForCommands ||
      !mpvFileLoaded ||
      !audioOptions.length ||
      !savedAudioSelection ||
      selectedPlaybackOverrides?.selectedAudioLanguage ||
      selectedPlaybackOverrides?.selectedAudio
    ) return;
    const storedAudio = pickStoredTrackOption(audioOptions, {
      value: savedAudioSelection.value,
      label: savedAudioSelection.label,
      language: savedAudioSelection.language,
      trackLang: savedAudioSelection.trackLang,
      trackTitle: savedAudioSelection.trackTitle,
    });
    const targetAudio = storedAudio?.value ?? "";
    if (!targetAudio.startsWith("track:")) return;

    const restoreKey = [
      query?.type,
      query?.id,
      query?.season ?? "",
      query?.episode ?? "",
      targetAudio,
      savedAudioSelection.updatedAt,
    ].join(":");
    if (savedAudioRestoreKeyRef.current !== restoreKey) {
      savedAudioRestoreKeyRef.current = restoreKey;
      savedAudioRestoreAttemptsRef.current = 0;
    }
    if (savedAudioRestoreAttemptsRef.current >= 10) return;
    if (selectedMpvAudioRef.current === targetAudio && savedAudioRestoreAttemptsRef.current > 0) return;

    const applySavedAudio = () => {
      if (savedAudioRestoreAttemptsRef.current >= 10) return;
      savedAudioRestoreAttemptsRef.current += 1;
      autoLangLog("saved audio restore enforce", {
        targetAudio,
        attempt: savedAudioRestoreAttemptsRef.current,
        savedAudio: savedAudioSelection.value,
        savedAudioLabel: savedAudioSelection.label,
        savedAudioLanguage: savedAudioSelection.language,
        selectedAudio: selectedMpvAudioRef.current,
      });
      setSelectedMpvAudio(targetAudio);
      desiredAudioSelectionRef.current = targetAudio;
      desiredAudioSelectionSetRef.current = true;
      void sendMpvCommand(["set_property", "aid", Number(targetAudio.slice(6))]);
      if (savedAudioRestoreAttemptsRef.current < 4 && selectedMpvAudioRef.current !== targetAudio) {
        savedAudioRestoreTimerRef.current = window.setTimeout(applySavedAudio, 700);
      }
    };

    if (savedAudioRestoreTimerRef.current) {
      window.clearTimeout(savedAudioRestoreTimerRef.current);
      savedAudioRestoreTimerRef.current = null;
    }
    applySavedAudio();
  }, [
    audioOptions,
    mpvFileLoaded,
    mpvReadyForCommands,
    query?.episode,
    query?.id,
    query?.season,
    query?.type,
    savedAudioSelection,
    selectedPlaybackOverrides?.selectedAudio,
    selectedPlaybackOverrides?.selectedAudioLanguage,
    selectedMpvAudio,
  ]);

  useEffect(() => {
    if (!startupGateActiveRef.current || !mpvReadyForCommands) return;

    const overrideSubtitleWasStored = Boolean(selectedPlaybackOverrides?.forceSubtitleSelection);
    const resumeSubtitleWasStored = overrideSubtitleWasStored || Boolean(resumeEntry && Object.prototype.hasOwnProperty.call(resumeEntry, "selectedSubtitle"));
    const resumeSubtitle = overrideSubtitleWasStored ? selectedPlaybackOverrides?.selectedSubtitle ?? "" : resumeEntry?.selectedSubtitle ?? "";
    const overrideAudioLanguage = resolvePreferredLanguage(selectedPlaybackOverrides?.selectedAudioLanguage ?? "", originalLanguage);
    const resumeAudio = selectedPlaybackOverrides?.selectedAudio ?? savedAudioSelection?.value ?? resumeEntry?.selectedAudio ?? "";
    const storedAudio = pickStoredTrackOption(audioOptions, {
      value: resumeAudio,
      label: selectedPlaybackOverrides?.selectedAudioLabel ?? savedAudioSelection?.label ?? resumeEntry?.selectedAudioLabel,
      language: overrideAudioLanguage || savedAudioSelection?.language || resumeEntry?.selectedAudioLanguage,
      trackLang: savedAudioSelection?.trackLang,
      trackTitle: savedAudioSelection?.trackTitle,
    });
    const preferredSubtitleLanguages = [
      resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage),
      resolvePreferredLanguage(playbackPreferences.secondSubtitleLanguage, originalLanguage),
    ];
    const preferredSubtitleFromSettings = pickInitialTrackOptionFromLanguages(subtitleOptions, preferredSubtitleLanguages);
    const preferredSubtitle = overrideSubtitleWasStored
      ? (resumeSubtitle && subtitleOptions.some(option => option.value === resumeSubtitle) ? { value: resumeSubtitle, label: resumeSubtitle } : null)
      : preferredSubtitleFromSettings
      ? preferredSubtitleFromSettings
      : resumeSubtitleWasStored && !resumeSubtitle
      ? null
      : resumeSubtitle && subtitleOptions.some(option => option.value === resumeSubtitle)
      ? { value: resumeSubtitle, label: resumeSubtitle }
      : null;
    const preferredAudio = storedAudio
      ? storedAudio
      : pickInitialAudio(audioOptions, [
          resolvePreferredLanguage(playbackPreferences.firstAudioLanguage, originalLanguage),
          resolvePreferredLanguage(playbackPreferences.secondAudioLanguage, originalLanguage),
        ]);

    if (!startupGatePausedRef.current) {
      startupGatePausedRef.current = true;
      autoLangLog("startup gate observe");
    }

    const audioSettled = !mpvFileLoaded
      ? false
      : !preferredAudio?.value
        ? true
        : selectedMpvAudioRef.current === preferredAudio.value || autoAudioAttemptsRef.current >= 8;

    const preferredSubtitleValue = preferredSubtitle?.value ?? "";
    const subtitleSettled = !preferredSubtitleValue
        ? true
        : preferredSubtitleValue.startsWith("ext:")
          ? selectedMpvSubtitleRef.current === preferredSubtitleValue ||
            (autoSubtitleAttemptsRef.current > 0 && selectedMpvSubtitleRef.current.startsWith("track:")) ||
            autoSubtitleAttemptsRef.current >= 4
          : selectedMpvSubtitleRef.current === preferredSubtitleValue || autoSubtitleAttemptsRef.current >= 8;

    const audioTargetExists = Boolean(preferredAudio?.value?.startsWith("track:"));
    const subtitleTargetExists = Boolean(preferredSubtitle?.value);

    if (!audioSettled && audioTargetExists && autoAudioAttemptsRef.current < 12) {
      const now = Date.now();
      if (now - startupGateLastAudioApplyAtRef.current > 340) {
        startupGateLastAudioApplyAtRef.current = now;
        autoAudioAttemptsRef.current += 1;
        autoLangLog("startup gate audio enforce", {
          attempt: autoAudioAttemptsRef.current,
          selectedAudio: selectedMpvAudioRef.current,
          targetAudio: preferredAudio?.value ?? "",
        });
        void sendMpvCommand(["set_property", "aid", Number((preferredAudio?.value ?? "").slice(6))]);
      }
    }
    if (!subtitleSettled && subtitleTargetExists && autoSubtitleAttemptsRef.current < 12) {
      autoSubtitleAttemptsRef.current += 1;
      const targetSubtitle = preferredSubtitle?.value ?? "";
      autoLangLog("startup gate subtitle enforce", {
        attempt: autoSubtitleAttemptsRef.current,
        selectedSubtitle: selectedMpvSubtitleRef.current,
        targetSubtitle,
      });
      desiredSubtitleSelectionRef.current = targetSubtitle;
      desiredSubtitleSelectionSetRef.current = true;
      if (targetSubtitle.startsWith("track:")) {
        void sendMpvCommand(["set_property", "sid", Number(targetSubtitle.slice(6))]);
      } else if (targetSubtitle.startsWith("ext:")) {
        setSelectedMpvSubtitle(targetSubtitle);
        applyExternalSubtitle(targetSubtitle.slice(4));
      }
    }

    const hardTimedOut = Date.now() - startupGateStartedAtRef.current > startupGateTimeoutMs;
    const mustHoldForFileLoad = !mpvFileLoaded && !hardTimedOut;
    const mustHoldForAudio = audioTargetExists && !audioSettled;
    const mustHoldForSubtitle = subtitleTargetExists && !subtitleSettled;
    const timedOut = hardTimedOut && !mustHoldForAudio && !mustHoldForSubtitle;
    if (mustHoldForFileLoad || mustHoldForAudio || mustHoldForSubtitle) return;

    startupGateActiveRef.current = false;
    startupGatePausedRef.current = false;
    autoLangLog("startup gate release", {
      audioSettled,
      subtitleSettled,
      audioTargetExists,
      subtitleTargetExists,
      fileLoadPending: mustHoldForFileLoad,
      audioDiscoveryPending: false,
      subtitleDiscoveryPending: false,
      timedOut,
      selectedAudio: selectedMpvAudioRef.current,
      selectedSubtitle: selectedMpvSubtitleRef.current,
      targetAudio: preferredAudio?.value ?? "",
      targetSubtitle: preferredSubtitle?.value ?? "",
      resumeAudio,
      resumeSubtitle,
    });
    if (!manualPausedRef.current) {
      setPlaying(true);
      lastProgressAtRef.current = Date.now();
      void sendMpvCommand(["set_property", "pause", false]);
    }
  }, [
    audioOptions,
    mpvFileLoaded,
    mpvReadyForCommands,
    originalLanguage,
    playbackPreferences.firstAudioLanguage,
    playbackPreferences.preferredSubtitleLanguage,
    playbackPreferences.secondAudioLanguage,
    playbackPreferences.secondSubtitleLanguage,
    resumeEntry?.selectedAudio,
    resumeEntry?.selectedAudioLabel,
    resumeEntry?.selectedAudioLanguage,
    savedAudioSelection?.label,
    savedAudioSelection?.language,
    savedAudioSelection?.trackLang,
    savedAudioSelection?.trackTitle,
    savedAudioSelection?.value,
    resumeEntry?.selectedSubtitle,
    selectedPlaybackOverrides?.forceSubtitleSelection,
    selectedPlaybackOverrides?.selectedAudio,
    selectedPlaybackOverrides?.selectedAudioLabel,
    selectedPlaybackOverrides?.selectedAudioLanguage,
    selectedPlaybackOverrides?.selectedSubtitle,
    selectedMpvAudio,
    selectedMpvSubtitle,
    subtitleOptions,
    subtitlesReady,
    startupGateTimeoutMs,
    applyExternalSubtitle,
  ]);

  useEffect(() => {
    if (!stream || !mpvFileLoaded || manualPaused) return;
    const launchKey = getPlaybackTarget(stream);
    if (!launchKey || mpvRecoveryKeyRef.current === launchKey) return;
    if (playbackStarted || mpvPausedForCache || (mpvCacheBuffering > 0 && mpvCacheBuffering < 100)) return;
    if (!stalledPlayback || currentTimeRef.current >= 1.5) return;

    mpvRecoveryKeyRef.current = launchKey;
    debugLog("mpv stalled recovery", { streamId: stream.id, source: stream.addonName ?? stream.name });
    if (manualPausedRef.current) return;
    void sendMpvCommand(["set_property", "pause", false]);
    void sendMpvCommand(["set_property", "speed", 1.0]);
  }, [manualPaused, mpvCacheBuffering, mpvFileLoaded, mpvPausedForCache, playbackStarted, stalledPlayback, stream]);
  usePlayerKeyboardShortcuts({
    togglePlay,
    jump,
    applyVolume,
    wakeControls,
    startSpaceAcceleration,
    stopSpaceAcceleration,
    volume,
    enabled: !showUpNext,
  });
  const controlsActive = controlsVisible || activeSidePanel !== null;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aetherio-player-controls", { detail: { visible: controlsActive } }));
    return () => {
      window.dispatchEvent(new CustomEvent("aetherio-player-controls", { detail: { visible: true } }));
    };
  }, [controlsActive]);

const mediaTitle = selectedMediaName || resumeEntry?.name || query?.id || "Reproducción";
const { activeSegment: activeSkipSegment, creditsSegment: upNextCreditsSegment } = useSkipIntro(query, mediaTitle, currentTime, {
  enabled: playbackPreferences.skipSegmentsEnabled,
  animeSkipEnabled: playbackPreferences.animeSkipEnabled,
});
const playbackTarget = getPlaybackTarget(stream);
const currentEpisodeIndex = episodeOptions.findIndex(episode => episode.episode === query?.episode);
const canGoPrevEpisode = currentEpisodeIndex > 0;
const canGoNextEpisode = currentEpisodeIndex >= 0 && currentEpisodeIndex < episodeOptions.length - 1;
const isMovie = query?.type === "movie";
const showPanelToggle = !isMovie && panelItems.length > 0;

function buildTraktEntrySnapshot(): ContinueWatchingEntry | null {
  if (!query || !stream || isTrailerStream) return null;
  const current = Math.max(0, currentTimeRef.current);
  const totalDuration = Math.max(0, durationRef.current);
  const completed = totalDuration > 0 && (current / totalDuration >= 0.92 || totalDuration - current <= 90);
  const behaviorBackground = typeof stream.behaviorHints?.background === "string" ? stream.behaviorHints.background : "";
  const behaviorPoster = typeof stream.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : "";
  const background = !isMovie && currentEpisode?.still
    ? currentEpisode.still
    : selectedMediaBackground || behaviorBackground || behaviorPoster || undefined;
  return {
    key: buildContinueWatchingKey(query),
    mediaKey: buildMediaKey(query.type, query.id),
    type: query.type,
    id: query.id,
    name: mediaTitle,
    logo: sanitizeLogoUrl(selectedMediaLogo || detailLogoUrl || addonLogoUrl || seriesLogoUrl) || undefined,
    background,
    poster: behaviorPoster || undefined,
    episodeStill: !isMovie ? currentEpisode?.still : undefined,
    season: query.season,
    episode: query.episode,
    episodeName: currentEpisode?.name,
    currentTime: current,
    duration: totalDuration,
    updatedAt: Date.now(),
    completed,
    source: "local",
    streamId: stream.id,
    streamName: stream.title ?? stream.name,
  };
}

function sendCurrentTraktPlaybackEvent(action: "start" | "pause" | "stop") {
  const entry = buildTraktEntrySnapshot();
  if (!entry) return;
  void sendTraktScrobble(action, entry);
}

function saveUpcomingEpisodePrompt() {
  if (!query || isMovie || !canGoNextEpisode) return;
  const nextEpisode = episodeOptions[currentEpisodeIndex + 1];
  if (!nextEpisode) return;
  const promptKey = `${query.type}:${query.id}:${nextEpisode.season}:${nextEpisode.episode}`;
  if (nextEpisodePromptKeyRef.current === promptKey) return;
  nextEpisodePromptKeyRef.current = promptKey;
  saveNextEpisodePrompt({
    query: {
      type: query.type,
      id: query.id,
      season: nextEpisode.season,
      episode: nextEpisode.episode,
    },
    name: mediaTitle,
    logo: sanitizeLogoUrl(selectedMediaLogo || detailLogoUrl || addonLogoUrl || seriesLogoUrl) || undefined,
    background: nextEpisode.still || undefined,
    episodeStill: nextEpisode.still || undefined,
    poster: typeof stream?.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : undefined,
    episodeName: nextEpisode.name,
    entryKind: "next",
    source: "local",
  });
}

function saveCurrentProgressNow(reason: string) {
  if (!query || !stream || isTrailerStream) return null;
  const current = Math.max(currentTimeRef.current, currentTime);
  const totalDuration = Math.max(durationRef.current, duration);
  if (!current || current < 5) return null;
  const pendingResume = !resumeSeekSettledRef.current && resumeSeekTargetRef.current >= 12;
  if (pendingResume && current < Math.max(12, resumeSeekTargetRef.current - 2)) {
    resumeLog("save blocked: pending resume", { reason });
    return null;
  }

  const behaviorBackground = typeof stream.behaviorHints?.background === "string" ? stream.behaviorHints.background : "";
  const behaviorPoster = typeof stream.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : "";
  const continueBackground = isMovie
    ? selectedMediaBackground || behaviorBackground || behaviorPoster || undefined
    : currentEpisode?.still || selectedMediaBackground || behaviorBackground || behaviorPoster || undefined;
  const continuePoster = selectedMediaPoster || behaviorPoster || undefined;
  const savedEntry = saveContinueWatchingProgress({
    query,
    stream,
    name: mediaTitle,
    logo: sanitizeLogoUrl(selectedMediaLogo || detailLogoUrl || addonLogoUrl || seriesLogoUrl) || undefined,
    background: continueBackground,
    poster: continuePoster,
    episodeStill: !isMovie ? currentEpisode?.still : undefined,
    episodeName: currentEpisode?.name,
    currentTime: current,
    duration: totalDuration,
    selectedAudio: desiredAudioSelectionSetRef.current ? desiredAudioSelectionRef.current : selectedMpvAudioRef.current,
    selectedAudioLabel: audioSelectionMeta(desiredAudioSelectionSetRef.current ? desiredAudioSelectionRef.current : selectedMpvAudioRef.current).selectedAudioLabel,
    selectedAudioLanguage: audioSelectionMeta(desiredAudioSelectionSetRef.current ? desiredAudioSelectionRef.current : selectedMpvAudioRef.current).selectedAudioLanguage,
    selectedSubtitle: desiredSubtitleSelectionSetRef.current ? desiredSubtitleSelectionRef.current : selectedMpvSubtitleRef.current,
    selectedSubtitleLabel: subtitleSelectionMeta(desiredSubtitleSelectionSetRef.current ? desiredSubtitleSelectionRef.current : selectedMpvSubtitleRef.current).selectedSubtitleLabel,
    selectedSubtitleLanguage: subtitleSelectionMeta(desiredSubtitleSelectionSetRef.current ? desiredSubtitleSelectionRef.current : selectedMpvSubtitleRef.current).selectedSubtitleLanguage,
  });
  if (savedEntry?.completed) saveUpcomingEpisodePrompt();
  void syncTraktProgressEntry(savedEntry);
  resumeLog("progress saved", { reason });
  return savedEntry;
}

function shouldStopTraktPlayback() {
  const totalDuration = durationRef.current;
  if (!totalDuration || totalDuration < 60) return false;
  const current = currentTimeRef.current;
  return current / totalDuration >= 0.9 || totalDuration - current <= 90;
}

useEffect(() => {
  if (!playbackStarted || !query || !stream || isTrailerStream) return;
  const key = `${buildContinueWatchingKey(query)}:${stream.id}`;
  if (traktStartedKeyRef.current === key) return;
  traktStartedKeyRef.current = key;
  traktStoppedKeyRef.current = "";
  sendCurrentTraktPlaybackEvent("start");
}, [isTrailerStream, playbackStarted, query, stream]);

useEffect(() => {
  if (!manualPaused || !playbackStarted) return;
  sendCurrentTraktPlaybackEvent(shouldStopTraktPlayback() ? "stop" : "pause");
}, [manualPaused, playbackStarted]);

useEffect(() => {
  if (!playbackStarted || !query || !stream || isTrailerStream || !shouldStopTraktPlayback()) return;
  const key = `${buildContinueWatchingKey(query)}:${stream.id}`;
  if (traktStoppedKeyRef.current === key) return;
  traktStoppedKeyRef.current = key;
  saveUpcomingEpisodePrompt();
  sendCurrentTraktPlaybackEvent("stop");
}, [currentTime, isTrailerStream, playbackStarted, query, stream]);

useEffect(() => {
  if (!playbackStarted || manualPaused || !query || !stream || isTrailerStream) return;
  const interval = window.setInterval(() => {
    const entry = buildTraktEntrySnapshot();
    if (!entry) return;
    void sendTraktScrobble("start", entry);
  }, 12000);
  return () => window.clearInterval(interval);
}, [isTrailerStream, manualPaused, playbackStarted, query, stream]);

useEffect(() => () => {
  saveCurrentProgressNow("unmount");
  sendCurrentTraktPlaybackEvent(shouldStopTraktPlayback() ? "stop" : "pause");
}, [isTrailerStream, query?.episode, query?.id, query?.season, query?.type, stream?.id]);

useEffect(() => {
  if (!query || !stream || isTrailerStream) return;
  if (!currentTime || currentTime < 5) return;
  const pendingResume = !resumeSeekSettledRef.current && resumeSeekTargetRef.current >= 12;
  if (pendingResume && currentTime < Math.max(12, resumeSeekTargetRef.current - 2)) {
    resumeLog("save blocked: pending resume");
    return;
  }
  const now = Date.now();
  const sinceLastSaveMs = now - lastContinueSaveAtRef.current;
  const nearEnd = duration > 0 && currentTime >= duration - 3;
  if (now - lastContinueSaveAtRef.current < 5000 && !nearEnd) return;
  lastContinueSaveAtRef.current = now;
  const behaviorBackground = typeof stream.behaviorHints?.background === "string" ? stream.behaviorHints.background : "";
  const behaviorPoster = typeof stream.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : "";
  const continueBackground = isMovie
    ? selectedMediaBackground || behaviorBackground || behaviorPoster || undefined
    : currentEpisode?.still || selectedMediaBackground || behaviorBackground || behaviorPoster || undefined;
  const continuePoster = selectedMediaPoster || behaviorPoster || undefined;
  const savedEntry = saveContinueWatchingProgress({
    query,
    stream,
    name: mediaTitle,
    logo: sanitizeLogoUrl(selectedMediaLogo || detailLogoUrl || addonLogoUrl || seriesLogoUrl) || undefined,
    background: continueBackground,
    poster: continuePoster,
    episodeStill: !isMovie ? currentEpisode?.still : undefined,
    episodeName: currentEpisode?.name,
    currentTime,
    duration,
    selectedAudio: desiredAudioSelectionSetRef.current ? desiredAudioSelectionRef.current : selectedMpvAudioRef.current,
    selectedAudioLabel: audioSelectionMeta(desiredAudioSelectionSetRef.current ? desiredAudioSelectionRef.current : selectedMpvAudioRef.current).selectedAudioLabel,
    selectedAudioLanguage: audioSelectionMeta(desiredAudioSelectionSetRef.current ? desiredAudioSelectionRef.current : selectedMpvAudioRef.current).selectedAudioLanguage,
    selectedSubtitle: desiredSubtitleSelectionSetRef.current ? desiredSubtitleSelectionRef.current : selectedMpvSubtitleRef.current,
    selectedSubtitleLabel: subtitleSelectionMeta(desiredSubtitleSelectionSetRef.current ? desiredSubtitleSelectionRef.current : selectedMpvSubtitleRef.current).selectedSubtitleLabel,
    selectedSubtitleLanguage: subtitleSelectionMeta(desiredSubtitleSelectionSetRef.current ? desiredSubtitleSelectionRef.current : selectedMpvSubtitleRef.current).selectedSubtitleLanguage,
  });
  void syncTraktProgressEntry(savedEntry);
  resumeLog("progress saved", { nearEnd, saveIntervalMs: sinceLastSaveMs });
}, [
  addonLogoUrl,
  currentEpisode?.name,
  currentEpisode?.still,
  currentTime,
  detailLogoUrl,
  duration,
  isMovie,
  isTrailerStream,
  mediaTitle,
  query,
  selectedMediaBackground,
  selectedMediaLogo,
  selectedMediaPoster,
  seriesLogoUrl,
  stream,
]);

useEffect(() => {
  if (!query || !stream || isTrailerStream) return;
  if (!mpvReadyForCommands || !mpvFileLoaded) {
    resumeLog("resume waiting for mpv readiness");
    return;
  }
  const seekKey = `${buildContinueWatchingKey(query)}:${stream.id}`;
  const resumeTime = resumeSeekTargetRef.current;
  if (resumeTime <= 0) {
    resumeSeekSettledRef.current = true;
    resumeLog("resume skipped: no stored target");
    return;
  }
  if (resumeSeekSettledRef.current) return;

  const target = duration > 0 ? Math.min(resumeTime, Math.max(0, duration - 90)) : resumeTime;
  if (target < 12) {
    resumeSeekSettledRef.current = true;
    resumeLog("resume skipped: target below threshold", { target });
    return;
  }

  if (currentTimeRef.current >= target - 2) {
    resumeSeekSettledRef.current = true;
    resumeLog("resume already satisfied", { target });
    return;
  }

  resumeSeekStartedAtRef.current = Date.now();
  resumeSeekAttemptsRef.current = 1;
  window.performance?.mark?.("player:resume_seek");
  resumeLog("resume single seek", { target, seekKey });
  void sendMpvCommand(["seek", target, "absolute"]);
  resumeSeekSettledRef.current = true;

  const verify = window.setTimeout(() => {
    if (currentTimeRef.current < target - 5 && resumeSeekAttemptsRef.current < 2) {
      resumeSeekAttemptsRef.current = 2;
      resumeLog("resume reapply seek", { target });
      void sendMpvCommand(["seek", target, "absolute"]);
    }
  }, 2000);

  return () => window.clearTimeout(verify);
}, [duration, isTrailerStream, mpvFileLoaded, mpvReadyForCommands, query, stream]);

useEffect(() => {
  if (!playbackPreferences.autoPlayNextEpisode || !canGoNextEpisode || manualPaused) return;
  if (!duration || duration < 60 || currentTime <= 0) return;
  const progress = (currentTime / duration) * 100;
  if (progress < playbackPreferences.nextEpisodeThresholdPercent) return;
  const autoKey = `${query?.type ?? ""}:${query?.id ?? ""}:${query?.season ?? ""}:${query?.episode ?? ""}`;
  if (!autoKey.trim() || nextEpisodeAutoKeyRef.current === autoKey) return;
  nextEpisodeAutoKeyRef.current = autoKey;
  navigateEpisode("next");
}, [
  canGoNextEpisode,
  currentTime,
  duration,
  manualPaused,
  playbackPreferences.autoPlayNextEpisode,
  playbackPreferences.nextEpisodeThresholdPercent,
  query?.episode,
  query?.id,
  query?.season,
  query?.type,
]);

useEffect(() => {
  // Se dispara al TERMINAR una pelicula o el ultimo episodio de una serie
  // (no al llegar al siguiente episodio). Muestra una recomendacion.
  // Umbral: 98% del titulo o menos de 5s restantes. Desactivable desde ajustes.
  if (!playbackPreferences.upNextEnabled) return;
  if (duration < 60 || currentTime <= 0) return;
  const progress = (currentTime / duration) * 100;
  // Si hay un timestamp de créditos (TheIntroDB), se usa como referencia exacta;
  // si no, el umbral del 98% como respaldo.
  const hasCredits = upNextCreditsSegment && Number.isFinite(upNextCreditsSegment.start) && upNextCreditsSegment.start > 0;
  const finished = (hasCredits ? currentTime >= upNextCreditsSegment!.start : progress >= 98) || duration - currentTime <= 5;
  if (!finished) {
    // si el usuario retrocede por debajo del umbral, permite volver a mostrar
    if (progress < 93 && duration - currentTime > 10) {
      const key = `${query?.type ?? ""}:${query?.id ?? ""}:${query?.season ?? ""}:${query?.episode ?? ""}`;
      if (upNextShownKeyRef.current === key) upNextShownKeyRef.current = "";
      if (showUpNext) setShowUpNext(false);
    }
    return;
  }
  if (!isMovie && canGoNextEpisode) return; // series con episodio siguiente: no aqui
  if (!related.recommendation) return; // esperar a tener recomendacion real, evita page vacia
  if (showUpNext) return;
  const key = `${query?.type ?? ""}:${query?.id ?? ""}:${query?.season ?? ""}:${query?.episode ?? ""}`;
  if (upNextShownKeyRef.current === key) return;
  upNextShownKeyRef.current = key;
  console.info("[UPNEXT] Up Next disparado", {
    viaCredits: hasCredits,
    creditsStart: hasCredits ? upNextCreditsSegment!.start : null,
    progressPct: Number(progress.toFixed(1)),
    currentTime,
    duration,
  });
  setShowUpNext(true);
  // NO pausar: el video sigue reproduciendose mientras se achica
}, [
  currentTime,
  duration,
  isMovie,
  canGoNextEpisode,
  query?.episode,
  query?.id,
  query?.season,
  query?.type,
  related.recommendation,
  showUpNext,
  playbackPreferences.upNextEnabled,
  upNextCreditsSegment,
]);

// UpNext achica el video nativo MPV de verdad.
// - Fuente única de verdad: getUpNextMiniRect() (src/utils/upnextMiniRect.ts).
//   Tanto este cálculo de MPV como el hueco del backdrop en UpNext.tsx la usan,
//   por lo que nunca pueden desalinearse.
// - El zoom se calcula relativo al FIT de mpv (mpv escala el video para llenar la
//   ventana con video-unscaled=no y video-zoom multiplica sobre ese fit).
// - Se re-sincroniza al cambiar tamaño de ventana / DPR mientras UpNext está visible.
function computeMpvShrinkParams(
  videoW: number,
  videoH: number,
  windowW: number,
  windowH: number,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
) {
  const dpr = window.devicePixelRatio || 1;
  // Todo en píxeles físicos (mpv opera sobre el HWND en px físicos)
  const winW = windowW * dpr;
  const winH = windowH * dpr;
  const tX = targetX * dpr;
  const tY = targetY * dpr;
  const tW = targetW * dpr;
  const tH = targetH * dpr;
  // Escala de fit de mpv: llena la ventana sin deformar (contain)
  const fitScale = Math.max(0.0001, Math.min(winW / videoW, winH / videoH));
  const fitW = videoW * fitScale;
  const fitH = videoH * fitScale;
  // Cover sobre la caja mini. Un buen overscan hace que el video llene la caja
  // con margen a su alrededor, así la superficie negra de mpv NUNCA asoma en los
  // bordes del hueco (la "grieta"). Cubre cualquier pequeño desvío de posicion.
  const scale = Math.max(tW / fitW, tH / fitH) * 1.2;
  const zoom = Math.log2(scale);
  const dw = fitW * scale;
  const dh = fitH * scale;
  // Centrar el crop dentro de la caja mini
  const left = tX + (tW - dw) / 2;
  const top = tY + (tH - dh) / 2;
  const freeW = winW - dw;
  const freeH = winH - dh;
  const ax = freeW > 1 ? (2 * left) / freeW - 1 : -1;
  const ay = freeH > 1 ? (2 * top) / freeH - 1 : -1;
  return { zoom, ax: Math.max(-1, Math.min(1, ax)), ay: Math.max(-1, Math.min(1, ay)) };
}

const mpvTweenRef = useRef<gsap.core.Tween | null>(null);
// Solo se anima la vuelta a fullscreen si el video realmente estaba achicado.
const upNextShrunkRef = useRef(false);
useEffect(() => {
  if (androidPlayback || isIframeStream) return;
  if (!mpvReadyForCommands || !mpvFileLoaded) return;

  const videoTrack = mpvTracks.find(t => String(t.type ?? "").toLowerCase() === "video");
  const vidW = mpvVideoWidth ?? (videoTrack as any)?.["demux-w"] ?? (videoTrack as any)?.demuxW ?? 1920;
  const vidH = mpvVideoHeight ?? (videoTrack as any)?.["demux-h"] ?? (videoTrack as any)?.demuxH ?? 1080;

  function setProp(name: string, value: number | boolean) {
    void sendMpvCommand(["set_property", name, value]);
  }

  // Fija el video instantáneamente en la caja mini (para resize/DPR, sin animar).
  function snapToMini() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const mini = getUpNextMiniRect();
    const s = computeMpvShrinkParams(vidW, vidH, winW, winH, mini.x, mini.y, mini.w, mini.h);
    setProp("video-zoom", s.zoom);
    setProp("video-align-x", s.ax);
    setProp("video-align-y", s.ay);
  }

  function resetFullscreen() {
    setProp("video-zoom", 0);
    setProp("video-align-x", 0);
    setProp("video-align-y", 0);
    setProp("video-pan-x", 0);
    setProp("video-pan-y", 0);
    setProp("video-recenter", true);
    applyVideoScale(videoScaleMode);
  }

  if (mpvTweenRef.current) {
    mpvTweenRef.current.kill();
    mpvTweenRef.current = null;
  }

  if (showUpNext) {
    upNextShrunkRef.current = true;
    // Asegurar play + desactivar recentrado/crop para que el achique quede limpio.
    void sendMpvCommand(["set_property", "pause", false]);
    void sendMpvCommand(["set_property", "panscan", 0]);
    void sendMpvCommand(["set_property", "video-crop", ""]);
    void sendMpvCommand(["set_property", "video-pan-x", 0]);
    void sendMpvCommand(["set_property", "video-pan-y", 0]);
    void sendMpvCommand(["set_property", "video-recenter", false]);

    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const mini = getUpNextMiniRect();
    const shrink = computeMpvShrinkParams(vidW, vidH, winW, winH, mini.x, mini.y, mini.w, mini.h);

    const anim = { zoom: 0, ax: 0, ay: 0 };
    mpvTweenRef.current = gsap.to(anim, {
      zoom: shrink.zoom,
      ax: shrink.ax,
      ay: shrink.ay,
      duration: 0.75,
      ease: "expo.inOut",
      onUpdate: () => {
        setProp("video-zoom", anim.zoom);
        setProp("video-align-x", anim.ax);
        setProp("video-align-y", anim.ay);
      },
      onComplete: () => {
        setProp("video-zoom", shrink.zoom);
        setProp("video-align-x", shrink.ax);
        setProp("video-align-y", shrink.ay);
      },
    });

    // Re-sincronizar si cambia el tamaño de ventana / DPR mientras UpNext está visible
    const onResize = () => snapToMini();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      if (mpvTweenRef.current) {
        mpvTweenRef.current.kill();
        mpvTweenRef.current = null;
      }
    };
  }

  // Vuelta a pantalla completa. Solo se anima si realmente hubo un achique previo
  // (p. ej. al dismiss). En primera carga/otros casos se restaura directo, sin tween.
  if (!upNextShrunkRef.current) {
    resetFullscreen();
    if (!manualPausedRef.current) {
      void sendMpvCommand(["set_property", "pause", false]);
    }
    return () => {
      if (mpvTweenRef.current) {
        mpvTweenRef.current.kill();
        mpvTweenRef.current = null;
      }
    };
  }
  upNextShrunkRef.current = false;

  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const mini = getUpNextMiniRect();
  const shrink = computeMpvShrinkParams(vidW, vidH, winW, winH, mini.x, mini.y, mini.w, mini.h);
  const anim = { zoom: shrink.zoom, ax: shrink.ax, ay: shrink.ay };
  mpvTweenRef.current = gsap.to(anim, {
    zoom: 0,
    ax: 0,
    ay: 0,
    duration: 0.65,
    ease: "expo.inOut",
    onUpdate: () => {
      setProp("video-zoom", anim.zoom);
      setProp("video-align-x", anim.ax);
      setProp("video-align-y", anim.ay);
    },
    onComplete: () => {
      resetFullscreen();
      if (!manualPausedRef.current) {
        void sendMpvCommand(["set_property", "pause", false]);
      }
    },
  });

  return () => {
    if (mpvTweenRef.current) {
      mpvTweenRef.current.kill();
      mpvTweenRef.current = null;
    }
  };
}, [showUpNext, androidPlayback, isIframeStream, mpvReadyForCommands, mpvFileLoaded, videoScaleMode, mpvTracks, mpvVideoWidth, mpvVideoHeight]);

// Estado de salida de UpNext: primero se desvanece (exit animation) y luego desmonta.
const [upNextExiting, setUpNextExiting] = useState(false);
function dismissUpNext() {
  if (upNextExiting) return;
  setUpNextExiting(true);
}
function completeUpNextExit() {
  setShowUpNext(false);
  setUpNextExiting(false);
}

const mpvError = hasMpvError;
const showFallbackPanel = Boolean(mpvError) && !isLeavingPlayer;
const playerVisuallyReady = playbackStarted || (mpvReadyForCommands && mpvFileLoaded && playing);
const bufferingActive = seekBuffering || stalledPlayback || mpvPausedForCache;
const bufferingSignal = !manualPaused
  && !showFallbackPanel
  && ((playbackStarted && bufferingActive) || (mpvFileLoaded && bufferingActive));
const initialPlaybackLoading = !playerVisuallyReady;
const showPrePlaybackBackdrop = !showFallbackPanel && !playbackStarted && !mpvError;

useEffect(() => {
  if (loadingOverlayTimerRef.current !== null) {
    window.clearTimeout(loadingOverlayTimerRef.current);
    loadingOverlayTimerRef.current = null;
  }
  if (!playbackPreferences.showLoadingOverlay || manualPaused) {
    setLoadingOverlayVisible(false);
    return;
  }
  const shouldShowNow = (showPrePlaybackBackdrop && initialPlaybackLoading) || bufferingSignal;
  if (shouldShowNow) {
    loadingOverlayShownAtRef.current = Date.now();
    setLoadingOverlayVisible(true);
    return;
  }
  const elapsed = Date.now() - loadingOverlayShownAtRef.current;
  if (elapsed < 280) {
    loadingOverlayTimerRef.current = window.setTimeout(() => {
      setLoadingOverlayVisible(false);
    }, 280 - elapsed);
    return;
  }
  setLoadingOverlayVisible(false);
}, [
  bufferingSignal,
  initialPlaybackLoading,
  manualPaused,
  playbackPreferences.showLoadingOverlay,
  showPrePlaybackBackdrop,
]);

if (isIframeStream && playbackTarget) {
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <iframe
        src={playbackTarget}
        title={stream?.title ?? stream?.addonName ?? "Reproductor web"}
        className="absolute inset-0 h-full w-full border-0 bg-black"
        allow="autoplay; encrypted-media; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="absolute left-5 top-5 z-20 flex gap-2">
        <button
          type="button"
          onClick={goBack}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-white/16 bg-black/72 text-white backdrop-blur-md gsap-transition hover:bg-black/88"
          title="Volver"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(playbackTarget)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-white/16 bg-black/72 text-white backdrop-blur-md gsap-transition hover:bg-black/88"
          title="Abrir en el navegador"
          aria-label="Abrir en el navegador"
        >
          <ExternalLink size={19} />
        </button>
      </div>
    </div>
  );
}

if (!stream) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-white">
      <p className="text-white/64">No hay una fuente seleccionada.</p>
      <button onClick={goBack} className="liquid-glass rounded-md px-5 py-2 font-bold">
        Volver
      </button>
    </div>
  );
}
  const selectedSubtitleValue = selectedMpvSubtitle;
  const currentMetaTitle = isMovie ? mediaTitle : (currentEpisode?.name ?? mediaTitle);
  const currentOverview = currentEpisode?.overview?.trim() || "Sin descripción disponible para este episodio.";
  const behaviorBackground = typeof stream?.behaviorHints?.background === "string" ? stream.behaviorHints.background : "";
  const behaviorPoster = typeof stream?.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : "";
  const loadingArtwork =
    selectedMediaLogo
    || sanitizeLogoUrl(resumeEntry?.logo)
    || detailLogoUrl
    || addonLogoUrl
    || seriesLogoUrl
    || null;
  const resumeBackground = resumeEntry?.background || resumeEntry?.poster || "";
  const backgroundArtwork = ensureOriginalTmdbImage(
    !isMovie
      ? currentEpisode?.still || ""
      : selectedMediaBackground
        || resumeBackground
        || behaviorBackground
        || behaviorPoster
        || "",
  );
  const controlsReady = !androidPlayback && (playbackStarted || (mpvReadyForCommands && mpvFileLoaded));
  const playerCursor = !androidPlayback && playbackStarted && !controlsActive ? "none" : "default";
  const playerShellClassName = !showFallbackPanel
    ? `relative h-screen w-screen overflow-hidden ${nativeSurfaceVisible ? "bg-transparent" : "bg-black"} text-white`
    : "relative h-screen w-screen overflow-hidden bg-[#101014] text-white";
  
  return (
    <div
      className={playerShellClassName}
      style={{ cursor: playerCursor, fontFamily: "Inter, system-ui, sans-serif" }}
      onPointerMove={() => wakeControls()}
      onPointerDown={startHoldToAccelerate}
      onPointerUp={stopHoldToAccelerate}
      onPointerCancel={stopHoldToAccelerate}
      onPointerLeave={stopHoldToAccelerate}
      onClick={handleScreenClick}
    >
      {showPrePlaybackBackdrop ? (
        <div className="pointer-events-none absolute inset-0 bg-black" />
      ) : null}
      {showPrePlaybackBackdrop && backgroundArtwork ? (
        <img src={backgroundArtwork} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center" />
      ) : null}
      {showPrePlaybackBackdrop ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(120deg, rgba(0,0,0,0.92) 0%, rgba(18,18,20,0.72) 38%, rgba(54,54,58,0.28) 62%, rgba(0,0,0,0.78) 100%)",
          }}
        />
      ) : null}
      {showPrePlaybackBackdrop && !backgroundArtwork ? (
        <div className="pointer-events-none absolute inset-0 bg-[#101014]" />
      ) : null}
      {showFallbackPanel ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black px-8 text-center">
          <div className="pointer-events-auto liquid-glass-dark max-w-lg rounded-lg p-6 opacity-95 gsap-transition hover:opacity-100">
            <h1 className="mb-3 text-xl font-black">libmpv interno</h1>
            {mpvBundled === false && (
              <p className="mb-4 rounded-md bg-white/10 px-4 py-3 text-xs text-white/62">
                MPV interno no esta instalado en el bundle. Instala el runtime compatible con libmpv en src-tauri/bin/mpv y vuelve a empaquetar.
              </p>
            )}
            {mpvStatus && <p className="mb-4 text-xs text-white/58">{mpvStatus}</p>}
            <button onClick={() => void retryMpvPlayback()} className="rounded-md bg-white px-5 py-2.5 font-bold text-black">
              Reintentar reproducción
            </button>
            {playbackTarget && <p className="mt-4 break-all text-xs text-white/32">{playbackTarget}</p>}
          </div>
        </div>
      ) : null}
      {androidPlayback && !showFallbackPanel ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/72 px-[5vw] text-center">
          <div className="liquid-glass-dark max-w-xl rounded-lg p-6">
            <h1 className="mb-3 text-xl font-black">Reproductor Android TV</h1>
            <p className="mb-5 text-sm text-white/62">
              {mpvStatus || "El reproductor nativo se abre en pantalla completa dentro del APK."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <button data-player-interactive onClick={() => void retryMpvPlayback()} className="rounded-md bg-white px-5 py-2.5 font-bold text-black">
                Reabrir
              </button>
              <button data-player-interactive onClick={goBack} className="rounded-md border border-white/18 px-5 py-2.5 font-bold text-white">
                Volver
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PlayerLoadingOverlay visible={loadingOverlayVisible} artwork={loadingArtwork} title={mediaTitle} message={mpvStatus} hideMessage={playbackStarted} p2p={isP2pStream} />
      {fileDropNotice ? (
        <div
          data-player-interactive
          className="pointer-events-none absolute left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-white/14 bg-black/76 px-4 py-2 text-sm font-semibold text-white shadow-2xl"
        >
          {fileDropNotice}
        </div>
      ) : null}
      {subtitleSyncNotice ? (
        <div
          data-player-interactive
          className="pointer-events-none absolute left-1/2 top-6 z-50 -translate-x-1/2 rounded-full border border-white/14 bg-black/76 px-4 py-2 text-sm font-semibold text-white shadow-2xl"
        >
          {subtitleSyncNotice}
        </div>
      ) : null}
      {videoFilterNotice ? (
        <div
          data-player-interactive
          className="pointer-events-none absolute left-1/2 top-[68px] z-50 -translate-x-1/2 rounded-full border border-white/14 bg-black/76 px-4 py-2 text-sm font-semibold text-white shadow-2xl"
        >
          {videoFilterNotice}
        </div>
      ) : null}

      <SubtitleSyncDialog
        open={subtitleSync.open}
        loading={subtitleSync.loading}
        error={subtitleSync.error}
        stage={subtitleSync.stage}
        cues={subtitleSync.visibleCues}
        capturedVideoMs={subtitleSync.capturedVideoMs}
        trackLabel={subtitleOptions.find(option => option.value === selectedMpvSubtitle)?.label ?? ""}
        onClose={subtitleSync.closeSync}
        onCapture={() => void subtitleSync.capture()}
        onApplyCue={subtitleSync.applyCue}
      />

      {!androidPlayback && playbackPreferences.skipSegmentsEnabled && activeSkipSegment && mpvReadyForCommands && playbackStarted ? (
        <button
          data-player-interactive
          type="button"
          className="absolute z-40 flex items-center gap-2 rounded-full border border-white/18 bg-white px-5 py-2.5 text-sm font-black text-black shadow-[0_18px_56px_rgba(0,0,0,0.62)] gsap-transition hover:scale-[1.03]"
          style={{
            right: "max(32px, calc((100vw - min(1240px, calc(100vw - 32px))) / 2 + 24px))",
            bottom: controlsActive ? 166 : 44,
          }}
          onClick={event => {
            event.stopPropagation();
            seek(activeSkipSegment.end + 0.15);
          }}
        >
          <SkipForward size={17} />
          {activeSkipSegment.kind === "recap" ? "Saltar resumen" : "Saltar intro"}
        </button>
      ) : null}

      <EpisodePanel
        visible={!androidPlayback && activeSidePanel === "episodes" && showPanelToggle}
        title={title}
        streamName={mediaTitle}
        seriesLogoUrl={seriesLogoUrl}
        currentEpisode={currentEpisode}
        currentOverview={currentOverview}
        items={panelItems}
        hasEpisodeOptions={episodeOptions.length > 0}
        canGoPrevEpisode={canGoPrevEpisode}
        canGoNextEpisode={canGoNextEpisode}
        onClose={() => setActiveSidePanel(null)}
        onNavigateEpisode={navigateEpisode}
      />
      <SourcePanel
        visible={!androidPlayback && activeSidePanel === "sources"}
        streams={availableStreams}
        currentStreamId={stream.id}
        onClose={() => setActiveSidePanel(null)}
        onSelect={selectSource}
      />

      <PlayerControls
        active={controlsReady && controlsActive && !showUpNext}
        currentMetaTitle={currentMetaTitle}
        title={title}
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        volume={volume}
        selectedMpvAudio={selectedMpvAudio}
        selectedSubtitleValue={selectedSubtitleValue}
        selectedSpeed={selectedSpeed}
        selectedVideoProfile={selectedVideoProfile}
        videoScaleMode={videoScaleMode}
        audioOptions={normalizedAudioOptions}
        subtitleOptions={subtitleOptions}
        speedOptions={speedOptions}
        videoProfileOptions={VIDEO_ENHANCEMENT_OPTIONS}
        subtitlesLoading={subtitlesLoading}
        subtitleDelayMs={subtitleDelayMs}
        subtitleScalePercent={subtitleScalePercent}
        subtitleVerticalPercent={subtitleVerticalPercent}
        subtitleSyncOpen={subtitleSync.open}
        showPanelToggle={showPanelToggle}
        activeSidePanel={activeSidePanel}
        hasEpisodeOptions={episodeOptions.length > 0}
        controlsLocked={false}
        canGoPrevEpisode={canGoPrevEpisode}
        canGoNextEpisode={canGoNextEpisode}
        canChangeSource={availableStreams.length > 0 && !isTrailerStream}
        onControlsEnter={holdControls}
        onControlsLeave={() => releaseControls(2)}
        onSeek={seek}
        onJump={jump}
        onTogglePlay={togglePlay}
        onVolumeChange={applyVolume}
        onToggleMute={toggleMute}
        onAudioChange={value => {
          manualAudioSelectionRef.current = true;
          autoLangLog("audio manual change", { value });
          const audioMeta = audioSelectionMeta(value);
          setSelectedMpvAudio(value);
          desiredAudioSelectionRef.current = value;
          desiredAudioSelectionSetRef.current = true;
          saveContinueWatchingAudioSelection(query, {
            value,
            label: audioMeta.selectedAudioLabel,
            language: audioMeta.selectedAudioLanguage,
            trackLang: audioMeta.selectedAudioTrackLang,
            trackTitle: audioMeta.selectedAudioTrackTitle,
          });
          updateContinueWatchingSelection(query, audioMeta);
          persistAudioPreference(value);
          if (!value) {
            void sendMpvCommand(["set_property", "aid", "no"]);
            return;
          }
          if (value.startsWith("track:")) {
            void sendMpvCommand(["set_property", "aid", Number(value.slice(6))]);
          }
        }}
        onSubtitleChange={value => {
          manualSubtitleSelectionRef.current = true;
          autoLangLog("subtitle manual change", { value });
          setSelectedMpvSubtitle(value);
          desiredSubtitleSelectionRef.current = value;
          desiredSubtitleSelectionSetRef.current = true;
          updateContinueWatchingSelection(query, subtitleSelectionMeta(value));
          persistSubtitlePreference(value);
          if (!value) {
            void sendMpvCommand(["set_property", "sid", "no"]);
            return;
          }
          if (value.startsWith("track:")) {
            void sendMpvCommand(["set_property", "sid", Number(value.slice(6))]);
            window.setTimeout(() => applySubtitleSettings(), 80);
            return;
          }
          if (value.startsWith("ext:")) {
            applyExternalSubtitle(value.slice(4));
          }
        }}
        onSubtitleDelayChange={next => {
          const value = Math.max(SUBTITLE_DELAY_MIN_MS, Math.min(SUBTITLE_DELAY_MAX_MS, next));
          setSubtitleDelayMs(value);
          applySubtitleSettings({ delayMs: value });
          saveSubtitleDelayMs(query, value);
        }}
        onSubtitleScaleChange={next => {
          const value = Math.max(50, Math.min(200, next));
          setSubtitleScalePercent(value);
          applySubtitleSettings({ scalePercent: value });
        }}
        onSubtitleVerticalChange={next => {
          const value = Math.max(0, Math.min(50, next));
          setSubtitleVerticalPercent(value);
          applySubtitleSettings({ verticalPercent: value });
        }}
        onOpenSubtitleSync={subtitleSync.openSync}
        onSpeedChange={value => {
          setSelectedSpeed(value);
          void sendMpvCommand(["set_property", "speed", Number(value)]);
        }}
        onVideoProfileChange={applyVideoProfile}
        onToggleVideoScale={toggleVideoScale}
        onToggleSourcePanel={() => setActiveSidePanel(value => value === "sources" ? null : "sources")}
        onToggleEpisodePanel={() => setActiveSidePanel(value => value === "episodes" ? null : "episodes")}
        onNavigateEpisode={navigateEpisode}
      />

      {(showUpNext || upNextExiting) && related.recommendation && (isMovie || !canGoNextEpisode) ? (
        <UpNext
          exiting={upNextExiting}
          onExitComplete={completeUpNextExit}
          recommendation={{
            title: related.recommendation.title,
            logoUrl: related.recommendation.logoUrl,
            backdropUrl: related.recommendation.backdropUrl,
            posterUrl: related.recommendation.posterUrl,
            overview: related.recommendation.overview,
            year: related.recommendation.year,
            rating: related.recommendation.rating,
            voteCount: related.recommendation.voteCount,
            runtime: related.recommendation.runtime,
            genres: related.recommendation.genres,
            mediaTypeLabel: related.recommendation.mediaTypeLabel,
            }}
            countdownSeconds={12}
            onPlay={() => {
            dismissUpNext();
            const rec = related.recommendation;
            if (rec) navigate(`/episode?type=${rec.type}&id=tmdb:${rec.tmdbId}`);
            }}
            onCountdownEnd={() => {
            dismissUpNext();
            const rec = related.recommendation;
            if (rec) navigate(`/episode?type=${rec.type}&id=tmdb:${rec.tmdbId}`);
            }}
            onMiniClick={dismissUpNext}
            />
      ) : null}
    </div>
  );
}

function pickInitialTrackOption(options: { value: string; label: string; languageKey?: string }[], preferredLanguage: string) {
  const preferred = preferredLanguage
    ? options.find(option => (
      matchesPreferredLanguage(option.label, preferredLanguage)
      || (option.languageKey && matchesPreferredLanguage(option.languageKey, preferredLanguage))
    ))
    : null;
  if (preferred) return preferred;
  return (
    options.find(option => /(?:^|[^a-z])(spa|es|esp|es-419|lat|la|spanish|espanol|español|latino|castellano)(?:[^a-z]|$)/i.test(option.label)) ??
    options.find(option => /(?:^|[^a-z])(eng|en|english|ingles|inglés)(?:[^a-z]|$)/i.test(option.label)) ??
    options[0] ??
    null
  );
}

function looksLikeSubtitleUrl(value: string) {
  if (!value) return false;
  if (value.includes("://")) return true;
  if (value.startsWith("?")) return true;
  return /(?:^|[?&])(?:lang|lang_code|language|sub_id)=/i.test(value);
}

function subtitleTrackMatchesUrl(title: string, url: string) {
  if (!title || !url) return false;
  if (title === url) return true;
  if (url.endsWith(title) || title.endsWith(url)) return true;
  const titleQueryIndex = title.indexOf("?");
  const urlQueryIndex = url.indexOf("?");
  if (titleQueryIndex >= 0 && urlQueryIndex >= 0) {
    return title.slice(titleQueryIndex) === url.slice(urlQueryIndex);
  }
  return false;
}

function pickInitialTrackOptionFromLanguages(options: { value: string; label: string; languageKey?: string }[], preferredLanguages: string[]) {
  for (const preferredLanguage of preferredLanguages) {
    if (!preferredLanguage) continue;
    const matched = options.find(option => (
      matchesPreferredLanguage(option.label, preferredLanguage)
      || (option.languageKey && matchesPreferredLanguage(option.languageKey, preferredLanguage))
    ));
    if (matched) return matched;
  }
  return pickInitialTrackOption(options, "");
}

function pickInitialAudio(options: { value: string; label: string }[], preferredLanguages: string[]) {
  for (const preferredLanguage of preferredLanguages) {
    if (!preferredLanguage) continue;
    const matched = options.find(option => matchesPreferredLanguage(option.label, preferredLanguage));
    if (matched) return matched;
  }
  return null;
}

function pickInitialAudioTrack(
  tracks: MpvTrack[],
  preferredLanguages: string[],
  audioOptions: { value: string; label: string }[],
) {
  const audioTracks = tracks
    .map(track => ({
      id: Number(track.id),
      kind: String(track.type ?? "").toLowerCase(),
      lang: String(track.lang ?? "").toLowerCase(),
      title: String(track.title ?? ""),
    }))
    .filter(track => Number.isFinite(track.id) && (track.kind === "audio" || track.kind === "a" || track.kind.includes("audio")));

  for (const preferredLanguage of preferredLanguages) {
    if (!preferredLanguage) continue;
    const matchedTrack = audioTracks.find(track =>
      matchesPreferredLanguage(track.lang, preferredLanguage) ||
      matchesPreferredLanguage(track.title, preferredLanguage),
    );
    if (matchedTrack) return { value: `track:${matchedTrack.id}`, label: matchedTrack.title || matchedTrack.lang || `Audio ${matchedTrack.id}` };
  }

  return pickInitialAudio(audioOptions, preferredLanguages);
}

function pickStoredTrackOption(
  options: { value: string; label: string }[],
  stored: { value?: string; label?: string; language?: string; trackLang?: string; trackTitle?: string },
) {
  const storedValue = stored.value ?? "";
  const storedLabel = normalizeOptionText(stored.label);
  const storedLanguage = stored.language ?? "";
  const storedTrackLang = normalizeOptionText(stored.trackLang);
  const storedTrackTitle = normalizeOptionText(stored.trackTitle);
  const byValue = storedValue ? options.find(option => option.value === storedValue) : null;

  if (byValue && (!storedLabel || normalizeOptionText(byValue.label) === storedLabel)) return byValue;
  if (storedTrackLang || storedTrackTitle) {
    const byTrackParts = options.find(option => {
      const label = normalizeOptionText(option.label);
      return (
        (!storedTrackLang || label.includes(storedTrackLang)) &&
        (!storedTrackTitle || label.includes(storedTrackTitle))
      );
    });
    if (byTrackParts) return byTrackParts;
  }
  if (storedLabel) {
    const byExactLabel = options.find(option => normalizeOptionText(option.label) === storedLabel);
    if (byExactLabel) return byExactLabel;
    const byContainedLabel = options.find(option => {
      const label = normalizeOptionText(option.label);
      return label.includes(storedLabel) || storedLabel.includes(label);
    });
    if (byContainedLabel) return byContainedLabel;
  }
  if (storedLanguage) {
    const byLanguage = options.find(option => matchesPreferredLanguage(option.label, storedLanguage));
    if (byLanguage) return byLanguage;
  }
  return byValue ?? null;
}

function findMpvTrackByValue(value: string, tracks: MpvTrack[]) {
  if (!value.startsWith("track:")) return null;
  const trackId = Number(value.slice(6));
  if (!Number.isFinite(trackId)) return null;
  return tracks.find(track => Number(track.id) === trackId) ?? null;
}

function normalizeOptionText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeSubtitleLanguageKey(value: string) {
  const normalized = normalizeOptionText(value);
  if (!normalized) return "other";
  const queryMatch = normalized.match(/(?:^|[?&])(?:lang|lang_code|language)=([a-z-]{2,12})/i);
  if (queryMatch?.[1]) return normalizeSubtitleLanguageKey(queryMatch[1]);
  if (/(^|[^a-z])(spanish|espanol|espa\u00f1ol|castellano|latino|spa|es|es-419)($|[^a-z])/i.test(normalized)) return "es";
  if (/(^|[^a-z])(english|ingles|ingl\u00e9s|eng|en)($|[^a-z])/i.test(normalized)) return "en";
  if (/(^|[^a-z])(russian|ruso|rus|ru)($|[^a-z])/i.test(normalized)) return "ru";
  if (/(^|[^a-z])(italian|italiano|ita|it)($|[^a-z])/i.test(normalized)) return "it";
  if (/(^|[^a-z])(portuguese|portugues|portugu\u00eas|por|pt|pt-br)($|[^a-z])/i.test(normalized)) return "pt";
  if (/(^|[^a-z])(french|frances|francais|fra|fr)($|[^a-z])/i.test(normalized)) return "fr";
  if (/(^|[^a-z])(german|aleman|alem\u00e1n|deu|ger|de)($|[^a-z])/i.test(normalized)) return "de";
  if (/(^|[^a-z])(japanese|japones|japon\u00e9s|jpn|ja|jp)($|[^a-z])/i.test(normalized)) return "ja";
  if (/(^|[^a-z])(korean|coreano|kor|ko)($|[^a-z])/i.test(normalized)) return "ko";
  if (/(^|[^a-z])(chinese|chino|zho|zh)($|[^a-z])/i.test(normalized)) return "zh";
  const codeMatch = normalized.match(/\b([a-z]{2,3})(?:-[a-z]{2,4})?\b/);
  return codeMatch?.[1] ? codeMatch[1] : "other";
}

function formatSubtitleLanguageLabel(languageKey: string, fallback = "") {
  const key = normalizeSubtitleLanguageKey(languageKey);
  if (key === "es") return "Español";
  if (key === "en") return "English";
  if (key === "ru") return "Russian";
  if (key === "it") return "Italiano";
  if (key === "pt") return "Portugués";
  if (key === "fr") return "Francés";
  if (key === "de") return "Deutsch";
  if (key === "ja") return "Japanese";
  if (key === "ko") return "Korean";
  if (key === "zh") return "Chinese";
  const text = (fallback || "").trim();
  if (!text) return "Otro";
  return text.length > 22 ? `${text.slice(0, 22)}...` : text;
}

const KNOWN_LANGUAGE_CODES = ["spa", "eng", "jpn", "kor", "por", "fra", "deu", "ita", "zho", "rus"] as const;

function detectPreferredLanguageCode(
  selectedValue: string,
  tracks: MpvTrack[],
  options: { value: string; label: string; languageKey?: string }[],
) {
  const byTrack = detectLanguageFromTrack(selectedValue, tracks);
  if (byTrack) return byTrack;
  const selectedOption = options.find(option => option.value === selectedValue);
  if (selectedOption?.languageKey && selectedOption.languageKey !== "other") return selectedOption.languageKey;
  return detectLanguageFromText(selectedOption?.label ?? "");
}

function detectLanguageFromTrack(selectedValue: string, tracks: MpvTrack[]) {
  if (!selectedValue.startsWith("track:")) return "";
  const trackId = Number(selectedValue.slice(6));
  if (!Number.isFinite(trackId)) return "";
  const track = tracks.find(item => Number(item.id) === trackId);
  if (!track) return "";
  return detectLanguageFromText(`${track.lang ?? ""} ${track.title ?? ""}`);
}

function detectLanguageFromText(value: string) {
  for (const language of KNOWN_LANGUAGE_CODES) {
    if (matchesPreferredLanguage(value, language)) return language;
  }
  return "";
}
