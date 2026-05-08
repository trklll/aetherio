import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SkipForward } from "lucide-react";
import { matchesPreferredLanguage, resolvePreferredLanguage, usePlaybackPreferences } from "../../config/playbackPreferences";
import { useOriginalLanguage } from "../../hooks/useOriginalLanguage";
import { useSubtitles } from "../../hooks/useSubtitles";
import type { MediaStream } from "../../types/stream";
import type { SubtitleSource } from "../../types/subtitle";
import { buildContinueWatchingKey, getResumeStartTime, saveContinueWatchingProgress } from "../../utils/continueWatching";
import { sanitizeLogoUrl } from "../../utils/artwork";
import type { ChapterOption, MpvTrack, VideoScaleMode } from "./types";
import EpisodePanel from "./EpisodePanel";
import PlayerControls from "./PlayerControls";
import PlayerLoadingOverlay from "./PlayerLoadingOverlay";
import { useControlsVisibility } from "./useControlsVisibility";
import { useEpisodeMetadata, usePlayerLogos } from "./usePlayerMetadata";
import { usePlayerKeyboardShortcuts } from "./usePlayerKeyboardShortcuts";
import { useMpvStatus } from "./useMpvStatus";
import { useSkipIntro } from "./useSkipIntro";
import {
  AUTO_NEXT_SOURCE_KEY,
  SELECTED_ENGINE_KEY,
  SELECTED_MEDIA_META_KEY,
  SELECTED_STREAM_KEY,
  buildQuery,
  formatTime,
  getPlaybackTarget,
  openExternal,
} from "./utils";

const DEBUG_AUTOPLAY = false;
const DEBUG_AUTO_LANG = true;
const DEBUG_RESUME = true;
const STARTUP_GATE_HARD_TIMEOUT_MS = 20000;

interface MpvAutocropResult {
  enabled: boolean;
  sourceCropApplied?: boolean;
  crop?: string | null;
  warning?: string;
}

export default function PlayerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mpvLaunchKeyRef = useRef("");
  const mpvRecoveryKeyRef = useRef("");
  const launchStartedAtRef = useRef(0);
  const nextEpisodeAutoKeyRef = useRef("");
  const currentTimeRef = useRef(0);
  const lastProgressTimeRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  const lastContinueSaveAtRef = useRef(0);
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

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [selectedMediaName, setSelectedMediaName] = useState("");
  const [selectedMediaBackground, setSelectedMediaBackground] = useState("");
  const [selectedMediaLogo, setSelectedMediaLogo] = useState("");
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
  const [mpvStatus, setMpvStatus] = useState<string | null>(null);
  const [mpvBundled, setMpvBundled] = useState<boolean | null>(null);
  const [mpvTracks, setMpvTracks] = useState<MpvTrack[]>([]);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([]);
  const [showEpisodePanel, setShowEpisodePanel] = useState(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [mpvReadyForCommands, setMpvReadyForCommands] = useState(false);
  const [mpvFileLoaded, setMpvFileLoaded] = useState(false);
  const [mpvPausedForCache, setMpvPausedForCache] = useState(false);
  const [mpvCacheBuffering, setMpvCacheBuffering] = useState<number>(0);
  const [stalledPlayback, setStalledPlayback] = useState(false);
  const [videoScaleMode, setVideoScaleMode] = useState<VideoScaleMode>("original");
  const manualPausedRef = useRef(false);

  const query = useMemo(() => buildQuery(params), [
  params.get("type"),
  params.get("id"),
  params.get("season"),
  params.get("ep"),
  ]);
  const { episodeOptions, seriesLogoUrl } = useEpisodeMetadata(query);
  const { addonLogoUrl, detailLogoUrl } = usePlayerLogos(query, stream);
  const safeStream = stream ?? null;
  const isTrailerStream = Boolean(safeStream?.ytId);
  const metadataQuery = isTrailerStream ? null : query;
  const originalLanguage = useOriginalLanguage(metadataQuery, safeStream);
  const { subtitles: addonSubtitles, loading: subtitlesLoading, ready: subtitlesReady } = useSubtitles(metadataQuery, safeStream);

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
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as MediaStream;
      if (savedMediaMeta) {
        try {
          const parsedMeta = JSON.parse(savedMediaMeta) as { name?: string; logo?: string; background?: string; poster?: string };
          const background = parsedMeta.background ?? parsedMeta.poster;
          setSelectedMediaName(typeof parsedMeta.name === "string" ? parsedMeta.name : "");
          setSelectedMediaBackground(typeof background === "string" ? background : "");
          setSelectedMediaLogo(sanitizeLogoUrl(parsedMeta.logo) ?? "");
        } catch {
          setSelectedMediaName("");
          setSelectedMediaBackground("");
          setSelectedMediaLogo("");
        }
      }
      setStream(parsed);
      sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    } catch {
      setStream(null);
    }
  }, []);

  useEffect(() => {
    invoke<{ mpvBundled: boolean }>("playback_capabilities")
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
    setPlaying,
    setMpvFileLoaded,
    setMpvPausedForCache,
    setMpvCacheBuffering,
    setMpvTracks,
    setSelectedMpvSubtitle,
    setSelectedMpvAudio,
    setSelectedSpeed,
    setChapterIndex,
    setChapterOptions,
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
    } else {
      mpvFileLoadedAtRef.current = 0;
    }
  }, [mpvFileLoaded]);

  useEffect(() => {
    if (mpvFileLoaded) {
      applyVideoScale(videoScaleMode);
      void sendMpvCommand(["set_property", "volume", Math.round(volume * 100)]);
    }
  }, [mpvFileLoaded, videoScaleMode, volume]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
    if (currentTime > lastProgressTimeRef.current + 0.08) {
      lastProgressTimeRef.current = currentTime;
      lastProgressAtRef.current = Date.now();
      setStalledPlayback(false);
    }
  }, [currentTime]);

  useEffect(() => {
    manualPausedRef.current = manualPaused;
    if (manualPaused) {
      setStalledPlayback(false);
      return;
    }

    const interval = window.setInterval(() => {
    const cacheHint = mpvPausedForCache || (mpvCacheBuffering > 5 && mpvCacheBuffering < 95);
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
  }, [manualPaused, mpvCacheBuffering, mpvFileLoaded, mpvPausedForCache, playbackStarted]);

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
    if (!stream || manualPaused || playbackStarted || !mpvReadyForCommands || !mpvFileLoaded) return;

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
      setPlaybackStarted(true);
    }
  }, [currentTime]);

  useEffect(() => {
    if (!playbackStarted || startupKickCountRef.current === 0) return;
    void sendMpvCommand(["set_property", "cache-pause", true]);
  }, [playbackStarted]);

  useEffect(() => {
    if (query?.type === "movie") {
      setShowEpisodePanel(false);
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
        label: item.title ?? item.lang ?? item.language ?? "Subtitulos del stream",
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
      .map(track => ({
        value: `track:${track.parsedId}`,
        label: track.title && track.lang ? `${track.lang} - ${track.title}` : track.title ?? track.lang ?? `Subtitulo ${track.parsedId}`,
      }));
    const external = allSubtitles.map(subtitle => ({
      value: `ext:${subtitle.url}`,
      label: subtitle.label,
    }));
    return [...internal, ...external];
  }, [allSubtitles, mpvTracks]);

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
        void invoke("stop_mpv").catch(() => undefined).finally(() => {
          navigate(`/streams?type=${query?.type}&id=${encodeURIComponent(query?.id ?? "")}&season=${item.season}&ep=${item.episode}`);
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
    debugLog("seek() called", { value });
    setCurrentTime(value);
    void sendMpvCommand(["seek", value, "absolute", "exact"]);
  }

  function jump(offset: number) {
    debugLog("jump() called", { offset });
    void sendMpvCommand(["seek", offset, "relative"]);
  }

  function applyVolume(nextVolume: number) {
    const clamped = Math.min(1, Math.max(0, nextVolume));
    setVolume(clamped);
    void sendMpvCommand(["set_property", "volume", Math.round(clamped * 100)]);
  }

  function applyVideoScale(mode: VideoScaleMode) {
    const isCrop = mode === "crop";
    void invoke<MpvAutocropResult>("mpv_autocrop", { enabled: isCrop })
      .then(result => {
        debugLog("mpv_autocrop resolved", { result });
      })
      .catch(error => {
        debugLog("mpv_autocrop fallback", { error: String(error) });
        void sendMpvCommand(["set_property", "video-crop", ""]);
        void sendMpvCommand(["set_property", "panscan", isCrop ? 1 : 0]);
        void sendMpvCommand(["set_property", "video-zoom", 0]);
        void sendMpvCommand(["set_property", "video-align-x", 0]);
        void sendMpvCommand(["set_property", "video-align-y", 0]);
      });
  }

  function toggleVideoScale() {
    const nextMode = videoScaleMode === "original" ? "crop" : "original";
    setVideoScaleMode(nextMode);
    applyVideoScale(nextMode);
  }

  async function launchMpv(showOpening = true) {
    if (!stream) return;
    if (showOpening) setMpvStatus("Abriendo MPV...");
    launchStartedAtRef.current = Date.now();
    const { error } = await openExternal(stream);
    setMpvReadyForCommands(!error);
    setPlaying(!error);
    setManualPaused(false);
    manualPausedRef.current = false;
    setMpvStatus(error ? `MPV no inicio: ${error}` : null);
  }

  async function retryMpvPlayback() {
    setMpvStatus("Reiniciando MPV...");
    await launchMpv(false);
  }

  async function sendMpvCommand(command: unknown[]) {
    debugLog("mpv_command send", { command });
    try {
      await invoke("mpv_command", { command });
      debugLog("mpv_command ok", { command });
    } catch (error) {
      debugLog("mpv_command error", { command, error: String(error) });
      setMpvStatus(`MPV: ${String(error)}`);
    }
  }

  function goBack() {
    const detailPath = query?.type && query?.id
      ? `/detail/${encodeURIComponent(query.type)}/${encodeURIComponent(query.id)}`
      : null;
    void invoke("stop_mpv")
      .catch(() => undefined)
      .finally(() => {
        if (detailPath) {
          navigate(detailPath, { replace: true });
          return;
        }
        navigate(-1);
      });
  }

  function navigateEpisode(direction: "prev" | "next") {
    if (!query?.season || !query.episode) return;
    const currentIndex = episodeOptions.findIndex(episode => episode.episode === query.episode);
    if (currentIndex === -1) return;
    const nextEpisode = episodeOptions[currentIndex + (direction === "next" ? 1 : -1)];
    if (!nextEpisode) return;
    if (direction === "next" && stream) {
      sessionStorage.setItem(AUTO_NEXT_SOURCE_KEY, JSON.stringify({
        addonId: stream.addonId,
        addonName: stream.addonName,
        name: stream.name,
        title: stream.title,
      }));
    } else {
      sessionStorage.removeItem(AUTO_NEXT_SOURCE_KEY);
    }
    void invoke("stop_mpv").catch(() => undefined).finally(() => {
      const autoplay = direction === "next" ? "&autoplay=1" : "";
      navigate(`/streams?type=${query.type}&id=${encodeURIComponent(query.id)}&season=${nextEpisode.season}&ep=${nextEpisode.episode}${autoplay}`);
    });
  }

  function handleScreenClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-player-interactive]")) return;
    if (Date.now() - launchStartedAtRef.current < 1200) return;
    wakeControls();
    if (!showFallbackPanel && mpvReadyForCommands && playbackStarted) {
      togglePlay();
    }
  }

  useEffect(() => {
    if (!stream) return;
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
    resumeSeekTargetRef.current = getResumeStartTime(query);
    resumeSeekSettledRef.current = resumeSeekTargetRef.current < 12;
    resumeSeekStartedAtRef.current = Date.now();
    resumeLog("session init", {
      launchKey,
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
    startupGateActiveRef.current = !stream.ytId;
    startupGatePausedRef.current = false;
    startupGateStartedAtRef.current = Date.now();
    startupGateLastAudioApplyAtRef.current = 0;
    autoAudioAppliedRef.current = false;
    autoSubtitleAppliedRef.current = false;
    manualAudioSelectionRef.current = false;
    manualSubtitleSelectionRef.current = false;
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
    setMpvStatus("Abriendo MPV...");
    debugLog("mpv openExternal called", { target: launchKey });

    void openExternal(stream).then(({ error }) => {
      if (cancelled) return;
      setPlaying(!error);
      setMpvReadyForCommands(!error);
      setManualPaused(false);
      manualPausedRef.current = false;
      setMpvStatus(error ? `MPV no inicio: ${error}` : null);
      if (!error) {
        void sendMpvCommand(["set_property", "pause", false]);
        applyVideoScale(videoScaleMode);
      }
      debugLog(error ? "mpv openExternal error" : "mpv openExternal resolved", { error });
    });

    return () => {
      cancelled = true;
      if (resumeSeekTimerRef.current) {
        window.clearTimeout(resumeSeekTimerRef.current);
        resumeSeekTimerRef.current = null;
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
      void invoke("stop_mpv").catch(() => undefined);
    };
  }, [stream]);

  useEffect(() => {
    if (!query?.type || !query?.id) return;
    const detailPath = `/detail/${encodeURIComponent(query.type)}/${encodeURIComponent(query.id)}`;
    window.history.pushState({ aetherioPlayerBackGuard: true }, "");

    const onPopState = () => {
      void invoke("stop_mpv")
        .catch(() => undefined)
        .finally(() => navigate(detailPath, { replace: true }));
    };

    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, [navigate, query?.id, query?.type]);

  useEffect(() => {
    if (!playbackStarted || !mpvReadyForCommands || !subtitlesReady || !subtitleOptions.length) return;
    if (manualSubtitleSelectionRef.current) {
      autoLangLog("subtitle skipped: manual selection");
      return;
    }
    const preferredLanguage = resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage);
    const targetSubtitle = pickInitialTrackOption(subtitleOptions, preferredLanguage)?.value ?? "";
    if (!targetSubtitle) {
      autoSubtitleAppliedRef.current = true;
      autoLangLog("subtitle no target", { preferredLanguage, options: subtitleOptions.length });
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
      preferredLanguage,
      targetSubtitle,
      attempt: autoSubtitleAttemptsRef.current,
      options: subtitleOptions.slice(0, 6).map(option => option.label),
    });
    setSelectedMpvSubtitle(targetSubtitle);
    if (targetSubtitle.startsWith("track:")) {
      void sendMpvCommand(["set_property", "sid", Number(targetSubtitle.slice(6))]);
    } else if (targetSubtitle.startsWith("ext:")) {
      void sendMpvCommand(["sub-add", targetSubtitle.slice(4), "select"]);
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
        void sendMpvCommand(["sub-add", targetSubtitle.slice(4), "select"]);
      }
    }, 380);
  }, [
    mpvReadyForCommands,
    originalLanguage,
    playbackPreferences.preferredSubtitleLanguage,
    playbackStarted,
    selectedMpvSubtitle,
    subtitleOptions,
    subtitlesReady,
  ]);

  useEffect(() => {
    if (!mpvReadyForCommands || !mpvFileLoaded || !audioOptions.length) return;
    if (manualAudioSelectionRef.current) {
      autoLangLog("audio skipped: manual selection");
      return;
    }
    const targetAudio = pickInitialAudioTrack(
      mpvTracks,
      [
        resolvePreferredLanguage(playbackPreferences.firstAudioLanguage, originalLanguage),
        resolvePreferredLanguage(playbackPreferences.secondAudioLanguage, originalLanguage),
      ],
      audioOptions,
    )?.value ?? "";
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
      targetAudio,
      attempt: autoAudioAttemptsRef.current,
      options: audioOptions.slice(0, 6).map(option => option.label),
    });
    setSelectedMpvAudio(targetAudio);
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
    selectedMpvAudio,
  ]);

  useEffect(() => {
    if (!startupGateActiveRef.current || !mpvReadyForCommands) return;

    const preferredSubtitleLanguage = resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage);
    const preferredSubtitle = pickInitialTrackOption(subtitleOptions, preferredSubtitleLanguage);
    const preferredAudio = pickInitialAudio(audioOptions, [
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

    const subtitleSettled = !subtitlesReady
      ? false
      : !preferredSubtitle?.value
        ? true
        : selectedMpvSubtitleRef.current === preferredSubtitle.value || autoSubtitleAttemptsRef.current >= 8;

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

    const timedOut = Date.now() - startupGateStartedAtRef.current > STARTUP_GATE_HARD_TIMEOUT_MS;
    const mustHoldForAudio = audioTargetExists && !audioSettled;
    const mustHoldForSubtitle = subtitleTargetExists && !subtitleSettled;
    if (!timedOut && (mustHoldForAudio || mustHoldForSubtitle)) return;

    startupGateActiveRef.current = false;
    startupGatePausedRef.current = false;
    autoLangLog("startup gate release", {
      audioSettled,
      subtitleSettled,
      audioTargetExists,
      subtitleTargetExists,
      timedOut,
      selectedAudio: selectedMpvAudioRef.current,
      selectedSubtitle: selectedMpvSubtitleRef.current,
      targetAudio: preferredAudio?.value ?? "",
      targetSubtitle: preferredSubtitle?.value ?? "",
    });
    if (!manualPausedRef.current) {
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
    selectedMpvAudio,
    selectedMpvSubtitle,
    subtitleOptions,
    subtitlesReady,
  ]);

  useEffect(() => {
    if (!stream || !mpvFileLoaded || manualPaused) return;
    const launchKey = getPlaybackTarget(stream);
    if (!launchKey || mpvRecoveryKeyRef.current === launchKey) return;
    if (playbackStarted || mpvPausedForCache || (mpvCacheBuffering > 0 && mpvCacheBuffering < 100)) return;
    if (!stalledPlayback || currentTimeRef.current >= 1.5) return;

    mpvRecoveryKeyRef.current = launchKey;
    debugLog("mpv stalled recovery", { launchKey });
    if (manualPausedRef.current) return;
    void sendMpvCommand(["set_property", "pause", false]);
    void sendMpvCommand(["set_property", "speed", 1.0]);
  }, [manualPaused, mpvCacheBuffering, mpvFileLoaded, mpvPausedForCache, playbackStarted, stalledPlayback, stream]);
  usePlayerKeyboardShortcuts({ togglePlay, jump, applyVolume, wakeControls, volume });
  const controlsActive = controlsVisible || showEpisodePanel;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aetherio-player-controls", { detail: { visible: controlsActive } }));
    return () => {
      window.dispatchEvent(new CustomEvent("aetherio-player-controls", { detail: { visible: true } }));
    };
  }, [controlsActive]);

const mediaTitle = selectedMediaName || query?.id || "Reproduccion";
const { activeSegment: activeSkipSegment } = useSkipIntro(query, mediaTitle, currentTime);
const playbackTarget = getPlaybackTarget(stream);
const currentEpisodeIndex = episodeOptions.findIndex(episode => episode.episode === query?.episode);
const currentEpisode = currentEpisodeIndex >= 0 ? episodeOptions[currentEpisodeIndex] : null;
const canGoPrevEpisode = currentEpisodeIndex > 0;
const canGoNextEpisode = currentEpisodeIndex >= 0 && currentEpisodeIndex < episodeOptions.length - 1;
const isMovie = query?.type === "movie";
const showPanelToggle = !isMovie && panelItems.length > 0;

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
  saveContinueWatchingProgress({
    query,
    stream,
    name: mediaTitle,
    logo: sanitizeLogoUrl(selectedMediaLogo || detailLogoUrl || addonLogoUrl || seriesLogoUrl) || undefined,
    background: selectedMediaBackground || behaviorBackground || behaviorPoster || undefined,
    poster: behaviorPoster || undefined,
    episodeName: currentEpisode?.name,
    currentTime,
    duration,
  });
  resumeLog("progress saved", { nearEnd, saveIntervalMs: sinceLastSaveMs });
}, [
  addonLogoUrl,
  currentEpisode?.name,
  currentTime,
  detailLogoUrl,
  duration,
  isTrailerStream,
  mediaTitle,
  query,
  selectedMediaBackground,
  selectedMediaLogo,
  seriesLogoUrl,
  stream,
]);

useEffect(() => {
  if (!query || !stream || isTrailerStream) return;
  const seekKey = `${buildContinueWatchingKey(query)}:${stream.id}`;
  const resumeTime = resumeSeekTargetRef.current;
  if (resumeTime <= 0) {
    resumeSeekSettledRef.current = true;
    resumeLog("resume skipped: no stored target");
    return;
  }
  if (resumeSeekSettledRef.current) return;

  const elapsed = Date.now() - resumeSeekStartedAtRef.current;
  if (elapsed > 22000) {
    resumeSeekSettledRef.current = true;
    resumeLog("resume timeout settled", { elapsedMs: elapsed });
    return;
  }

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
  if (resumeSeekAppliedRef.current !== seekKey) {
    resumeSeekAppliedRef.current = seekKey;
    resumeSeekAttemptsRef.current = 0;
    resumeLog("resume seek key initialized", { seekKey, target });
  }
  if (resumeSeekAttemptsRef.current >= 8) {
    resumeSeekSettledRef.current = true;
    resumeLog("resume exhausted before scheduling", { target });
    return;
  }

  const runSeekAttempt = () => {
    if (currentTimeRef.current >= target - 2) {
      resumeSeekSettledRef.current = true;
      resumeLog("resume settled after seek", { target });
      return;
    }
    if (Date.now() - resumeSeekStartedAtRef.current > 22000) {
      resumeSeekSettledRef.current = true;
      resumeLog("resume timeout inside attempt", { target });
      return;
    }
    resumeSeekAttemptsRef.current += 1;
    resumeLog("resume seek attempt", {
      target,
      attempt: resumeSeekAttemptsRef.current,
      mpvReadyForCommands,
      mpvFileLoaded,
    });
    void sendMpvCommand(["seek", target, "absolute", "exact"]);
    if (resumeSeekAttemptsRef.current >= 8) {
      resumeSeekSettledRef.current = true;
      resumeLog("resume attempts exhausted", { target });
      return;
    }
    resumeSeekTimerRef.current = window.setTimeout(runSeekAttempt, 900);
    resumeLog("resume retry scheduled", { target, delayMs: 900 });
  };

  if (resumeSeekTimerRef.current) {
    window.clearTimeout(resumeSeekTimerRef.current);
    resumeSeekTimerRef.current = null;
  }
  runSeekAttempt();
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
  const mpvError = mpvBundled === false || mpvStatus?.startsWith("MPV no");
  const showFallbackPanel = Boolean(mpvError);
  const selectedSubtitleValue = selectedMpvSubtitle;
  const currentMetaTitle = isMovie ? mediaTitle : (currentEpisode?.name ?? mediaTitle);
  const currentOverview = currentEpisode?.overview?.trim() || "Sin descripcion disponible para este episodio.";
  const behaviorBackground = typeof stream?.behaviorHints?.background === "string" ? stream.behaviorHints.background : "";
  const behaviorPoster = typeof stream?.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : "";
  const loadingArtwork =
    selectedMediaLogo
    || detailLogoUrl
    || addonLogoUrl
    || seriesLogoUrl
    || null;
  const backgroundArtwork =
    selectedMediaBackground
    || behaviorBackground
    || behaviorPoster
    || "";
  const playerVisuallyReady = playbackStarted || (mpvReadyForCommands && mpvFileLoaded && duration > 0);
  const bufferingActive = playerVisuallyReady && playbackStarted && !manualPaused && (mpvPausedForCache || (mpvCacheBuffering > 5 && mpvCacheBuffering < 95) || stalledPlayback);
  const initialPlaybackLoading = !playerVisuallyReady;
  const showPrePlaybackBackdrop = !showFallbackPanel && !playerVisuallyReady && !mpvError;
  const shouldShowLoading = !showFallbackPanel && !manualPaused && !mpvError && ((initialPlaybackLoading && !mpvFileLoaded) || bufferingActive);
  const playerShellClassName = !showFallbackPanel
    ? "relative h-screen w-screen overflow-hidden bg-transparent text-white"
    : "relative h-screen w-screen overflow-hidden bg-[#101014] text-white";
  
  return (
    <div
      className={playerShellClassName}
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      onPointerMove={() => wakeControls()}
      onPointerDown={() => wakeControls()}
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
          <div className="pointer-events-auto liquid-glass-dark max-w-lg rounded-lg p-6 opacity-95 transition-opacity duration-300 hover:opacity-100">
            <h1 className="mb-3 text-xl font-black">libmpv interno</h1>
            {mpvBundled === false && (
              <p className="mb-4 rounded-md bg-white/10 px-4 py-3 text-xs text-white/62">
                MPV interno no esta instalado en el bundle. Instala el runtime compatible con libmpv en src-tauri/bin/mpv y vuelve a empaquetar.
              </p>
            )}
            {mpvStatus && <p className="mb-4 text-xs text-white/58">{mpvStatus}</p>}
            <button onClick={() => void retryMpvPlayback()} className="rounded-md bg-white px-5 py-2.5 font-bold text-black">
              Reintentar reproduccion
            </button>
            {playbackTarget && <p className="mt-4 break-all text-xs text-white/32">{playbackTarget}</p>}
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-transparent" />
      )}

      <PlayerLoadingOverlay visible={shouldShowLoading} artwork={loadingArtwork} title={mediaTitle} />

      {activeSkipSegment && mpvReadyForCommands ? (
        <button
          data-player-interactive
          type="button"
          className="absolute z-40 flex items-center gap-2 rounded-full border border-white/18 bg-white px-5 py-2.5 text-sm font-black text-black shadow-[0_18px_56px_rgba(0,0,0,0.62)] transition hover:scale-[1.03]"
          style={{
            right: "max(24px, calc((100vw - min(1240px, calc(100vw - 32px))) / 2 + 20px))",
            bottom: controlsActive ? 196 : 116,
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
        visible={showEpisodePanel && showPanelToggle}
        title={title}
        streamName={mediaTitle}
        seriesLogoUrl={seriesLogoUrl}
        currentEpisode={currentEpisode}
        currentOverview={currentOverview}
        items={panelItems}
        hasEpisodeOptions={episodeOptions.length > 0}
        canGoPrevEpisode={canGoPrevEpisode}
        canGoNextEpisode={canGoNextEpisode}
        onClose={() => setShowEpisodePanel(false)}
        onNavigateEpisode={navigateEpisode}
      />

      <PlayerControls
        active={controlsActive}
        currentMetaTitle={currentMetaTitle}
        title={title}
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        volume={volume}
        selectedMpvAudio={selectedMpvAudio}
        selectedSubtitleValue={selectedSubtitleValue}
        selectedSpeed={selectedSpeed}
        videoScaleMode={videoScaleMode}
        audioOptions={normalizedAudioOptions}
        subtitleOptions={subtitleOptions}
        speedOptions={speedOptions}
        subtitlesLoading={subtitlesLoading}
        showPanelToggle={showPanelToggle}
        showEpisodePanel={showEpisodePanel}
        hasEpisodeOptions={episodeOptions.length > 0}
        canGoPrevEpisode={canGoPrevEpisode}
        canGoNextEpisode={canGoNextEpisode}
        onControlsEnter={holdControls}
        onControlsLeave={() => releaseControls(2)}
        onSeek={seek}
        onJump={jump}
        onTogglePlay={togglePlay}
        onVolumeChange={applyVolume}
        onAudioChange={value => {
          manualAudioSelectionRef.current = true;
          autoLangLog("audio manual change", { value });
          setSelectedMpvAudio(value);
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
          if (!value) {
            void sendMpvCommand(["set_property", "sid", "no"]);
            return;
          }
          if (value.startsWith("track:")) {
            void sendMpvCommand(["set_property", "sid", Number(value.slice(6))]);
            return;
          }
          if (value.startsWith("ext:")) {
            void sendMpvCommand(["sub-add", value.slice(4), "select"]);
          }
        }}
        onSpeedChange={value => {
          setSelectedSpeed(value);
          void sendMpvCommand(["set_property", "speed", Number(value)]);
        }}
        onToggleVideoScale={toggleVideoScale}
        onToggleEpisodePanel={() => setShowEpisodePanel(value => !value)}
        onNavigateEpisode={navigateEpisode}
      />
    </div>
  );
}

function pickInitialTrackOption(options: { value: string; label: string }[], preferredLanguage: string) {
  const preferred = preferredLanguage
    ? options.find(option => matchesPreferredLanguage(option.label, preferredLanguage))
    : null;
  if (preferred) return preferred;
  return (
    options.find(option => /(?:^|[^a-z])(spa|es|esp|es-419|lat|la|spanish|espanol|español|latino|castellano)(?:[^a-z]|$)/i.test(option.label)) ??
    options.find(option => /(?:^|[^a-z])(eng|en|english|ingles|inglés)(?:[^a-z]|$)/i.test(option.label)) ??
    options[0] ??
    null
  );
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
