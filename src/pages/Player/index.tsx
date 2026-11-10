import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import AppleSpinner from "../../components/ui/AppleSpinner";
import {
  matchesPreferredLanguage,
  resolvePreferredLanguage,
  usePlaybackPreferences,
} from "../../config/playbackPreferences";
import { useOriginalLanguage } from "../../hooks/useOriginalLanguage";
import { useSubtitles } from "../../hooks/useSubtitles";
import { usePlaybackSelection } from "../../hooks/usePlaybackSelection.ts";
import {
  createPlaybackTrackPreference,
  matchPlaybackTrackPreference,
  resolvePlaybackTrackSelection,
} from "../../domain/playbackSelection.ts";
import type { MediaStream, StreamQuery } from "../../types/stream";
import type { SportsMatchArtwork } from "../../types/sportsMatch.ts";
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
import {
  accumulateThroughput,
  createThroughputAccumulator,
  isNetworkSampleEligible,
  recordConnectionSpeedSample,
  type ThroughputAccumulator,
} from "../../utils/connectionSpeed";
import { isPlayableMediaStream } from "../../utils/playableMedia";
import { sortStreamsForPlayback } from "../../utils/streamPlaybackRanking";
import { readDetailMediaMeta, resolveDetailBackground } from "../../utils/mediaMetadata";
import { sendTraktScrobble, syncTraktProgressEntry } from "../../trakt";
import {
  getNativePlaybackStatus,
  getPlaybackCapabilities,
  invokeCommand,
  isTauriRuntime,
  openExternalUrl,
  sendNativePlaybackCommand,
  setNativeMpvVideoProfile,
  setNativeAutocrop,
  setNativeMpvSurfaceVisible,
  stopNativePlayback,
} from "../../runtime/platform";
import type { ChapterOption, MpvStatusSnapshot, MpvTrack, VideoScaleMode } from "./types";
import EpisodePanel from "./EpisodePanel";
import SourcePanel from "./SourcePanel";
import SourceResolver from "./SourceResolver";
import PlayerControls from "./PlayerControls";
import PlayerLoadingOverlay from "./PlayerLoadingOverlay";
import PlayerPauseScreen, { usePauseScreenDelay } from "./PlayerPauseScreen";
import { LiveBadge, LiveEndedNotice } from "./LiveOverlays";
import PlayerActionFeedback, { type PlayerActionFeedbackData, type PlayerFeedbackKind } from "./PlayerActionFeedback";
import PlayerFloatingNotice from "./PlayerFloatingNotice";
import PlayerNextPrompt from "./PlayerNextPrompt";
import { resolvePostPlayAction } from "./postPlayPrompt";
import PlayerContentRating from "./PlayerContentRating";
import { useContentRating } from "./useContentRating";

import UpNext from "../../components/upnext/UpNext";
import { useRelatedRecommendation } from "../../hooks/useRelatedRecommendation";
import { useControlsVisibility } from "./useControlsVisibility";
import { useHiddenCursor } from "../../hooks/useHiddenCursor";
import { useEpisodeMetadata, usePlayerLogos } from "./usePlayerMetadata";
import { usePlayerKeyboardShortcuts } from "./usePlayerKeyboardShortcuts";
import { getRelativeSeekTarget } from "./playerSeek.ts";
import { usePlayerGamepad } from "./usePlayerGamepad";
import { followHorizontalFocus } from "../../navigation/spatialNav.ts";
import { useMpvStatus } from "./useMpvStatus";
import { useLivePlayback } from "./useLivePlayback";
import { liveRetryDelay, LIVE_LOAD_FAILURE_TIMEOUT_MS, LIVE_FIRST_FRAME_TIMEOUT_MS, LIVE_STALL_TIMEOUT_MS, type PlaybackFailure } from "./liveRecovery.ts";
import { useSkipIntro } from "./useSkipIntro";
import { getEpisodeNavigationTarget, isEpisodeReleased, shouldShowMovieRecommendation, shouldShowNextEpisodeCard } from "./nextEpisodeRules";
import { useParty } from "../../party/PartyContext";
import { getPartyCorrection } from "../../party/sync";
import { partyMediaKey, type PartyStreamEvent } from "../../party/protocol";
import { buildShareableOffer, describeUnshareableReason, partyOfferToMediaStream } from "../../party/streamShare";
import { appleEase, gsap } from "../../utils/motion";
import { getUpNextMiniRect } from "../../utils/upnextMiniRect";
import {
  SUBTITLE_DELAY_MAX_MS,
  SUBTITLE_DELAY_MIN_MS,
} from "./subtitleSync/config";
import { formatAutoSyncDelay, serializeWebVttCues } from "./subtitleSync/parser";
import type { AutoSubtitleSyncPlan } from "./subtitleSync/autoSync";
import { getSavedSubtitleDelayMs, saveSubtitleDelayMs } from "./subtitleSync/storage";
import { buildAutoSyncTitleKey, clearAutoSyncTitleMode } from "./subtitleSync/autoSyncPreference";
import { useSubtitleSync } from "./subtitleSync/useSubtitleSync";
import {
  VIDEO_ENHANCEMENT_OPTIONS,
  normalizeVideoEnhancementProfile,
  readVideoEnhancementProfile,
  saveVideoEnhancementProfile,
} from "./videoEnhancements";
import { presentAudioTrack, resolveHeaderAudioBadges } from "./audioTech";
import { getBigPictureHeaderBadges } from "../../utils/streamFormatters";
import { LOCAL_FILES_DROPPED_EVENT } from "../../utils/localMedia";
import { useDiscordPresence } from "../../hooks/useDiscordPresence";
import {
  AUTO_NEXT_SOURCE_KEY,
  AVAILABLE_STREAMS_KEY,
  SELECTED_ENGINE_KEY,
  SELECTED_MEDIA_META_KEY,
  SELECTED_PLAYBACK_OVERRIDES_KEY,
  SELECTED_STREAM_KEY,
  availableStreamsMediaKey,
  buildQuery,
  formatTime,
  getPlaybackTarget,
  getStreamKind,
  isLocalPlaybackStream,
  openExternal,
  playbackOverrideQueryKey,
} from "./utils";
import { buildDetailPath, buildEpisodePath, buildPlayerBackPath, buildPlayerPath, isBigPictureLocation } from "../../utils/bigPictureDetail";

const DEBUG_AUTOPLAY = false;
const DEBUG_AUTO_LANG = true;
const DEBUG_RESUME = true;
const DIRECT_STARTUP_GATE_TIMEOUT_MS = 900;
const P2P_STARTUP_GATE_TIMEOUT_MS = 3500;
const LOAD_FAILURE_TIMEOUT_MS = 12_000;
const P2P_LOAD_FAILURE_TIMEOUT_MS = 180000;
const DIRECT_FIRST_FRAME_TIMEOUT_MS = 8_000;
// Party: ventana anti-eco tras aplicar una acción remota, salto mínimo que
// cuenta como seek manual, tolerancia de deriva y periodo de re-sync.
const PARTY_ECHO_WINDOW_MS = 1500;
const PARTY_SEEK_JUMP_S = 3;
const PARTY_DRIFT_TOLERANCE_S = 1.0;
const PARTY_DRIFT_INTERVAL_MS = 6_000;
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

/**
 * Instantanea de `AVAILABLE_STREAMS_KEY` ya filtrada y ordenada.
 *
 * Devuelve `null` si no hay entrada utilizable. El formato viejo (array suelto,
 * sin clave de medio) se descarta a proposito: no se puede verificar de que
 * titulo es, y aceptarlo era la causa de que el panel apareciera con las fuentes
 * de otro contenido o no apareciera nunca. Si falta, el panel se resuelve en el
 * propio Player al abrirse.
 */
function readAvailableStreamsSnapshot(): { key: string; streams: MediaStream[] } | null {
  try {
    const raw = sessionStorage.getItem(AVAILABLE_STREAMS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const envelope = parsed as { key?: unknown; streams?: unknown };
    if (typeof envelope.key !== "string" || !envelope.key || !Array.isArray(envelope.streams)) return null;
    const streams = envelope.streams.filter((candidate): candidate is MediaStream => (
        Boolean(candidate)
        && typeof candidate === "object"
        && isPlayableMediaStream(candidate as MediaStream)
    ));
    return {
      key: envelope.key,
      streams: streams.every(stream => stream.behaviorHints?.live === true) ? streams : sortStreamsForPlayback(streams),
    };
} catch {
    return null;
  }
}

function writeAvailableStreamsSnapshot(mediaKey: string, streams: MediaStream[]) {
  if (!mediaKey) return;
  try {
    sessionStorage.setItem(AVAILABLE_STREAMS_KEY, JSON.stringify({ key: mediaKey, streams }));
  } catch {
    // Cuota llena o sessionStorage no disponible: el panel se resuelve al abrir.
  }
}

export default function PlayerPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mpvLaunchKeyRef = useRef("");
  const mpvRecoveryKeyRef = useRef("");
  const launchStartedAtRef = useRef(0);
  const nextEpisodeAutoKeyRef = useRef("");
  const upNextShownKeyRef = useRef("");
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const playbackProgressReadyRef = useRef(false);
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
  const holdSpeedTimerRef = useRef<number | null>(null);
  const holdSpeedActiveRef = useRef(false);
  const holdSpeedRestoreRef = useRef(1);
  const ignoreNextScreenClickRef = useRef(false);
  const traktStartedKeyRef = useRef("");
  const traktStoppedKeyRef = useRef("");
  const nextEpisodePromptKeyRef = useRef("");
  const skipButtonRef = useRef<HTMLButtonElement | null>(null);
  const postPlayRef = useRef<HTMLDivElement | null>(null);
  const [postPlayDismissedKey, setPostPlayDismissedKey] = useState("");
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const fallbackRetryButtonRef = useRef<HTMLButtonElement | null>(null);
  const autoSubtitlePathRef = useRef("");
  const throughputAccumulatorRef = useRef<ThroughputAccumulator>(createThroughputAccumulator(""));

  const [stream, setStream] = useState<MediaStream | null>(null);
  const isLocalPlayback = isLocalPlaybackStream(stream);
  const isP2pStream = getStreamKind(stream) === "p2p";
  const startupGateTimeoutMs = isP2pStream
    ? P2P_STARTUP_GATE_TIMEOUT_MS
    : DIRECT_STARTUP_GATE_TIMEOUT_MS;
  const [selectedMediaName, setSelectedMediaName] = useState("");
  const [selectedMediaBackground, setSelectedMediaBackground] = useState("");
  const [selectedMediaLogo, setSelectedMediaLogo] = useState("");
  const [selectedSportsMatch, setSelectedSportsMatch] = useState<SportsMatchArtwork>();
  const [selectedMediaPoster, setSelectedMediaPoster] = useState("");
  const [selectedResumeTime, setSelectedResumeTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [manualPaused, setManualPaused] = useState(false);
  const playbackPreferences = usePlaybackPreferences();
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [timelinePreviewTime, setTimelinePreviewTime] = useState<number | null>(null);
  const timelinePreviewTimeRef = useRef<number | null>(null);
  const [volume, setVolume] = useState(0.86);
  const { controlsVisible, setControlsVisible, wakeControls, holdControls, releaseControls } = useControlsVisibility(3000);
  // Modo de navegación de la barra compartido por mando y teclado. El foco
  // inicial cae en timeline; arriba va a controles, abajo abre episodios y B
  // sale de la barra. La zona se deriva del elemento enfocado y se mantiene
  // explícita para que D-pad, stick y flechas sigan el mismo mapa.
  const [gamepadBarMode, setGamepadBarMode] = useState(false);
  const [barZone, setBarZone] = useState<"timeline" | "buttons" | "episodes">("timeline");
  const [barFocusWithin, setBarFocusWithin] = useState(false);
  const [bigPictureEpisodesOpen, setBigPictureEpisodesOpen] = useState(false);
  const episodeRowWasOpenRef = useRef(false);
  const episodeRowShouldResumeRef = useRef(false);
  const episodeRowPauseOwnedRef = useRef(false);
  const handleBarFocusChange = useCallback((zone: "timeline" | "buttons" | "episodes") => {
    setBarZone(zone);
  }, []);
  const handleBarFocusWithinChange = useCallback((within: boolean) => {
    setBarFocusWithin(within);
  }, []);
  // OSD central: iconos de play/pausa/seek/volumen SIN despertar la barra (§1 respuesta inmediata).
  const [actionFeedback, setActionFeedback] = useState<PlayerActionFeedbackData | null>(null);
  const actionFeedbackIdRef = useRef(0);
  const actionFeedbackTimerRef = useRef<number | null>(null);

  const flashActionFeedback = useCallback((kind: PlayerFeedbackKind, extra?: { deltaSeconds?: number; volume?: number }) => {
    actionFeedbackIdRef.current += 1;
    setActionFeedback({
      id: actionFeedbackIdRef.current,
      kind,
      deltaSeconds: extra?.deltaSeconds,
      volume: extra?.volume,
    });
    if (actionFeedbackTimerRef.current !== null) window.clearTimeout(actionFeedbackTimerRef.current);
    actionFeedbackTimerRef.current = window.setTimeout(() => {
      actionFeedbackTimerRef.current = null;
      setActionFeedback(null);
    }, 950);
  }, []);

  useEffect(() => () => {
    if (actionFeedbackTimerRef.current !== null) window.clearTimeout(actionFeedbackTimerRef.current);
  }, []);
  const [selectedMpvSubtitle, setSelectedMpvSubtitle] = useState("");
  const [selectedMpvAudio, setSelectedMpvAudio] = useState("");
  const [selectedSpeed, setSelectedSpeed] = useState("1");
  const [selectedVideoProfile, setSelectedVideoProfile] = useState(readVideoEnhancementProfile);
  const appliedVideoProfileRef = useRef(selectedVideoProfile);
  const videoProfileRequestRef = useRef(0);
  const videoProfileQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [subtitleScalePercent, setSubtitleScalePercent] = useState(100);
  const [subtitleVerticalPercent, setSubtitleVerticalPercent] = useState(5);
  const [mpvStatus, setMpvStatus] = useState<string | null>(null);
  const [liveFailure, setLiveFailure] = useState<PlaybackFailure | null>(null);
  const [liveRetryAttempts, setLiveRetryAttempts] = useState(0);
  const [mpvRetryVersion, setMpvRetryVersion] = useState(0);
  const pendingNativeStopRef = useRef<Promise<unknown>>(Promise.resolve());
  const [mpvBundled, setMpvBundled] = useState<boolean | null>(null);
  const [mpvTracks, setMpvTracks] = useState<MpvTrack[]>([]);
  const [mpvVideoWidth, setMpvVideoWidth] = useState<number | null>(null);
  const [mpvVideoHeight, setMpvVideoHeight] = useState<number | null>(null);
  const [mpvEofReached, setMpvEofReached] = useState(false);
  const [mpvDemuxerCacheDuration, setMpvDemuxerCacheDuration] = useState(0);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [chapterOptions, setChapterOptions] = useState<ChapterOption[]>([]);
  const [activeSidePanel, setActiveSidePanel] = useState<"episodes" | "sources" | null>(null);
  // Menú flotante de la barra (audio/subtítulos/velocidad/mejoras/party),
  // elevado desde PlayerControls para que el mando (X) lo abra de forma tipada.
  const [playerMenu, setPlayerMenu] = useState<string | null>(null);
  const [availableStreams, setAvailableStreams] = useState<MediaStream[]>([]);
  const [resolvingSources, setResolvingSources] = useState(false);
  const resolveAttemptedKeyRef = useRef("");
  const [showUpNext, setShowUpNext] = useState(false);
  // ---- Party (visionado sincronizado): cada app resuelve su propio stream ----
  const [partyCodeCopied, setPartyCodeCopied] = useState(false);
  const partyLastSentMediaKeyRef = useRef("");
  const partyJustFollowedKeyRef = useRef("");
  const partyLastAppliedControlAtRef = useRef(0);
  const partySyncNudgeRef = useRef<number | null>(null);
  const partyLastPublishedRateRef = useRef(selectedSpeed);
  const partyLastSeekTimeRef = useRef<number | null>(null);
  const partyConnectedAtRef = useRef(0);
  // ---- Party mismo-stream: puntero compartido (URL/magnet del grupo) ----
  const [partyStreamFailed, setPartyStreamFailed] = useState(false);
  // ---- Party espera de la fuente del anfitrión: aviso tras 12s + salida.
  const [partyWaitExceeded, setPartyWaitExceeded] = useState(false);
  const partyLastSharedTargetRef = useRef("");
  const partyAppliedOfferAtRef = useRef(0);
  const partyAppliedOfferTargetRef = useRef("");
  const partyFailedTargetRef = useRef("");
  const partyStreamSwitchAtRef = useRef(0);
  // ---- Party anti-grief: tope de acciones remotas por peer ----
  const partyPeerControlLogRef = useRef<Record<string, number[]>>({});
  const partyMutedPeersRef = useRef<Record<string, number>>({});
  // ---- Party espera por buffering: pausar al grupo hasta que carguen ----
  const partyBufferTimerRef = useRef(0);
  const partyBufferingSentRef = useRef(false);
  const partyWaitPauseRef = useRef(false);
  const partyWaitOverrideRef = useRef(false);
  const partyPrevPlayingRef = useRef(false);
  // ---- Party lobby (sala de espera): retener el inicio hasta "Empezar" ----
  const partyLobbyRef = useRef(false);
  const partyLobbyPrevRef = useRef(false);
  const partyLobbyStartBypassRef = useRef(false);
  const partyLobbyAppliedStartRef = useRef(0);
  const partyWasOwnerRef = useRef(false);
  const [playbackStarted, setPlaybackStarted] = useState(false);
  const [mpvReadyForCommands, setMpvReadyForCommands] = useState(false);
  const [mpvFileLoaded, setMpvFileLoaded] = useState(false);
  const [resumeSeekReady, setResumeSeekReady] = useState(true);
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
  const [playbackSelectionNotice, setPlaybackSelectionNotice] = useState("");
  const playbackSelectionNoticeTimerRef = useRef<number | null>(null);
  const audioFallbackNoticeKeyRef = useRef("");
  const [videoFilterNotice, setVideoFilterNotice] = useState("");
  const videoFilterNoticeTimerRef = useRef<number | null>(null);
  const [repeatLocal, setRepeatLocal] = useState(false);
  const localPlaybackKey = params.get("local");

  const query = useMemo(() => buildQuery(params), [
  params.get("type"),
  params.get("id"),
  params.get("season"),
  params.get("ep"),
  ]);
  const playbackSelection = usePlaybackSelection(query);
  const isSportsReplay = query?.type === "sports-replay";
  const vodMetadataQuery = isSportsReplay ? null : query;
  const { episodeOptions, seriesLogoUrl, nextSeasonEpisode, episodeMetadataReady } = useEpisodeMetadata(vodMetadataQuery);
  const { addonLogoUrl, detailLogoUrl } = usePlayerLogos(vodMetadataQuery, stream);
  const safeStream = stream ?? null;
  // Calculated with the other unconditional hooks: PlayerPage has loading and
  // empty-state returns later in render, so this memo must stay above them.
  const { service: streamingServiceBadge, video: videoFormatBadges } = useMemo(
    () => getBigPictureHeaderBadges(safeStream),
    [safeStream],
  );
  const isIframeStream = safeStream?.behaviorHints?.scraperPlayback === "iframe";
  // Ambos modos comparten la superficie inmersiva; TV conserva su barra clásica
  // mediante `legacyTv` y abre episodios en la fila horizontal del reproductor.
  const isBigPictureRoute = isBigPictureLocation();
  const isBigPicturePlayer = true;
  const trailerRequested = params.get("trailer") === "1";
  const isTrailerStream = trailerRequested || Boolean(safeStream?.ytId);

  // El medio ya está en marcha: es la condición para esconder el puntero (y
  // la que enciende la barra de controles más abajo).
  const controlsReady = playbackStarted || (mpvReadyForCommands && mpvFileLoaded);

  // Puntero del reproductor, con la misma política en los dos modos:
  //  - Big Picture: manda el mando. El cursor se esconde al primer input del
  //    mando y solo vuelve (temporalmente) al mover el ratón. Aquí importa
  //    `GAMEPAD_ACTIVITY_EVENT` y no el teclado: el gamepad de este player
  //    reclama sus acciones con preventDefault(), así que no llega ninguna
  //    flecha sintética que pueda esconderlo.
  //  - Modo normal: con medio en marcha, 3 s sin ratón ni teclado esconden el
  //    cursor; el primer movimiento lo devuelve.
  // Se apoya en la clase global de `useHiddenCursor` (cursor: none !important)
  // y no en un estilo en línea: así también desaparece sobre la barra de
  // controles, cuyos botones traen `cursor: pointer` propio que lo pisaría.
  useHiddenCursor(isBigPictureRoute ? "gamepad" : "idle", {
    idleMs: isBigPictureRoute ? 2500 : 3000,
    enabled: controlsReady,
  });

  // Entrar en la fila pausa sólo si la reproducción estaba avanzando. Al
  // volver al timeline se reanuda esa pausa automática; una pausa manual previa
  // o hecha por el usuario mientras la fila está abierta se respeta.
  useEffect(() => {
    const wasOpen = episodeRowWasOpenRef.current;
    episodeRowWasOpenRef.current = bigPictureEpisodesOpen;
    if (!isBigPicturePlayer || wasOpen === bigPictureEpisodesOpen) return;

    if (bigPictureEpisodesOpen) {
      const shouldResume = playbackStarted && playing && !manualPausedRef.current && !partyLobbyRef.current;
      episodeRowShouldResumeRef.current = shouldResume;
      episodeRowPauseOwnedRef.current = shouldResume;
      if (!shouldResume) return;

      manualPausedRef.current = true;
      setManualPaused(true);
      setPlaying(false);
      setStalledPlayback(false);
      void sendMpvCommand(["set_property", "pause", true]);
      return;
    }

    const resumeAfterBrowse = episodeRowShouldResumeRef.current
      && episodeRowPauseOwnedRef.current
      && !partyLobbyRef.current;
    episodeRowShouldResumeRef.current = false;
    episodeRowPauseOwnedRef.current = false;
    if (!resumeAfterBrowse || !manualPausedRef.current) return;

    manualPausedRef.current = false;
    setManualPaused(false);
    setPlaying(true);
    setStalledPlayback(false);
    lastProgressAtRef.current = Date.now();
    void sendMpvCommand(["set_property", "cache-pause", false]);
    void sendMpvCommand(["set_property", "pause", false]);
    void sendMpvCommand(["set_property", "speed", Number(selectedSpeed) || 1.0]);
  }, [bigPictureEpisodesOpen, isBigPicturePlayer, playbackStarted, playing, selectedSpeed]);

  useEffect(() => {
    if (!bigPictureEpisodesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeEpisodeRow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bigPictureEpisodesOpen]);

  // El panel de fuentes ya no depende de que haya una instantanea guardada: se
  // ofrece siempre que el medio pueda tener alternativas y se resuelve al abrir.
  // Un trailer o un archivo local no las tienen, asi que ahi no se ofrece.
  const sourcesMediaKey = availableStreamsMediaKey(query);
  const canHaveSources = !isTrailerStream && !isLocalPlayback && Boolean(sourcesMediaKey);
  // Al abrir el panel sin lista previa hay que resolverla; al cerrarlo se limpia
  // el intento para que la proxima apertura vuelva a intentarlo (los hooks
  // cachean, asi que no cuesta scraping nuevo).
  useEffect(() => {
    if (activeSidePanel !== "sources" || isSportsReplay) {
      resolveAttemptedKeyRef.current = "";
      setResolvingSources(false);
      return;
    }
    if (!availableStreams.length && resolveAttemptedKeyRef.current !== sourcesMediaKey) {
      setResolvingSources(true);
    }
  }, [activeSidePanel, availableStreams.length, sourcesMediaKey, isSportsReplay]);
  // Un directo no tiene duracionKnown, no se reanuda y no tiene capitulos: todo
  // el codigo de VOD (progress, creditos, intro/outro) queda colgando de
  // `duration`, asi que se apaga por flag en vez de por numero para no dejar
  // ninguno de esos caminos activo por accidente.
  const isLiveStream = safeStream?.behaviorHints?.live === true || query?.type === "live";
  const isSportsLiveStream = query?.type === "live";
  const metadataQuery = isTrailerStream || isLiveStream || isSportsReplay ? null : query;
  const livePlayback = useLivePlayback({
    enabled: isLiveStream,
    timePos: currentTime,
    demuxerCacheDuration: mpvDemuxerCacheDuration,
    eofReached: mpvEofReached,
    playing,
  });
  useEffect(() => {
    if (!isSportsLiveStream || !mpvReadyForCommands || !mpvFileLoaded) return;
    desiredSubtitleSelectionRef.current = "";
    desiredSubtitleSelectionSetRef.current = true;
    setSelectedMpvSubtitle("");
    void sendMpvCommand(["set_property", "sid", "no"]);
  }, [isSportsLiveStream, mpvFileLoaded, mpvReadyForCommands]);
  const originalLanguage = useOriginalLanguage(metadataQuery, safeStream);
  const contentRating = useContentRating(metadataQuery);
  const [contentRatingVisible, setContentRatingVisible] = useState(false);
  const contentRatingPlaybackKeyRef = useRef("");
  const contentRatingPlaybackStartedAtRef = useRef(0);
  const contentRatingKey = query
    ? `${query.type}:${query.id}:${query.season ?? ""}:${query.episode ?? ""}`
    : "";
  const completeContentRating = useCallback(() => {
    setContentRatingVisible(false);
  }, []);
  const resumeEntry = useMemo(() => getExactResumeForQuery(query), [query]);
  const savedAudioSelection = useMemo(() => getContinueWatchingAudioSelection(query), [query]);
  const selectedPlaybackOverrides = useMemo(() => readSelectedPlaybackOverrides(query), [query]);
  const routeAudioPreference = useMemo(() => createPlaybackTrackPreference({
    value: "legacy-session",
    language: selectedPlaybackOverrides?.selectedAudioLanguage,
    label: selectedPlaybackOverrides?.selectedAudioLabel,
  }), [selectedPlaybackOverrides?.selectedAudioLanguage, selectedPlaybackOverrides?.selectedAudioLabel]);
  const legacyAudioPreference = useMemo(() => {
    const fromAudioCache = createPlaybackTrackPreference({
      value: "legacy-episode",
      language: savedAudioSelection?.trackLang || savedAudioSelection?.language,
      title: savedAudioSelection?.trackTitle,
      label: savedAudioSelection?.label,
    });
    if (fromAudioCache) return fromAudioCache;
    return createPlaybackTrackPreference({
      value: "legacy-episode",
      language: resumeEntry?.selectedAudioLanguage,
      label: resumeEntry?.selectedAudioLabel,
    });
  }, [resumeEntry?.selectedAudioLabel, resumeEntry?.selectedAudioLanguage, savedAudioSelection]);
  const routeSubtitlePreference = useMemo(() => {
    if (selectedPlaybackOverrides?.forceSubtitleSelection) {
      if (!selectedPlaybackOverrides.selectedSubtitle) {
        return { language: "", title: "", forced: false, sdh: false, subtitleMode: "off" as const };
      }
      return createPlaybackTrackPreference({
        value: "legacy-session",
        language: selectedPlaybackOverrides.selectedSubtitleLanguage,
        label: selectedPlaybackOverrides.selectedSubtitleLabel,
      }, "language");
    }
    return null;
  }, [selectedPlaybackOverrides]);
  const legacySubtitlePreference = useMemo(() => {
    if (resumeEntry && Object.prototype.hasOwnProperty.call(resumeEntry, "selectedSubtitle")) {
      if (!resumeEntry.selectedSubtitle) {
        return { language: "", title: "", forced: false, sdh: false, subtitleMode: "off" as const };
      }
      return createPlaybackTrackPreference({
        value: "legacy-episode",
        language: resumeEntry.selectedSubtitleLanguage,
        label: resumeEntry.selectedSubtitleLabel,
      }, "language");
    }
    return null;
  }, [resumeEntry]);
  const episodeAudioPreference = playbackSelection.episode?.audio ?? legacyAudioPreference;
  const episodeSubtitlePreference = playbackSelection.episode?.subtitle ?? legacySubtitlePreference;
  const subtitleIntent = routeSubtitlePreference ?? episodeSubtitlePreference ?? playbackSelection.delivery?.subtitle;
  const subtitlesExplicitlyOff = subtitleIntent?.subtitleMode === "off";
  const { subtitles: addonSubtitles, loading: subtitlesLoading, ready: subtitlesReady } = useSubtitles(
    metadataQuery,
    safeStream,
    "",
    subtitlesExplicitlyOff,
  );
  const { recommendation: relatedRecommendation } = useRelatedRecommendation(metadataQuery);
  const related = { recommendation: relatedRecommendation };

  useEffect(() => {
    if (!query) return;
    setSubtitleDelayMs(getSavedSubtitleDelayMs(query));
  }, [query]);

  const hasMpvError = !isLeavingPlayer && (mpvBundled === false || mpvStatus?.startsWith("MPV no"));
  const nativeSurfaceVisible = !isIframeStream && Boolean(stream && mpvReadyForCommands && mpvFileLoaded && playbackStarted && !hasMpvError);
const showFallbackPanel = Boolean(hasMpvError) && !isLeavingPlayer;

  const currentEpisode = query?.season && query?.episode
    ? episodeOptions.find(ep => ep.episode === query.episode) ?? null
    : null;
  const currentOverview = currentEpisode?.overview?.trim() || "Sin descripción disponible para este episodio.";

  const streamBehaviorBackground = typeof safeStream?.behaviorHints?.background === "string" ? safeStream.behaviorHints.background : "";
  const streamBehaviorPoster = typeof safeStream?.behaviorHints?.poster === "string" ? safeStream.behaviorHints.poster : "";
  const sharedArtwork = selectedSportsMatch
    ? ""
    : selectedMediaBackground
      || resumeEntry?.background
      || resumeEntry?.poster
      || streamBehaviorBackground
      || streamBehaviorPoster;

  const contrastArtwork = ensureOriginalTmdbImage(
    query?.type === "movie"
      ? sharedArtwork
      : currentEpisode?.still || sharedArtwork,
  );

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
    void setNativeMpvSurfaceVisible(nativeSurfaceVisible).catch(error => {
      console.warn("[AETHERIO:PLAYER:SURFACE] visibility sync failed", String(error));
    });
    return () => {
      void setNativeMpvSurfaceVisible(false).catch(() => undefined);
    };
  }, [nativeSurfaceVisible]);

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
    const mediaKey = availableStreamsMediaKey(query);
    const rawAvailable = readAvailableStreamsSnapshot();
    // La lista solo sirve si es del medio que se esta reproduciendo. Antes se
    // aceptaba la que hubiera en la sesion: se veia el panel con las fuentes de
    // otro titulo, o no se veia nada porque la anterior venia vacia.
    const snapshot = mediaKey && rawAvailable?.key === mediaKey ? rawAvailable : null;
    setAvailableStreams(snapshot ? snapshot.streams : []);
    resolveAttemptedKeyRef.current = snapshot ? mediaKey : "";
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as MediaStream;
      if (savedMediaMeta) {
        try {
          const parsedMeta = JSON.parse(savedMediaMeta) as { name?: string; logo?: string; background?: string; poster?: string; resumeTime?: number; sportsMatch?: SportsMatchArtwork };
          const metadataSeed = query ? readDetailMediaMeta(query.type, query.id) : undefined;
          const background = query
            ? resolveDetailBackground(query.type, query.id, parsedMeta.background ?? metadataSeed?.background ?? parsedMeta.poster)
            : parsedMeta.background ?? parsedMeta.poster;
          setSelectedMediaName(typeof parsedMeta.name === "string" ? parsedMeta.name : "");
          setSelectedMediaBackground(typeof background === "string" ? background : "");
          setSelectedMediaLogo(sanitizeLogoUrl(parsedMeta.logo) ?? "");
          setSelectedSportsMatch(parsedMeta.sportsMatch);
          setSelectedMediaPoster(typeof parsedMeta.poster === "string" && parsedMeta.poster ? parsedMeta.poster : (typeof background === "string" ? background : ""));
          setSelectedResumeTime(Number.isFinite(parsedMeta.resumeTime) ? Math.max(0, Number(parsedMeta.resumeTime)) : 0);
        } catch {
          setSelectedMediaName("");
          setSelectedMediaBackground("");
          setSelectedMediaLogo("");
          setSelectedSportsMatch(undefined);
          setSelectedMediaPoster("");
          setSelectedResumeTime(0);
        }
      }
      setStream(parsed);
      sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    } catch {
      setStream(null);
    }
  }, [localPlaybackKey]);

  useEffect(() => {
    // Sin fallback automatico: si la fuente elegida no llega a cargar (error
    // de MPV, timeout de carga o archivo sin cuadros reproducibles), se vuelve
    // al picker de Episodie (`fromPlayer=1`) para que el usuario elija otra.
    // El Player nunca cambia de stream por su cuenta.
    // Los directos (`type=live`) quedan fuera: no tienen picker al que volver
    // (Episodie no maneja eventos live) y conservan el panel de Fuentes del
    // reproductor para cambiar de fuente a mano.
    if (isP2pStream || params.get("type") === "live" || !mpvStatus?.startsWith("MPV no pudo cargar esta fuente") || leavingPlayerRef.current) return;
    leavingPlayerRef.current = true;
    setIsLeavingPlayer(true);
    setMpvStatus(null);
    const target = getStreamsPath() ?? getDetailPath();
    void stopNativePlayback()
      .finally(() => {
        if (target) {
          navigate(target, { replace: true });
          return;
        }
        navigate(-1);
      });
  }, [isP2pStream, mpvStatus, params, navigate]);

  useEffect(() => {
    getPlaybackCapabilities()
      .then(result => setMpvBundled(result.mpvBundled))
      .catch(() => setMpvBundled(false));
  }, []);

  const handleMpvThroughputStatus = useCallback((status: MpvStatusSnapshot) => {
    const sessionKey = stream?.id || stream?.url || "none";
    if (isP2pStream || !isNetworkSampleEligible(stream?.url)) {
      throughputAccumulatorRef.current = createThroughputAccumulator(sessionKey);
      return;
    }
    const result = accumulateThroughput(throughputAccumulatorRef.current, {
      sessionKey,
      at: Date.now(),
      fileLoaded: Boolean(status.fileLoaded),
      idle: status.demuxerCacheIdle !== false,
      bytesPerSecond: Number(status.cacheSpeedBytesPerSecond ?? 0),
      positionSeconds: Number(status.timePos ?? 0),
    });
    throughputAccumulatorRef.current = result.state;
    if (result.completedSample) recordConnectionSpeedSample(result.completedSample);
  }, [isP2pStream, stream?.id, stream?.url]);

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
    setMpvEofReached,
    setMpvDemuxerCacheDuration,
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
    onThroughputStatus: handleMpvThroughputStatus,
    isP2pStream,
    isLiveStream,
    onPlaybackFailure: failure => {
      if (!leavingPlayerRef.current && isLiveStream) setLiveFailure(failure);
    },
    // Until open_mpv resolves, its cached snapshot can still belong to the
    // stopped core. Do not expose that frame or save it under the new title.
    enabled: Boolean(stream) && mpvReadyForCommands && !isIframeStream,
  });

  useEffect(() => {
    selectedMpvAudioRef.current = selectedMpvAudio;
  }, [selectedMpvAudio]);

  useEffect(() => {
    selectedMpvSubtitleRef.current = selectedMpvSubtitle;
  }, [selectedMpvSubtitle]);

  useEffect(() => {
    if (mpvFileLoaded && isTauriRuntime() && !isIframeStream) {
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
    if (!mpvFileLoaded) return;
    applyVideoScale(videoScaleMode);
    void sendMpvCommand(["set_property", "volume", Math.round(volume * 100)]);
    const hwdec = playbackPreferences.hardwareDecoding === "disabled"
      ? "no"
      : playbackPreferences.hardwareDecoding === "enabled"
        ? "auto"
        : "auto-safe";
    void sendMpvCommand(["set_property", "hwdec", hwdec]);
    if (!isTauriRuntime() || isIframeStream) return;

    const profile = selectedVideoProfile;
    const requestId = ++videoProfileRequestRef.current;
    setMpvStatus(`Configurando perfil de vídeo en MPV…`);
    videoProfileQueueRef.current = videoProfileQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (requestId !== videoProfileRequestRef.current) return;
        const result = await setNativeMpvVideoProfile(profile);
        if (!result || requestId !== videoProfileRequestRef.current) return;
        console.info("[AETHERIO:VIDEO-FILTER]", result);
        appliedVideoProfileRef.current = profile;
        saveVideoEnhancementProfile(profile);
        setMpvStatus(null);
        const label = VIDEO_ENHANCEMENT_OPTIONS.find(option => option.value === profile)?.label ?? profile;
        setVideoFilterNotice(`Perfil configurado en MPV: ${label}`);
        if (videoFilterNoticeTimerRef.current !== null) window.clearTimeout(videoFilterNoticeTimerRef.current);
        videoFilterNoticeTimerRef.current = window.setTimeout(() => {
          videoFilterNoticeTimerRef.current = null;
          setVideoFilterNotice("");
        }, 2600);
      })
      .catch(error => {
        if (requestId !== videoProfileRequestRef.current) return;
        console.error("[AETHERIO:VIDEO-FILTER] No se pudo configurar el perfil.", error);
        const previousProfile = appliedVideoProfileRef.current;
        setSelectedVideoProfile(previousProfile);
        saveVideoEnhancementProfile(previousProfile);
        setMpvStatus(`Mejoras de vídeo: ${String(error)}`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el volumen se setea por separado; re-aplicar el perfil por cada tick del slider era un bug.
  }, [isIframeStream, mpvFileLoaded, playbackPreferences.hardwareDecoding, selectedVideoProfile, videoScaleMode]);

  // Repetir (loop): solo para archivos locales reproducidos con MPV.
  useEffect(() => {
    if (!isLocalPlayback) return;
    if (!mpvFileLoaded) return;
    void sendMpvCommand(["set_property", "loop-file", repeatLocal ? "inf" : "no"]);
  }, [isLocalPlayback, mpvFileLoaded, repeatLocal]);

  useEffect(() => {
    if (!isLocalPlayback) setRepeatLocal(false);
  }, [isLocalPlayback]);

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

  const showSubtitleSyncNotice = useCallback((message: string) => {
    setSubtitleSyncNotice(message);
    if (subtitleSyncNoticeTimerRef.current !== null) {
      window.clearTimeout(subtitleSyncNoticeTimerRef.current);
    }
    subtitleSyncNoticeTimerRef.current = window.setTimeout(() => {
      subtitleSyncNoticeTimerRef.current = null;
      setSubtitleSyncNotice("");
    }, 2400);
  }, []);

  const handleSubtitleSyncApply = useCallback((delayMs: number) => {
    setSubtitleDelayMs(delayMs);
    applySubtitleSettings({ delayMs });
    saveSubtitleDelayMs(query, delayMs);
    showSubtitleSyncNotice(`Sync aplicado: ${formatAutoSyncDelay(delayMs)}`);
  }, [applySubtitleSettings, query, showSubtitleSyncNotice]);

  const handleAutoSubtitleSyncApply = useCallback(async (plan: AutoSubtitleSyncPlan) => {
    if (plan.mode === "delay") {
      handleSubtitleSyncApply(plan.delayMs);
      return;
    }
    if (plan.mode !== "retime") throw new Error("No se encontró una sincronización segura.");
    const path = await invokeCommand<string>("cache_subtitle_text", {
      text: serializeWebVttCues(plan.cues),
    });
    autoSubtitlePathRef.current = path;
    setSubtitleDelayMs(0);
    applySubtitleSettings({ delayMs: 0 });
    saveSubtitleDelayMs(query, 0);
    await sendMpvCommand(["sub-add", path, "select", "Aetherio Auto Sync", "und"]);
    showSubtitleSyncNotice(`Auto Sync aplicado · ${Math.round(plan.confidence * 100)}%`);
  }, [applySubtitleSettings, handleSubtitleSyncApply, query, showSubtitleSyncNotice]);

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
    if (playbackSelectionNoticeTimerRef.current !== null) {
      window.clearTimeout(playbackSelectionNoticeTimerRef.current);
      playbackSelectionNoticeTimerRef.current = null;
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
    if (!stream || isLiveStream || !stalledPlayback || !playbackStarted || manualPaused) return;
      const interval = window.setInterval(() => {
        if (manualPausedRef.current) return;
        void sendMpvCommand(["set_property", "pause", false]);
        void sendMpvCommand(["set_property", "speed", 1.0]);
      }, 1500);
    return () => window.clearInterval(interval);
  }, [isLiveStream, manualPaused, playbackStarted, stalledPlayback, stream]);

  useEffect(() => {
    if (!stream || isLiveStream || manualPaused || startupGateActiveRef.current || playbackStarted || !mpvReadyForCommands || !mpvFileLoaded) return;

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
  }, [isLiveStream, manualPaused, mpvCacheBuffering, mpvFileLoaded, mpvPausedForCache, mpvReadyForCommands, playbackStarted, stream]);

  useEffect(() => {
    setLiveRetryAttempts(0);
    setLiveFailure(null);
  }, [stream?.id, stream?.url]);

  useEffect(() => {
    if (!isLiveStream || !stream || manualPaused || leavingPlayerRef.current || mpvBundled === false) return;
    const delay = liveRetryDelay(liveFailure, liveRetryAttempts);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      if (manualPausedRef.current || leavingPlayerRef.current) return;
      setLiveRetryAttempts(attempt => attempt + 1);
      setLiveFailure(null);
      setMpvRetryVersion(version => version + 1);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isLiveStream, liveFailure, liveRetryAttempts, manualPaused, mpvBundled, stream]);

  useEffect(() => {
    if (!isLiveStream || !stream || !stalledPlayback || !playbackStarted || manualPaused || liveFailure) return;
    const delay = Math.max(0, LIVE_STALL_TIMEOUT_MS - (Date.now() - lastProgressAtRef.current));
    const timer = window.setTimeout(() => {
      if (manualPausedRef.current || leavingPlayerRef.current || Date.now() - lastProgressAtRef.current < LIVE_STALL_TIMEOUT_MS) return;
      const failure = { message: "MPV no pudo cargar esta fuente. El directo dejó de recibir datos; se agotó el margen de recuperación.", retryable: true };
      setLiveFailure(failure);
      setMpvStatus(failure.message);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isLiveStream, liveFailure, manualPaused, playbackStarted, stalledPlayback, stream]);

  useEffect(() => {
    // Un seek de reanudación también cambia `time-pos`, pero todavía no implica
    // que haya empezado a reproducirse. Tampoco lo implica el primer PTS de un
    // archivo cargado en pausa: solo la barrera de arranque puede soltarla.
    if (currentTime > 0.05 && mpvReadyForCommands && mpvFileLoaded && playing
      && resumeSeekReady && !startupGateActiveRef.current) {
      playbackProgressReadyRef.current = true;
      setPlaybackStarted(true);
      window.performance?.mark?.("player:first_frame");
      setMpvStatus(prev => (
        prev?.startsWith("MPV no pudo cargar esta fuente") || prev?.startsWith("El torrent no entrego datos")
          ? null
          : prev
      ));
    }
  }, [currentTime, mpvFileLoaded, mpvReadyForCommands, playing, resumeSeekReady]);

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
      || partyLobbyRef.current
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
      if (isLiveStream) setLiveFailure({ message: "MPV no pudo cargar esta fuente. El servidor no entregó el directo a tiempo.", retryable: true });
    }, isP2pStream ? P2P_LOAD_FAILURE_TIMEOUT_MS : isLiveStream ? LIVE_LOAD_FAILURE_TIMEOUT_MS : LOAD_FAILURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLiveStream, isP2pStream, mpvFileLoaded, mpvReadyForCommands, mpvStatus, playbackStarted, stream]);

  useEffect(() => {
    if (!stream || isP2pStream || !mpvFileLoaded || playbackStarted || manualPaused) return;
    const timer = window.setTimeout(() => {
      if (currentTimeRef.current > 0.05 || manualPausedRef.current || playbackStarted) return;
      setMpvStatus("MPV no pudo cargar esta fuente. El archivo abrio, pero no entrego cuadros reproducibles.");
      if (isLiveStream) setLiveFailure({ message: "MPV no pudo cargar esta fuente. No se recibieron cuadros del directo a tiempo.", retryable: true });
    }, isLiveStream ? LIVE_FIRST_FRAME_TIMEOUT_MS : DIRECT_FIRST_FRAME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isLiveStream, isP2pStream, manualPaused, mpvFileLoaded, playbackStarted, stream]);

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
  if (!stream || isSportsLiveStream) return [];
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
  }, [addonSubtitles, isSportsLiveStream, stream]);

  // Rotulo de la pista = idioma + descripcion, y la tecnologia (Dolby Atmos,
  // canales) fuera del texto como insignia: lo pide el diseno del menu de audio
  // de Big Picture. El dato sale del rotulo de mpv y, si la pista no dice nada,
  // del .json de la stream (technicalMetadata).
  const audioOptions = useMemo(
    () =>
      mpvTracks
        .map(track => ({
          ...track,
          parsedId: Number(track.id),
          kind: String(track.type ?? "").toLowerCase(),
        }))
        .filter(track => Number.isFinite(track.parsedId) && (track.kind === "audio" || track.kind === "a" || track.kind.includes("audio")))
        .map(track => {
          const raw = track.title && track.lang ? `${track.lang} - ${track.title}` : track.title ?? track.lang ?? `Audio ${track.parsedId}`;
          const presentation = presentAudioTrack(raw, stream?.technicalMetadata);
          return {
            value: `track:${track.parsedId}`,
            label: presentation.label,
            badge: presentation.badge ?? undefined,
            language: String(track.lang ?? ""),
            title: String(track.title ?? ""),
            forced: Boolean(track.forced),
            sdh: Boolean(track.sdh || track.hearingImpaired),
            isDefault: Boolean(track.default || track.selected),
          };
        }),
    [mpvTracks, stream],
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
            language: String(track.lang ?? ""),
            title,
            forced: Boolean(track.forced),
            sdh: Boolean(track.sdh || track.hearingImpaired),
            isDefault: Boolean(track.default || track.selected),
          }];
        }
        return [{
          value: `track:${track.parsedId}`,
          label: track.title && track.lang ? `${track.lang} - ${track.title}` : track.title ?? track.lang ?? `Subtítulo ${track.parsedId}`,
          languageKey,
          languageLabel: formatSubtitleLanguageLabel(languageKey, String(track.lang ?? "")),
          sourceLabel: "Embebido",
          language: String(track.lang ?? ""),
          title,
          forced: Boolean(track.forced),
          sdh: Boolean(track.sdh || track.hearingImpaired),
          isDefault: Boolean(track.default || track.selected),
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
        language: subtitle.lang ?? "",
        title: subtitle.label,
      };
    });
    return [...internal, ...external];
  }, [allSubtitles, mpvTracks]);

  const resolvedAudioSelection = useMemo(() => resolvePlaybackTrackSelection({
    candidates: audioOptions,
    manual: routeAudioPreference,
    episode: episodeAudioPreference,
    delivery: playbackSelection.delivery?.audio,
    globalLanguages: [
      resolvePreferredLanguage(playbackPreferences.firstAudioLanguage, originalLanguage),
      resolvePreferredLanguage(playbackPreferences.secondAudioLanguage, originalLanguage),
    ],
    kind: "audio",
  }), [
    audioOptions,
    episodeAudioPreference,
    originalLanguage,
    playbackPreferences.firstAudioLanguage,
    playbackPreferences.secondAudioLanguage,
    playbackSelection.delivery?.audio,
    routeAudioPreference,
  ]);

  const resolvedSubtitleSelection = useMemo(() => resolvePlaybackTrackSelection({
    candidates: subtitleOptions,
    manual: routeSubtitlePreference,
    episode: episodeSubtitlePreference,
    delivery: playbackSelection.delivery?.subtitle,
    globalLanguages: [
      resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage),
      resolvePreferredLanguage(playbackPreferences.secondSubtitleLanguage, originalLanguage),
    ],
    kind: "subtitle",
  }), [
    episodeSubtitlePreference,
    originalLanguage,
    playbackPreferences.preferredSubtitleLanguage,
    playbackPreferences.secondSubtitleLanguage,
    playbackSelection.delivery?.subtitle,
    routeSubtitlePreference,
    subtitleOptions,
  ]);

  const subtitleTitleKey = useMemo(() => buildAutoSyncTitleKey(query), [query]);

  const subtitleSync = useSubtitleSync({
    selectedSubtitleValue: selectedMpvSubtitle,
    subtitleSources: allSubtitles,
    streamUrl: stream?.url ?? null,
    streamHeaders: stream?.behaviorHints?.headers as Record<string, string> | undefined,
    titleKey: subtitleTitleKey,
    autoSyncMode: playbackPreferences.autoSubtitleSync,
    getPositionMs: async () => {
      try {
        const status = await getNativePlaybackStatus();
        return Number(status.timePos ?? 0) * 1000;
      } catch {
        return 0;
      }
    },
    onApplyDelay: handleSubtitleSyncApply,
    onApplyPlan: handleAutoSubtitleSyncApply,
  });

  useEffect(() => {
    if (!subtitleSync.open) return;
    holdControls();
    return () => releaseControls(1);
  }, [subtitleSync.open, holdControls, releaseControls]);

  // La fila de episodios vive dentro de la barra: si la barra se apagara por
  // timeout, la fila se iría con ella y el foco apuntaría a un nodo que ya no
  // está. Mientras está abierta la barra se queda, sin temporizador.
  useEffect(() => {
    if (!bigPictureEpisodesOpen) return;
    holdControls();
    return () => releaseControls(1);
  }, [bigPictureEpisodesOpen, holdControls, releaseControls]);

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

  const speedOptions = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
  const normalizedAudioOptions = audioOptions.length > 0
    ? audioOptions
    : (selectedMpvAudio ? [{ value: selectedMpvAudio, label: `Audio ${selectedMpvAudio.replace("track:", "")}` }] : []);

// Logos para la cabecera del menu de audio. Delega en el MISMO detector que
  // el panel de streams: antes miraba solo `technicalMetadata` y una stream que
  // el panel reconocia como Atmos por su nombre o filename se quedaba sin logo
  // aqui dentro, con el mismo dato en los dos sitios y dos respuestas distintas.
  const audioTechLogo = useMemo(() => {
    const logos = resolveHeaderAudioBadges(safeStream);
    if (!logos.length) return null;
    return logos.length === 1 ? logos[0] : logos;
  }, [safeStream]);
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
          navigate(buildEpisodePath(`type=${query?.type}&id=${encodeURIComponent(query?.id ?? "")}&season=${item.season}&ep=${item.episode}`));
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
    // Lobby: el transporte lo gobierna el anfitrión (salvo la secuencia de arranque).
    if (partyLobbyRef.current && !partyLobbyStartBypassRef.current) return;
    // Si el usuario cambia play/pausa manualmente mientras explora episodios,
    // esa acción pasa a ser la nueva autoridad: al cerrar la fila no se debe
    // reanudar ni volver a pausar por encima de su decisión.
    episodeRowShouldResumeRef.current = false;
    episodeRowPauseOwnedRef.current = false;
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
    if (partyLobbyRef.current && !partyLobbyStartBypassRef.current) return;
    // Un salto real sustituye cualquier exploración pendiente del timeline.
    // Dejarla viva congela tanto el playhead como las etiquetas de tiempo.
    cancelTimelinePreview();
    debugLog("seek() called", { value });
    seekBufferingRef.current = true;
    seekStartedAtRef.current = Date.now();
    lastProgressAtRef.current = Date.now();
    setSeekBuffering(true);
    setStalledPlayback(false);
    currentTimeRef.current = value;
    setCurrentTime(value);
    void sendMpvCommand(["seek", value, "absolute", "exact"]).catch(() => {
      seekBufferingRef.current = false;
      seekStartedAtRef.current = 0;
      setSeekBuffering(false);
    });
  }

  function updateTimelinePreview(value: number | null) {
    const next = value === null
      ? null
      : Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, Number.isFinite(value) ? value : 0));
    timelinePreviewTimeRef.current = next;
    setTimelinePreviewTime(next);
  }

  function previewTimelineBy(offset: number) {
    if (partyLobbyRef.current || showUpNext) return;
    const base = timelinePreviewTimeRef.current ?? currentTimeRef.current;
    updateTimelinePreview(base + offset);
  }

  function confirmTimelinePreview() {
    const target = timelinePreviewTimeRef.current;
    if (target === null || partyLobbyRef.current || showUpNext) return;
    updateTimelinePreview(null);
    seek(target);
  }

  const cancelTimelinePreview = useCallback(() => {
    timelinePreviewTimeRef.current = null;
    setTimelinePreviewTime(null);
  }, []);

  const showPlaybackSelectionNotice = useCallback((message: string) => {
    setPlaybackSelectionNotice(message);
    if (playbackSelectionNoticeTimerRef.current !== null) {
      window.clearTimeout(playbackSelectionNoticeTimerRef.current);
    }
    playbackSelectionNoticeTimerRef.current = window.setTimeout(() => {
      playbackSelectionNoticeTimerRef.current = null;
      setPlaybackSelectionNotice("");
    }, 3200);
  }, []);

  function jump(offset: number) {
    if (showUpNext) return;
    if (partyLobbyRef.current) return;
    debugLog("jump() called", { offset });
    const target = getRelativeSeekTarget(currentTimeRef.current, durationRef.current, offset);
    seek(target);
  }

  /** Salto con OSD: los botones ±10s de la barra usan esta vía para que el
   * signo de adelante/atrás aparezca siempre, igual que con el teclado. */
  function jumpWithFeedback(offset: number) {
    jump(offset);
    flashActionFeedback(offset >= 0 ? "forward" : "rewind", { deltaSeconds: offset });
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
    const normalized = normalizeVideoEnhancementProfile(profile);
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
    if (!isTauriRuntime() || isIframeStream) {
      saveVideoEnhancementProfile(normalized);
      showNotice(`Mejora guardada: ${label} (requiere el reproductor MPV nativo)`);
      return;
    }
    if (!mpvFileLoaded) {
      saveVideoEnhancementProfile(normalized);
      showNotice(`Mejora guardada: ${label} (se aplicará al cargar)`);
      return;
    }
    console.info("[AETHERIO:VIDEO-FILTER] applying", { profile: normalized, label });
    setMpvStatus(`Configurando perfil: ${label}…`);
    showNotice(`Configurando perfil en MPV: ${label}`);
  }

  async function launchMpv(showOpening = true) {
    if (!stream || isIframeStream) return;
    if (showOpening) setMpvStatus(isP2pStream
      ? "Preparando stream P2P..."
      : "Abriendo MPV...");
    launchStartedAtRef.current = Date.now();
    // Lobby Party: el medio se precarga en pausa (hold) y sin reanudar.
    const lobbyHold = partyLobbyRef.current;
    const { error } = await openExternal(stream, undefined, undefined, query?.episode, isLiveStream);
    setMpvReadyForCommands(!error);
    setPlaying(false);
    setManualPaused(lobbyHold);
    manualPausedRef.current = lobbyHold;
    setMpvStatus(error ? `MPV no inicio: ${error}` : null);
    if (!error) {
      void sendMpvCommand(["set_property", "pause", startupGateActiveRef.current || lobbyHold]);
      applyVideoScale(videoScaleMode);
    }
  }

  async function retryMpvPlayback() {
    if (isLiveStream) {
      setLiveRetryAttempts(0);
      setLiveFailure(null);
      setMpvRetryVersion(version => version + 1);
      return;
    }
    setMpvStatus(isP2pStream
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
      setMpvStatus(`MPV: ${String(error)}`);
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
    // Leave live buffer management enabled; forcing it off turns every slow
    // segment into a freeze instead of allowing libmpv to refill the cache.
    void sendMpvCommand(["set_property", "cache-pause", isLiveStream]);
    void sendMpvCommand(["set_property", "pause", false]);
    void sendMpvCommand(["set_property", "speed", Number(selectedSpeed) || 1.0]);
  }

  function getStreamsPath() {
    // Delega en el helper compartido: mismo destino que el shell y Big Picture
    // para el gesto de atrás, incluido `fromPlayer=1` (desactiva el
    // auto-resolve y revela el picker manual).
    return buildPlayerBackPath(params.toString());
  }

  function getDetailPath() {
    if (!query?.type || !query?.id) return null;
    return buildDetailPath(query.type, query.id);
  }

  function goBack() {
    leavingPlayerRef.current = true;
    setIsLeavingPlayer(true);
    setMpvStatus(null);
    const detailPath = getDetailPath();
    const streamsPath = getStreamsPath();
    // Todavía en la pantalla de carga (nada ha empezado a reproducirse): atrás
    // devuelve al picker de fuentes del mismo medio, no a la ficha. Es el mismo
    // destino que usan el shell y Big Picture (buildPlayerBackPath) para que los
    // tres caminos coincidan. Con reproducción ya iniciada, la UX pide la ficha.
    const target = isSportsLiveStream
      ? (streamsPath ?? detailPath)
      : !playbackStarted ? (streamsPath ?? detailPath) : (detailPath ?? streamsPath);
    saveCurrentProgressNow("goBack");
    sendCurrentTraktPlaybackEvent(shouldStopTraktPlayback() ? "stop" : "pause");
    void stopNativePlayback()
      .finally(() => {
        if (target) {
          navigate(target, { replace: true });
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
    const nextEpisode = getEpisodeNavigationTarget(direction, currentIndex, episodeOptions, resolvedNextEpisode);
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
      navigate(buildEpisodePath(`type=${query.type}&id=${encodeURIComponent(query.id)}&season=${nextEpisode.season}&ep=${nextEpisode.episode}${autoplay}`));
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
    // Click: solo OSD play/pausa, sin despertar la barra.
    if (!showFallbackPanel && mpvReadyForCommands && playbackStarted) {
      const wasPlaying = playing;
      togglePlay();
      flashActionFeedback(wasPlaying ? "pause" : "play");
    }
  }

  function releasePointerControlFocus(event: MouseEvent<HTMLDivElement>) {
    // Clicks from a mouse should activate a control without leaving its
    // controller-style selected state behind. Keyboard/gamepad activation has
    // detail=0 and keeps focus for spatial navigation.
    if (event.detail <= 0) return;
    const target = event.target as HTMLElement | null;
    const clickedControl = target?.closest<HTMLButtonElement>(
      "button[data-player-control-glass], button[data-player-skip], button[data-post-play-action]",
    );
    if (!clickedControl) return;

    window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return;
      if (focused === clickedControl || clickedControl.contains(focused)) focused.blur();
    });
  }

  function startHoldToAccelerate(event: PointerEvent<HTMLDivElement>) {
    if (showUpNext) return;
    // Mantener pulsado acelera: no despierta la barra (el OSD de play/pausa
    // lo gestiona handleScreenClick al soltar si fue pulsación corta).
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-player-interactive]")) return;
    if (isSportsLiveStream || !playbackPreferences.holdToAccelerate || showFallbackPanel || manualPaused || !mpvReadyForCommands || !playbackStarted) return;
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
      || isSportsLiveStream
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
    const launchKey = `${getPlaybackTarget(stream)}:${mpvRetryVersion}`;
    if (mpvLaunchKeyRef.current === launchKey) return;
    let cancelled = false;

    mpvLaunchKeyRef.current = launchKey;
    mpvRecoveryKeyRef.current = "";
    playbackProgressReadyRef.current = false;
    launchStartedAtRef.current = Date.now();
    lastProgressTimeRef.current = 0;
    lastProgressAtRef.current = Date.now();
    currentTimeRef.current = 0;
    lastContinueSaveAtRef.current = 0;
    resumeSeekAppliedRef.current = "";
    resumeSeekAttemptsRef.current = 0;
    // Lobby Party: abrir en 0 (hold), sin reanudar.
    const lobbyHold = partyLobbyRef.current;
    resumeSeekTargetRef.current = lobbyHold || isLiveStream
      ? 0
      : Math.max(getResumeStartTime(query), selectedResumeTime, readSelectedMediaResumeTime());
    setResumeSeekReady(resumeSeekTargetRef.current < 12);
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
    setLiveFailure(null);
    setPlaybackStarted(false);
    setMpvFileLoaded(false);
    lastMpvFileLoadedRef.current = false;
    setMpvEofReached(false);
    startupGateActiveRef.current = !stream.ytId;
    startupGatePausedRef.current = false;
    startupGateStartedAtRef.current = Date.now();
    startupGateLastAudioApplyAtRef.current = 0;
    autoAudioAppliedRef.current = false;
    autoSubtitleAppliedRef.current = false;
    manualAudioSelectionRef.current = false;
    manualSubtitleSelectionRef.current = false;
    // Los ids de pista pertenecen solo a esta apertura; las preferencias previas
    // se resolverán por idioma/título cuando mpv publique las pistas del stream.
    desiredAudioSelectionRef.current = "";
    desiredSubtitleSelectionRef.current = "";
    desiredAudioSelectionSetRef.current = false;
    desiredSubtitleSelectionSetRef.current = false;
    audioFallbackNoticeKeyRef.current = "";
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
    timelinePreviewTimeRef.current = null;
    setTimelinePreviewTime(null);
    setPlaying(false);
    setManualPaused(lobbyHold);
    manualPausedRef.current = lobbyHold;
    setMpvStatus(isP2pStream
      ? "Preparando stream P2P..."
      : "Abriendo MPV...");
    debugLog("native playback open called", {
      streamId: stream.id,
      source: stream.addonName ?? stream.name,
      kind: getStreamKind(stream),
    });

    void pendingNativeStopRef.current.then(() => {
      if (cancelled || leavingPlayerRef.current) return null;
      return openExternal(stream, undefined, undefined, query?.episode, isLiveStream);
    }).then(result => {
      if (!result) return;
      const { error } = result;
      if (cancelled || leavingPlayerRef.current) return;
      setPlaying(false);
      setMpvReadyForCommands(!error);
      setManualPaused(lobbyHold);
      manualPausedRef.current = lobbyHold;
      setMpvStatus(error ? `MPV no inicio: ${error}` : null);
      if (!error) {
        void sendMpvCommand(["set_property", "pause", startupGateActiveRef.current || lobbyHold]);
        applyVideoScale(videoScaleMode);
      }
      debugLog(error ? "native playback open error" : "native playback open resolved", { error });
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
    // Preservar el hold del lobby (StrictMode remonta el efecto sin reabrir).
    setManualPaused(partyLobbyRef.current);
    manualPausedRef.current = partyLobbyRef.current;
      mpvLaunchKeyRef.current = "";
      mpvRecoveryKeyRef.current = "";
      setStalledPlayback(false);
      setMpvStatus(null);
      pendingNativeStopRef.current = stopNativePlayback().catch(() => undefined);
    };
  }, [
    isIframeStream,
    isLiveStream,
    mpvRetryVersion,
    query,
    selectedPlaybackOverrides?.forceSubtitleSelection,
    selectedPlaybackOverrides?.selectedAudio,
    selectedPlaybackOverrides?.selectedAudioLanguage,
    selectedPlaybackOverrides?.selectedSubtitle,
    selectedResumeTime,
    stream,
  ]);

  // Ya NO hay un guardián `window.history.pushState` aquí. Ese guard insertaba una
  // entrada real fuera de React Router y además borraba el `idx` del estado, así que
  // el `idx` del router se desincronizaba del historial real del navegador. Con esa
  // desviación, el "atrás" del shell/Big Picture (`navigate(delta)` / `navigate(-1)`)
  // caminaba una pila contaminada y acababa volviendo al reproductor. El destino de
  // salida del Player lo resuelven goBack() (propio), el shell y Big Picture con
  // buildPlayerBackPath, que ya son la vía real del gesto "atrás" (botón B / flecha /
  // botón volver). Empujar un estado falso aquí solo servía para el botón atrás del
  // SO/navegador, a costa de corromper el modelo de historial de la app.

  useEffect(() => {
    if (!playbackStarted || !mpvReadyForCommands) return;
    if (isSportsLiveStream) {
      autoSubtitleAppliedRef.current = true;
      desiredSubtitleSelectionRef.current = "";
      desiredSubtitleSelectionSetRef.current = true;
      if (selectedMpvSubtitle) setSelectedMpvSubtitle("");
      void sendMpvCommand(["set_property", "sid", "no"]);
      return;
    }
    if (manualSubtitleSelectionRef.current) {
      autoLangLog("subtitle skipped: manual selection");
      return;
    }
    if (autoSubtitleAppliedRef.current && desiredSubtitleSelectionSetRef.current) return;
    if (resolvedSubtitleSelection.mode !== "off" && (!subtitlesReady || !subtitleOptions.length)) return;
    if (manualSubtitleSelectionRef.current) {
      autoLangLog("subtitle skipped: manual selection");
      return;
    }
    const preferredSubtitleLanguages = [
      resolvePreferredLanguage(playbackPreferences.preferredSubtitleLanguage, originalLanguage),
      resolvePreferredLanguage(playbackPreferences.secondSubtitleLanguage, originalLanguage),
    ];
    if (resolvedSubtitleSelection.mode === "off") {
      if (autoSubtitleAppliedRef.current && desiredSubtitleSelectionSetRef.current
        && desiredSubtitleSelectionRef.current === "") return;
      autoSubtitleAppliedRef.current = true;
      desiredSubtitleSelectionRef.current = "";
      desiredSubtitleSelectionSetRef.current = true;
      if (selectedMpvSubtitle) setSelectedMpvSubtitle("");
      void sendMpvCommand(["set_property", "sid", "no"]);
      autoLangLog("subtitle intent: off");
      return;
    }
    const targetSubtitle = resolvedSubtitleSelection.candidate?.value ?? "";
    if (!targetSubtitle) {
      autoSubtitleAppliedRef.current = true;
      autoLangLog("subtitle no target", { preferredLanguage: preferredSubtitleLanguages.filter(Boolean).join(","), options: subtitleOptions.length });
      return;
    }
    if (selectedMpvSubtitle === targetSubtitle) {
      autoSubtitleAppliedRef.current = true;
      desiredSubtitleSelectionRef.current = targetSubtitle;
      desiredSubtitleSelectionSetRef.current = true;
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
      selectionSource: resolvedSubtitleSelection.source,
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
    isSportsLiveStream,
    originalLanguage,
    playbackPreferences.preferredSubtitleLanguage,
    playbackPreferences.secondSubtitleLanguage,
    playbackStarted,
    resolvedSubtitleSelection,
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
    if (autoAudioAppliedRef.current && desiredAudioSelectionSetRef.current) return;
    const targetAudio = resolvedAudioSelection.candidate?.value ?? "";
    const requestedAudioPreference = routeAudioPreference
      ?? episodeAudioPreference
      ?? playbackSelection.delivery?.audio;
    const requestedAudioAvailable = requestedAudioPreference
      ? matchPlaybackTrackPreference(requestedAudioPreference, audioOptions)
      : null;
    if (requestedAudioPreference && !requestedAudioAvailable) {
      const sourceKey = JSON.stringify([
        query?.type,
        query?.id,
        query?.season,
        query?.episode,
        stream?.id ?? stream?.url ?? "",
        requestedAudioPreference,
      ]);
      if (audioFallbackNoticeKeyRef.current !== sourceKey) {
        audioFallbackNoticeKeyRef.current = sourceKey;
        showPlaybackSelectionNotice("Esta fuente no incluye el audio elegido");
      }
    }
    if (!targetAudio.startsWith("track:")) {
      autoAudioAppliedRef.current = true;
      autoLangLog("audio no target", {
        options: audioOptions.length,
        resolution: resolvedAudioSelection.source,
        trackLangs: mpvTracks.map(track => `${track.id}:${track.lang ?? ""}:${track.title ?? ""}`),
      });
      return;
    }
    if (selectedMpvAudio === targetAudio) {
      autoAudioAppliedRef.current = true;
      desiredAudioSelectionRef.current = targetAudio;
      desiredAudioSelectionSetRef.current = true;
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
      resolution: resolvedAudioSelection.source,
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
    episodeAudioPreference,
    mpvTracks,
    mpvFileLoaded,
    mpvReadyForCommands,
    playbackSelection.delivery?.audio,
    query?.episode,
    query?.id,
    query?.season,
    query?.type,
    resolvedAudioSelection,
    routeAudioPreference,
    selectedMpvAudio,
    showPlaybackSelectionNotice,
    stream?.id,
    stream?.url,
  ]);

  useEffect(() => {
    if (!startupGateActiveRef.current || !mpvReadyForCommands) return;

    const resumeAudio = resolvedAudioSelection.candidate?.value ?? "";
    const resumeSubtitle = resolvedSubtitleSelection.mode === "off"
      ? ""
      : resolvedSubtitleSelection.candidate?.value ?? "";
    if (resolvedSubtitleSelection.mode === "off" && !manualSubtitleSelectionRef.current
      && mpvFileLoaded && !autoSubtitleAppliedRef.current) {
      autoSubtitleAppliedRef.current = true;
      desiredSubtitleSelectionRef.current = "";
      desiredSubtitleSelectionSetRef.current = true;
      setSelectedMpvSubtitle("");
      void sendMpvCommand(["set_property", "sid", "no"]);
    }
    const preferredAudio = manualAudioSelectionRef.current
      ? null
      : resolvedAudioSelection.candidate;
    const preferredSubtitle = manualSubtitleSelectionRef.current || resolvedSubtitleSelection.mode === "off"
      ? null
      : resolvedSubtitleSelection.candidate;

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
    // La verificación del seek tiene su propio límite corto; una vez cargado
    // el archivo no dejes que el timeout general de inicio se adelante a ella.
    const mustHoldForResumeSeek = mpvFileLoaded && !resumeSeekReady;
    const mustHoldForAudio = audioTargetExists && !audioSettled;
    const mustHoldForSubtitle = subtitleTargetExists && !subtitleSettled;
    const timedOut = hardTimedOut && !mustHoldForAudio && !mustHoldForSubtitle;
    if (mustHoldForFileLoad || mustHoldForResumeSeek || mustHoldForAudio || mustHoldForSubtitle) return;

    startupGateActiveRef.current = false;
    startupGatePausedRef.current = false;
    autoLangLog("startup gate release", {
      audioSettled,
      subtitleSettled,
      audioTargetExists,
      subtitleTargetExists,
      fileLoadPending: mustHoldForFileLoad,
      resumeSeekPending: mustHoldForResumeSeek,
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
    mpvFileLoaded,
    mpvReadyForCommands,
    resumeSeekReady,
    resolvedAudioSelection,
    resolvedSubtitleSelection,
    selectedMpvAudio,
    selectedMpvSubtitle,
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
    flash: flashActionFeedback,
    startSpaceAcceleration,
    stopSpaceAcceleration,
    revealControls: () => {
      setGamepadBarMode(false);
      wakeControls();
    },
    volume,
    playing,
    // Con un overlay abierto las flechas y el espacio pertenecen a su
    // navegación. La fila de episodios no bloquea: sus cards gestionan sus
    // propias teclas.
    enabled: !showUpNext && !showFallbackPanel && playerMenu === null && !subtitleSync.open && activeSidePanel === null,
  });
  // La barra se mantiene visible con panel lateral, menú flotante, sync o foco
  // de teclado dentro de ella.
  const controlsActive =
    controlsVisible
    || activeSidePanel !== null
    || playerMenu !== null
    || subtitleSync.open
    || bigPictureEpisodesOpen
    || barFocusWithin
    || partyLobbyRef.current;

// Cronometra desde el arranque efectivo de cada stream/episodio, no desde que
// termina la consulta de TMDB. Si la metadata tarda mas de 3 s, el aviso entra
// con el fade en cuanto llega; si llega antes, espera el tiempo restante.
useEffect(() => {
  if (!playbackStarted || !contentRatingKey) {
    contentRatingPlaybackKeyRef.current = "";
    contentRatingPlaybackStartedAtRef.current = 0;
    return;
  }
  if (contentRatingPlaybackKeyRef.current !== contentRatingKey) {
    contentRatingPlaybackKeyRef.current = contentRatingKey;
    contentRatingPlaybackStartedAtRef.current = Date.now();
  }
}, [contentRatingKey, playbackStarted]);

// No guarda memoria de "ya mostrado": una nueva entrada vuelve a mostrarlo.
useEffect(() => {
  if (!playbackStarted || isIframeStream || !contentRatingKey || !contentRating) return;
  const startedAt = contentRatingPlaybackKeyRef.current === contentRatingKey
    ? contentRatingPlaybackStartedAtRef.current
    : Date.now();
  const remainingDelay = Math.max(0, 3_000 - (Date.now() - startedAt));
  const timer = window.setTimeout(() => setContentRatingVisible(true), remainingDelay);
  return () => window.clearTimeout(timer);
}, [contentRating, contentRatingKey, isIframeStream, playbackStarted]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aetherio-player-controls", { detail: { visible: controlsActive } }));
    return () => {
      window.dispatchEvent(new CustomEvent("aetherio-player-controls", { detail: { visible: true } }));
    };
  }, [controlsActive]);

const mediaTitle = selectedMediaName || resumeEntry?.name || query?.id || "Reproducción";
const { activeSegment: activeSkipSegment, creditsSegment: upNextCreditsSegment } = useSkipIntro(metadataQuery, mediaTitle, currentTime, {
  enabled: playbackPreferences.skipSegmentsEnabled,
  animeSkipEnabled: playbackPreferences.animeSkipEnabled,
});
const playbackTarget = getPlaybackTarget(stream);
const currentEpisodeIndex = episodeOptions.findIndex(episode => episode.episode === query?.episode);
const canGoPrevEpisode = currentEpisodeIndex > 0;
const withinSeasonNextEpisode = currentEpisodeIndex >= 0 && currentEpisodeIndex < episodeOptions.length - 1
  ? (episodeOptions[currentEpisodeIndex + 1] ?? null)
  : null;
// En el último episodio de una temporada, permite avanzar al primer episodio de
// la siguiente temporada (si existe) en lugar de disparar Up Next. No se trata
// un episodio futuro como "siguiente" hasta el día de estreno: mientras tanto
// se puede saltar su outro sin mostrar el aviso ni navegar a un capítulo inédito.
const nextEpisodeCandidate = withinSeasonNextEpisode ?? nextSeasonEpisode ?? null;
const resolvedNextEpisode = nextEpisodeCandidate && isEpisodeReleased(nextEpisodeCandidate.airDate)
  ? nextEpisodeCandidate
  : null;
const hasUnreleasedNextEpisode = Boolean(nextEpisodeCandidate && !resolvedNextEpisode);
const canGoNextEpisode = Boolean(resolvedNextEpisode);
const isMovie = query?.type === "movie";
const episodeAvailabilityKnown = isMovie || !query?.season || !query?.episode || episodeMetadataReady;
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
  const nextEpisode = resolvedNextEpisode;
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
    entryKind: nextEpisode.season > query.season! ? "new" : "next",
    source: "local",
  });
}

function saveCurrentProgressNow(reason: string) {
  if (!query || !stream || isTrailerStream || isLiveStream || !playbackProgressReadyRef.current) return null;
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
  if (!playbackStarted || !query || !stream || isTrailerStream || isLiveStream) return;
  const key = `${buildContinueWatchingKey(query)}:${stream.id}`;
  if (traktStartedKeyRef.current === key) return;
  traktStartedKeyRef.current = key;
  traktStoppedKeyRef.current = "";
  sendCurrentTraktPlaybackEvent("start");
}, [isLiveStream, isTrailerStream, playbackStarted, query, stream]);

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
  if (!query || !stream || isTrailerStream || isLiveStream || !playbackProgressReadyRef.current) return;
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
  isLiveStream,
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
  if (!query || !stream || isTrailerStream || isLiveStream) return;
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
    setResumeSeekReady(true);
    resumeLog("resume already satisfied", { target });
    return;
  }

  resumeSeekStartedAtRef.current = Date.now();
  resumeSeekAttemptsRef.current = 1;
  window.performance?.mark?.("player:resume_seek");
  resumeLog("resume single seek", { target, seekKey });
  void sendMpvCommand(["seek", target, "absolute"]);

  const verify = window.setTimeout(() => {
    if (currentTimeRef.current < target - 5 && resumeSeekAttemptsRef.current < 2) {
      resumeSeekAttemptsRef.current = 2;
      resumeLog("resume reapply seek", { target });
      void sendMpvCommand(["seek", target, "absolute"]);
      resumeSeekTimerRef.current = window.setTimeout(() => {
        resumeSeekSettledRef.current = true;
        setResumeSeekReady(true);
        resumeLog("resume seek verification complete", { target, reached: currentTimeRef.current >= target - 5 });
      }, 1500);
      return;
    }
    resumeSeekSettledRef.current = true;
    setResumeSeekReady(true);
    resumeLog("resume seek verification complete", { target, reached: currentTimeRef.current >= target - 5 });
  }, 2000);
  resumeSeekTimerRef.current = verify;

  return () => {
    window.clearTimeout(verify);
    if (resumeSeekTimerRef.current !== null) {
      window.clearTimeout(resumeSeekTimerRef.current);
      resumeSeekTimerRef.current = null;
    }
  };
}, [duration, isLiveStream, isTrailerStream, mpvFileLoaded, mpvReadyForCommands, query, stream]);

// El umbral PRESENTA el aviso; nunca cambia de episodio ni achica la película.
const postPlayKey = `${query?.type ?? ""}:${query?.id ?? localPlaybackKey ?? ""}:${query?.season ?? ""}:${query?.episode ?? ""}`;
const postPlayEligible = !isLiveStream && !isTrailerStream && !isSportsReplay && duration >= 60 && currentTime > 0;
const nextEpisodeReady = postPlayEligible && canGoNextEpisode && shouldShowNextEpisodeCard({
    position: currentTime,
    duration,
    outroSegments: upNextCreditsSegment ? [upNextCreditsSegment] : [],
    thresholdMode: playbackPreferences.nextEpisodeThresholdMode,
    thresholdPercent: playbackPreferences.nextEpisodeThresholdPercent,
    thresholdMinutesBeforeEnd: playbackPreferences.nextEpisodeThresholdMinutesBeforeEnd,
  });
const hasCredits = upNextCreditsSegment && Number.isFinite(upNextCreditsSegment.start) && upNextCreditsSegment.start > 0;
const recommendationReady = postPlayEligible && episodeAvailabilityKnown
  && !canGoNextEpisode && !hasUnreleasedNextEpisode
  && playbackPreferences.upNextEnabled && Boolean(related.recommendation)
  && ((hasCredits
    ? currentTime >= upNextCreditsSegment!.start
    : shouldShowMovieRecommendation({
      position: currentTime,
      duration,
      thresholdPercent: playbackPreferences.postPlayMovieThresholdPercent,
    })) || duration - currentTime <= 5);
useEffect(() => {
  if (hasUnreleasedNextEpisode) {
    if (showUpNext) setShowUpNext(false);
    if (upNextShownKeyRef.current === postPlayKey) upNextShownKeyRef.current = "";
    return;
  }

  if (recommendationReady) {
    if (showUpNext || upNextShownKeyRef.current === postPlayKey) return;
    upNextShownKeyRef.current = postPlayKey;
    setShowUpNext(true);
    return;
  }

  // Si el usuario retrocede antes del umbral, permite que Up Next vuelva a
  // presentarse al llegar de nuevo. El panel abierto también se cierra al volver
  // claramente al contenido, como en el comportamiento previo del reproductor.
  if (duration > 0 && (currentTime / duration) * 100 < 93 && duration - currentTime > 10) {
    if (upNextShownKeyRef.current === postPlayKey) upNextShownKeyRef.current = "";
    if (showUpNext) setShowUpNext(false);
  }
}, [currentTime, duration, hasUnreleasedNextEpisode, postPlayKey, recommendationReady, showUpNext]);
const availableSkipKind = playbackPreferences.skipSegmentsEnabled ? activeSkipSegment?.kind ?? null : null;
const postPlayAction = resolvePostPlayAction({
  nextReady: nextEpisodeReady,
  recommendationReady,
  dismissed: postPlayDismissedKey === postPlayKey,
  // If a released follow-up exists, its continuity card owns the outro slot;
  // intro and recap controls remain independently available.
  skipKind: episodeAvailabilityKnown
    && !(canGoNextEpisode && availableSkipKind === "outro")
    ? availableSkipKind
    : null,
});
const hasPostPlayPrompt = postPlayAction === "next-episode";

function cancelPostPlayPrompt() {
  setPostPlayDismissedKey(postPlayKey);
  postPlayRef.current?.querySelector<HTMLElement>(":focus")?.blur();
  wakeControls();
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>("[data-player-timeline]")?.focus({ preventScroll: true });
  });
}
function activatePostPlayPrompt() {
  if (partyLobbyRef.current || nextEpisodeAutoKeyRef.current === postPlayKey) return;
  nextEpisodeAutoKeyRef.current = postPlayKey;
  setPostPlayDismissedKey(postPlayKey);
  if (postPlayAction === "next-episode") navigateEpisode("next");
}

// ---- Party: sincronización con la sala (control compartido, last-writer-wins) ----
const {
  status: partyStatus,
  roomCode: partyRoomCode,
  roomServer: partyRoomServer,
  selfId: partySelfId,
  peers: partyPeers,
  media: partyMedia,
  lastControl: partyLastControl,
  lastMediaEvent: partyLastMediaEvent,
  lastStreamOffer: partyLastStreamOffer,
  bufferingPeers: partyBufferingPeers,
  lobby: partyLobby,
  lastLobbyEvent: partyLastLobbyEvent,
  sendLobby: partySendLobby,
  isOwner: partyIsOwner,
  sendControl: partySendControl,
  serverNow: partyServerNow,
  sendMedia: partySendMedia,
  sendStream: partySendStream,
  sendPresence: partySendPresence,
  notify: partyNotify,
  noteRemoteApplied: partyNoteRemote,
  lastRemoteAppliedAt: partyLastRemoteAt,
} = useParty();
const partyQueryKey = query ? `${query.type}:${query.id}:${query.season ?? ""}:${query.episode ?? ""}` : "";
const partyRoomKey = partyMediaKey(partyMedia);
partyLobbyRef.current = partyLobby;
const floatingActionsVisible = controlsReady && mpvReadyForCommands && !showFallbackPanel
  && !loadingOverlayVisible && !showUpNext && !partyLobby && playerMenu === null
  && activeSidePanel === null && !subtitleSync.open && !bigPictureEpisodesOpen;
const postPlayVisible = hasPostPlayPrompt && floatingActionsVisible;

// Mando en Big Picture: reproducción directa (A, cruceta, LT/RT, LB/RB, X/Y).
// Con overlay abierto, cruceta y A vuelven a la navegación espacial; B cierra.
function focusPlayerOverlay() {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      const root = document.querySelector(
        "[data-player-subtitle-panel-glass], [data-player-episode-panel-glass], [data-aetherio-context-menu]",
      );
      if (!root) return;
      const target = root.querySelector<HTMLElement>("button[aria-current='true']:not([disabled])")
        ?? root.querySelector<HTMLElement>("button:not([disabled])");
      target?.focus({ preventScroll: true });
    }, 60);
  });
}
// Al cerrar el diálogo de sync con el menú de subtítulos debajo, el foco
// vuelve al carril de pistas (no se pierde al desmontarse el diálogo).
function focusSubtitleMenuTrack() {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      const rail = document.querySelector(
        '[data-player-subtitle-panel-glass] [data-subtitle-rail="track"]',
      );
      const target = rail?.querySelector<HTMLElement>('button[aria-current="true"]:not([disabled])')
        ?? rail?.querySelector<HTMLElement>("button:not([disabled])");
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest" });
        return;
      }
      focusPlayerOverlay();
    }, 60);
  });
}
const prevSubtitleSyncOpenRef = useRef(false);
useEffect(() => {
  const wasOpen = prevSubtitleSyncOpenRef.current;
  prevSubtitleSyncOpenRef.current = subtitleSync.open;
  if (wasOpen && !subtitleSync.open && playerMenu === "subtitles") {
    focusSubtitleMenuTrack();
  }
}, [subtitleSync.open, playerMenu]);
// Foco determinista por zonas de la barra (el mando no depende del foco DOM).
function focusBarTimeline() {
  setBarZone("timeline");
  const target = document.querySelector<HTMLElement>(
    "[data-player-controls-glass] [data-player-timeline]:not([disabled])",
  ) ?? document.querySelector<HTMLElement>(
    "[data-player-controls-glass] [data-player-playpause]:not([disabled])",
  );
  target?.focus({ preventScroll: true });
}
function focusBarButtons() {
  setBarZone("buttons");
  const target = document.querySelector<HTMLElement>(
    "[data-player-controls-glass] [data-player-playpause]:not([disabled])",
  ) ?? document.querySelector<HTMLElement>(
    "[data-player-controls-glass] button:not([disabled])",
  );
  target?.focus({ preventScroll: true });
}
// Navega dentro de la zona actualmente enfocada, con wrap circular.
function moveBarButton(dir: "prev" | "next") {
  const selector = barZone === "episodes"
    ? "[data-player-controls-glass] [data-bp-episode-card]:not([disabled])"
    : "[data-player-controls-glass] button:not([disabled]):not([data-bp-episode-card])";
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>(
      selector,
    ),
  );
  if (!buttons.length) return;
  const active = document.activeElement as HTMLElement | null;
  const index = active ? buttons.indexOf(active) : -1;
  const next = index < 0
    ? (dir === "next" ? buttons[0] : buttons[buttons.length - 1])
    : buttons[(index + (dir === "next" ? 1 : -1) + buttons.length) % buttons.length];
  next?.focus({ preventScroll: true });
  if (barZone === "episodes" && next) {
    const row = next.closest<HTMLElement>("[data-bp-episode-row]");
    if (row) followHorizontalFocus(row, next, true);
  }
}
function activateFocusedControl() {
  const focused = document.activeElement as HTMLElement | null;
  if (focused?.matches("[data-bp-episode-card]")) {
    focused.click();
  }
}
// Colapsa la fila de episodios y devuelve el foco al timeline. La comparten
// el mando (B o cruceta arriba) y el teclado (flecha arriba): una sola accion
// para que ambos caminos devuelvan la barra al estado anterior.
function closeEpisodeRow() {
  setBigPictureEpisodesOpen(false);
  focusBarTimeline();
}
usePlayerGamepad({
  enabled: !showUpNext,
  transportLocked: partyLobby,
  canGoPrevEpisode,
  canGoNextEpisode,
  hasEpisodesPanel: episodeOptions.length > 0,
  volume,
  playing,
  isDirectMode: () => !showFallbackPanel && !subtitleSync.open && playerMenu === null && activeSidePanel === null,
  controlsMode: gamepadBarMode,
  barZone,
  previewActive: timelinePreviewTime !== null,
  postPlay: {
    focused: () => postPlayVisible && Boolean(postPlayRef.current?.contains(document.activeElement)),
    activate: () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLButtonElement && postPlayRef.current?.contains(focused)) focused.click();
    },
    dismiss: cancelPostPlayPrompt,
    focus: target => postPlayRef.current?.querySelector<HTMLElement>(`[data-post-play-action='${target}']`)?.focus({ preventScroll: true }),
  },
  skipAvailable: () => Boolean(
    postPlayAction === "skip"
    && floatingActionsVisible
    && playbackPreferences.skipSegmentsEnabled
    && activeSkipSegment
    && mpvReadyForCommands
    && playbackStarted
    && playerMenu === null
    && activeSidePanel === null
    && !subtitleSync.open
    && !showUpNext,
  ),
  skipSegment: () => {
    if (activeSkipSegment) seek(activeSkipSegment.end + 0.15);
  },
  openControls: () => {
    holdControls();
    setGamepadBarMode(true);
    // Entrada a la barra: foco primero al timeline (otra vez abajo = play).
    window.requestAnimationFrame(() => {
      window.setTimeout(() => focusBarTimeline(), 60);
    });
  },
  exitControls: () => {
    cancelTimelinePreview();
    setGamepadBarMode(false);
    setBarZone("timeline");
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.closest?.("[data-player-controls-glass], [data-player-skip]")) {
      focused.blur();
    }
    setControlsVisible(false);
  },
  focusBarTimeline,
  focusBarButtons,
  moveBarButton,
  closeEpisodeRow,
  activateFocusedControl,
  togglePlay,
  jump,
  previewSeek: previewTimelineBy,
  confirmPreview: confirmTimelinePreview,
  cancelPreview: cancelTimelinePreview,
  applyVolume,
  flash: flashActionFeedback,
  navigateEpisode,
  openSubtitles: () => {
    if (isSportsLiveStream) return;
    setPlayerMenu("subtitles");
    holdControls();
    focusPlayerOverlay();
  },
  openEpisodesOrSources: () => {
    if (episodeOptions.length > 0) {
      holdControls();
      setActiveSidePanel(null);
      setGamepadBarMode(true);
      setBigPictureEpisodesOpen(true);
      setBarZone("episodes");
      return;
    }
    if (!canHaveSources) return;
    setActiveSidePanel("sources");
    holdControls();
    focusPlayerOverlay();
  },
  closeTopOverlay: () => {
    if (subtitleSync.open) {
      subtitleSync.closeSync();
      return true;
    }
    if (playerMenu !== null) {
      setPlayerMenu(null);
      return true;
    }
    if (activeSidePanel !== null) {
      setActiveSidePanel(null);
      return true;
    }
    return false;
  },
});
// Big Picture: al aparecer intro/resumen/outro, el botón toma foco solo para
// omitir con A. Sin diálogos ni paneles encima.
const activeSkipKey = activeSkipSegment && postPlayAction === "skip"
  ? `${activeSkipSegment.id}:${activeSkipSegment.start}:${activeSkipSegment.end}`
  : "";
// Opening a menu unmounts the button. Measure its new node when it reappears,
// even if the segment and the control bar visibility have not changed.
useLayoutEffect(() => {
  if (
    !isBigPicturePlayer
    || !floatingActionsVisible
    || !activeSkipKey
    || !playbackPreferences.skipSegmentsEnabled
    || !mpvReadyForCommands
    || !playbackStarted
  ) return;
  const player = playerShellRef.current;
  const button = skipButtonRef.current;
  const actions = player?.querySelector<HTMLElement>(".bp-bar-actions");
  if (!player || !button || !actions) return;

  const syncPosition = () => {
    // Medir el layout, no la caja transformada por la animación de entrada.
    // getBoundingClientRect durante el spring guardaba una posición demasiado
    // baja: al terminar de subir los controles quedaban pegados al salto.
    let top = 0;
    let left = 0;
    let element: HTMLElement | null = actions;
    while (element && element !== player) {
      top += element.offsetTop;
      left += element.offsetLeft;
      element = element.offsetParent as HTMLElement | null;
    }
    if (element !== player) return;
    button.style.right = `${Math.max(0, player.clientWidth - left - actions.offsetWidth)}px`;
    button.style.bottom = `${Math.max(0, player.clientHeight - top + 32)}px`;
  };
  syncPosition();

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncPosition);
  observer?.observe(player);
  observer?.observe(actions);
  if (actions.parentElement) observer?.observe(actions.parentElement);
  const glass = actions.closest<HTMLElement>("[data-player-controls-glass]");
  if (glass) observer?.observe(glass);
  window.addEventListener("resize", syncPosition);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", syncPosition);
  };
}, [activeSkipKey, controlsActive, floatingActionsVisible, isBigPicturePlayer, playbackPreferences.skipSegmentsEnabled, mpvReadyForCommands, playbackStarted]);
useEffect(() => {
  if (!isBigPicturePlayer) return;
  // El salto toma foco para A solo cuando la navegación espacial del mando
  // está activa; en modo PC el ratón no debe heredar un foco visual pegado.
  if (!gamepadBarMode) return;
  if (!activeSkipKey || !playbackPreferences.skipSegmentsEnabled) return;
  if (!mpvReadyForCommands || !playbackStarted) return;
  if (playerMenu !== null || activeSidePanel !== null || subtitleSync.open || showUpNext) return;
  const timer = window.setTimeout(() => {
    skipButtonRef.current?.focus({ preventScroll: true });
  }, 60);
  return () => window.clearTimeout(timer);
}, [activeSkipKey, gamepadBarMode, isBigPicturePlayer, playbackPreferences.skipSegmentsEnabled, mpvReadyForCommands, playbackStarted, playerMenu, activeSidePanel, subtitleSync.open, showUpNext]);
// Al ocultarse la barra, soltar su foco para que la cruceta vuelva al modo directo.
useEffect(() => {
  if (controlsActive) return;
  cancelTimelinePreview();
  const focused = document.activeElement as HTMLElement | null;
  if (focused?.closest?.("[data-player-controls-glass]")) focused.blur();
}, [cancelTimelinePreview, controlsActive]);
// Si la barra se oculta por otra vía (ratón/timeout), salir del modo barra.
useEffect(() => {
  if (controlsActive || !gamepadBarMode) return;
  setGamepadBarMode(false);
  setBarZone("timeline");
}, [controlsActive, gamepadBarMode]);
// Espera de la fuente del anfitrión: aviso tras 12s + salida (efecto aquí
// porque necesita partyStatus/partyIsOwner/stream ya declarados).
useEffect(() => {
  const waiting = partyStatus === "connected" && !partyIsOwner && !stream;
  if (!waiting) {
    setPartyWaitExceeded(false);
    return;
  }
  const timer = window.setTimeout(() => setPartyWaitExceeded(true), 12_000);
  return () => window.clearTimeout(timer);
}, [partyStatus, partyIsOwner, stream]);
// Presencia Discord (debajo de party a propósito: usa su estado).
useDiscordPresence({
  enabled: playbackPreferences.enableDiscordRichPresence,
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
  partyConnected: partyStatus === "connected",
  partyLobby,
  partyIsOwner,
  partyPeerCount: partyPeers.length,
  partyPeerNames: partyPeers.map(peer => peer.name),
  partyRoomCode: partyRoomCode,
  partyRoomServer: partyRoomServer,
});
// Miembros (que no soy yo) congelados ahora mismo: hay que esperarlos.
const partyWaitingFor = partyStatus === "connected"
  ? partyBufferingPeers.filter(peer => peer.id !== partySelfId)
  : [];
// Arte del lobby: fondo del medio + logo (con fallback a texto).
const partyLobbyBackdrop = selectedMediaBackground
  || (typeof stream?.behaviorHints?.background === "string" ? stream.behaviorHints.background : "")
  || (typeof stream?.behaviorHints?.poster === "string" ? stream.behaviorHints.poster : "");
const partyLobbyLogo = sanitizeLogoUrl(selectedMediaLogo || detailLogoUrl || addonLogoUrl || seriesLogoUrl);
// ---- Lobby: crossfade de fondo/logo como en Detail (stack prev/curr + precarga) ----
const [lobbyBgStack, setLobbyBgStack] = useState<{ prev: string | null; curr: string }>({ prev: null, curr: "" });
const [lobbyLogoStack, setLobbyLogoStack] = useState<{ prev: string | null; curr: string }>({ prev: null, curr: "" });
const lobbyBgTokenRef = useRef(0);
const lobbyLogoTokenRef = useRef(0);
const lobbyBgPrevRef = useRef<HTMLImageElement | null>(null);
const lobbyBgCurrRef = useRef<HTMLImageElement | null>(null);
const lobbyLogoPrevRef = useRef<HTMLImageElement | null>(null);
const lobbyLogoCurrRef = useRef<HTMLImageElement | null>(null);

useLayoutEffect(() => {
  const next = partyLobbyBackdrop;
  if (!partyLobby || !next || lobbyBgStack.curr === next) return;
  const token = ++lobbyBgTokenRef.current;
  let cancelled = false;
  const commit = () => {
    if (cancelled || lobbyBgTokenRef.current !== token) return;
    setLobbyBgStack(latest => (latest.curr === next ? latest : { prev: latest.curr || null, curr: next }));
  };
  if (!lobbyBgStack.curr) {
    commit();
    return () => { cancelled = true; };
  }
  const probe = new Image();
  probe.decoding = "async";
  probe.src = next;
  if (probe.complete && probe.naturalWidth > 0) {
    commit();
  } else {
    probe.onload = commit;
    probe.onerror = commit;
  }
  return () => { cancelled = true; };
}, [partyLobby, partyLobbyBackdrop, lobbyBgStack.curr]);

useLayoutEffect(() => {
  if (!partyLobby) return;
  const currEl = lobbyBgCurrRef.current;
  if (!currEl) return;
  const prevEl = lobbyBgPrevRef.current;
  const targets = [prevEl, currEl].filter((el): el is HTMLImageElement => el !== null);
  const targetCurr = lobbyBgStack.curr;
  gsap.killTweensOf(targets);
  if (lobbyBgStack.prev && prevEl) {
    gsap.to(prevEl, { opacity: 0, duration: 0.62, ease: "power1.out", overwrite: true });
    gsap.fromTo(currEl, { opacity: 0 }, {
      opacity: 0.5,
      duration: 0.62,
      ease: appleEase,
      overwrite: true,
      onComplete: () => setLobbyBgStack(current => (current.curr === targetCurr && current.prev ? { prev: null, curr: current.curr } : current)),
    });
  } else {
    gsap.fromTo(currEl, { opacity: 0, scale: 1.02 }, { opacity: 0.5, scale: 1, duration: 0.68, ease: "power3.out", overwrite: true });
  }
  return () => { gsap.killTweensOf(targets); };
}, [partyLobby, lobbyBgStack]);

useLayoutEffect(() => {
  const next = partyLobbyLogo;
  if (!partyLobby || !next || lobbyLogoStack.curr === next) return;
  const token = ++lobbyLogoTokenRef.current;
  let cancelled = false;
  const commit = () => {
    if (cancelled || lobbyLogoTokenRef.current !== token) return;
    setLobbyLogoStack(latest => (latest.curr === next ? latest : { prev: latest.curr || null, curr: next }));
  };
  if (!lobbyLogoStack.curr) {
    commit();
    return () => { cancelled = true; };
  }
  const probe = new Image();
  probe.decoding = "async";
  probe.src = next;
  if (probe.complete && probe.naturalWidth > 0) {
    commit();
  } else {
    probe.onload = commit;
    probe.onerror = commit;
  }
  return () => { cancelled = true; };
}, [partyLobby, partyLobbyLogo, lobbyLogoStack.curr]);

useLayoutEffect(() => {
  if (!partyLobby) return;
  const currEl = lobbyLogoCurrRef.current;
  if (!currEl) return;
  const prevEl = lobbyLogoPrevRef.current;
  const targets = [prevEl, currEl].filter((el): el is HTMLImageElement => el !== null);
  const targetCurr = lobbyLogoStack.curr;
  gsap.killTweensOf(targets);
  if (lobbyLogoStack.prev && prevEl) {
    gsap.to(prevEl, { opacity: 0, duration: 0.34, ease: "power1.out", overwrite: true });
    gsap.fromTo(currEl, { opacity: 0 }, {
      opacity: 1,
      duration: 0.34,
      ease: appleEase,
      overwrite: true,
      onComplete: () => setLobbyLogoStack(current => (current.curr === targetCurr && current.prev ? { prev: null, curr: current.curr } : current)),
    });
  } else {
    gsap.fromTo(currEl, { opacity: 0 }, { opacity: 1, duration: 0.34, ease: appleEase, overwrite: true });
  }
  return () => { gsap.killTweensOf(targets); };
}, [partyLobby, lobbyLogoStack]);

useEffect(() => {
  if (partyStatus === "connected") partyConnectedAtRef.current = Date.now();
}, [partyStatus]);

// Anunciar lo que veo al entrar / cambiar de episodio.
useEffect(() => {
  if (partyStatus !== "connected" || !query || !partyQueryKey) return;
  if (partyQueryKey === partyJustFollowedKeyRef.current) {
    partyJustFollowedKeyRef.current = "";
    partyLastSentMediaKeyRef.current = partyQueryKey;
    return;
  }
  if (partyQueryKey === partyLastSentMediaKeyRef.current) return;
  partyLastSentMediaKeyRef.current = partyQueryKey;
  partySendMedia({ type: query.type, id: query.id, season: query.season, episode: query.episode, title: mediaTitle });
}, [partyStatus, partyQueryKey, query, mediaTitle, partySendMedia]);

// Seguir al grupo: la sala cambió de contenido y no fui yo. Directo al
// Player con el contenido de la sala (la fuente del anfitrión se aplica ahí;
// nunca se resuelve fuente propia para seguir).
useEffect(() => {
  const event = partyLastMediaEvent;
  if (partyStatus !== "connected" || !event?.media) return;
  if (event.from && event.from === partySelfId) return;
  const key = partyMediaKey(event.media);
  if (!key || key === partyQueryKey) return;
  partyJustFollowedKeyRef.current = key;
  const target = event.media;
  try {
    sessionStorage.removeItem(SELECTED_STREAM_KEY);
    sessionStorage.removeItem(AVAILABLE_STREAMS_KEY);
    sessionStorage.setItem(SELECTED_ENGINE_KEY, "mpv");
    sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
      name: ("title" in target && target.title) || target.id,
      logo: "",
      background: "",
      poster: "",
      resumeTime: 0,
    }));
  } catch {
    // best-effort
  }
  navigate(buildPlayerPath(`type=${target.type}&id=${encodeURIComponent(target.id)}${target.season != null ? `&season=${target.season}` : ""}${target.episode != null ? `&ep=${target.episode}` : ""}`));
}, [partyStatus, partyLastMediaEvent, partySelfId, partyQueryKey, navigate]);

function partyCanBroadcast(): boolean {
  if (partyStatus !== "connected" || !playbackStarted || isTrailerStream) return false;
  // En lobby nadie emite: el anfitrión libera con la secuencia de arranque.
  if (partyLobbyRef.current) return false;
  if (Date.now() - partyConnectedAtRef.current < 5000) return false;
  if (Date.now() - partyStreamSwitchAtRef.current < 5000) return false;
  if (Date.now() - partyLastRemoteAt() < PARTY_ECHO_WINDOW_MS) return false;
  return true;
}

// Compartir el cambio de velocidad como nuevo snapshot, no como acción suelta.
useEffect(() => {
  const previous = partyLastPublishedRateRef.current;
  partyLastPublishedRateRef.current = selectedSpeed;
  if (previous === selectedSpeed || !partyCanBroadcast()) return;
  partySendControl(playing ? "play" : "pause", Math.max(0, currentTimeRef.current), Number(selectedSpeed) || 1);
}, [selectedSpeed, playing, partyStatus, playbackStarted, partySendControl]);

// Al salir/cambiar de sala se olvida el stream compartido anterior.
useEffect(() => {
  if (partyStatus !== "idle") return;
  partyLastSharedTargetRef.current = "";
  partyShareWarnedRef.current = "";
  partyAppliedOfferAtRef.current = 0;
  partyAppliedOfferTargetRef.current = "";
  partyFailedTargetRef.current = "";
  partyWaitPauseRef.current = false;
  partyWaitOverrideRef.current = false;
  partyBufferingSentRef.current = false;
  window.clearTimeout(partyBufferTimerRef.current);
  setPartyStreamFailed(false);
}, [partyStatus, partyRoomCode]);

// Solo el anfitrión comparte su stream (misma URL/magnet para todos). Nunca
// se comparte el objeto entero: solo el destino reproducible + cabeceras saneadas.
const partyShareWarnedRef = useRef("");
useEffect(() => {
  if (partyStatus !== "connected" || !stream || isTrailerStream) return;
  if (!partyIsOwner) return;
  if (!partyQueryKey || !partyRoomKey || partyQueryKey !== partyRoomKey) return;
  const { offer, reason } = buildShareableOffer(stream);
  if (!offer) {
    // Visible: sin esto el anfitrión nunca sabe por qué los invitados no
    // reciben su fuente (una sola vez por sala+fuente+motivo).
    const warnKey = `${partyRoomCode}:${reason ?? "?"}:${getPlaybackTarget(stream)}`;
    if (partyShareWarnedRef.current !== warnKey) {
      partyShareWarnedRef.current = warnKey;
      partyNotify(`Esta fuente no se puede compartir en la sala: ${describeUnshareableReason(reason)}.`);
    }
    return;
  }
  if (offer.target === partyLastSharedTargetRef.current) return;
  partyLastSharedTargetRef.current = offer.target;
  partySendStream(offer);
}, [partyStatus, stream, isTrailerStream, partyIsOwner, partyQueryKey, partyRoomKey, partySendStream]);

// Heredar la sala (el anfitrión se fue): re-compartir la fuente actual para
// que la sala no se quede sin origen (quien entre tarde, recargas, Empezar).
// Solo si ya veo la fuente del grupo; si no, no hay nada que ofrecer.
useEffect(() => {
  const was = partyWasOwnerRef.current;
  partyWasOwnerRef.current = partyIsOwner;
  if (was || !partyIsOwner || partyStatus !== "connected" || !stream || isTrailerStream) return;
  if (!partyQueryKey || !partyRoomKey || partyQueryKey !== partyRoomKey) return;
  const groupTarget = partyLastStreamOffer?.offer.target;
  if (stream.addonId !== "party" && getPlaybackTarget(stream) !== groupTarget) return;
  const { offer } = buildShareableOffer(stream);
  if (!offer || offer.target === partyLastSharedTargetRef.current) return;
  partyLastSharedTargetRef.current = offer.target;
  partySendStream(offer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyIsOwner, partyStatus, stream, isTrailerStream, partyQueryKey, partyRoomKey]);

// Al entrar alguien (también tras migrar el anfitrión): el owner re-comparte
// la fuente actual para que el recién llegado la reciba sin esperar cambios.
const partyPeerCountRef = useRef(0);
useEffect(() => {
  const prev = partyPeerCountRef.current;
  partyPeerCountRef.current = partyPeers.length;
  if (partyPeers.length <= prev) return;
  if (!partyIsOwner || partyStatus !== "connected" || !stream || isTrailerStream) return;
  if (!partyQueryKey || !partyRoomKey || partyQueryKey !== partyRoomKey) return;
  const groupTarget = partyLastStreamOffer?.offer.target;
  if (stream.addonId !== "party" && getPlaybackTarget(stream) !== groupTarget) return;
  const { offer, reason } = buildShareableOffer(stream);
  if (!offer) {
    const warnKey = `${partyRoomCode}:${reason ?? "?"}:${getPlaybackTarget(stream)}`;
    if (partyShareWarnedRef.current !== warnKey) {
      partyShareWarnedRef.current = warnKey;
      partyNotify(`Esta fuente no se puede compartir en la sala: ${describeUnshareableReason(reason)}.`);
    }
    return;
  }
  partyLastSharedTargetRef.current = offer.target;
  partySendStream(offer);
  // Foto del estado para el recién llegado: sin esto arranca solo desde su
  // propio resume hasta el próximo control del anfitrión (o nunca, si está
  // en pausa). En lobby no: ahí manda la secuencia de arranque.
  if (!partyLobbyRef.current) {
    partySendControl(playing ? "play" : "pause", Math.max(0, currentTimeRef.current), Number(selectedSpeed) || 1);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyPeers, partyIsOwner, partyStatus, stream, isTrailerStream, partyQueryKey, partyRoomKey, playing]);

// Reintentar la fuente del anfitrión cuando no abrió en este dispositivo.
function retryPartyStream() {
  const event = partyLastStreamOffer;
  if (partyStatus !== "connected" || !event?.offer) return;
  partyFailedTargetRef.current = "";
  partyAppliedOfferAtRef.current = 0;
  partyStreamSwitchAtRef.current = Date.now();
  partyNoteRemote();
  setPartyStreamFailed(false);
  setStream(partyOfferToMediaStream(event.offer, event.from));
}

// Aplicar la fuente del anfitrión: misma fuente exacta en todos los dispositivos.
function applyPartyStreamOffer(event: PartyStreamEvent) {
  // Invitado recién llegado (sin stream propio): la oferta del anfitrión ES su
  // fuente — no hace falta tener una propia para aceptarla.
  const guestNoStream = !stream && !partyIsOwner;
  if ((!stream && !guestNoStream) || isTrailerStream || showUpNext) return;
  if (event.offer.target === partyFailedTargetRef.current) return;
  if (partyRoomKey && partyQueryKey && partyRoomKey !== partyQueryKey) return;
  const myTarget = getPlaybackTarget(stream);
  if (myTarget && myTarget === event.offer.target) {
    partyAppliedOfferAtRef.current = event.at;
    partyAppliedOfferTargetRef.current = event.offer.target;
    setPartyStreamFailed(false);
    return;
  }
  partyAppliedOfferAtRef.current = event.at;
  partyAppliedOfferTargetRef.current = event.offer.target;
  partyStreamSwitchAtRef.current = Date.now();
  partyNoteRemote();
  setPartyStreamFailed(false);
  // Invitado sin stream previo: encajar metadatos del medio para que el
  // player cargue con identidad (título/arte) aunque no venga del picker.
  if (guestNoStream) {
    setSelectedMediaName(prev => prev || (event.offer.label || mediaTitle));
    try {
      const savedMeta = sessionStorage.getItem(SELECTED_MEDIA_META_KEY);
      if (savedMeta) {
        const parsed = JSON.parse(savedMeta) as { name?: string; background?: string; poster?: string; logo?: string; resumeTime?: number };
        if (!parsed.name) {
          parsed.name = mediaTitle;
          sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify(parsed));
        }
      } else {
        sessionStorage.setItem(SELECTED_MEDIA_META_KEY, JSON.stringify({
          name: mediaTitle,
          background: selectedMediaBackground,
          poster: selectedMediaPoster,
          logo: selectedMediaLogo,
          resumeTime: 0,
        }));
      }
    } catch {
      // Metadatos best-effort: el stream del grupo es lo importante.
    }
  }
  setStream(partyOfferToMediaStream(event.offer, event.from));
}

useEffect(() => {
  const event = partyLastStreamOffer;
  if (partyStatus !== "connected" || !event?.offer) return;
  if (event.from === partySelfId || event.at <= partyAppliedOfferAtRef.current) return;
  applyPartyStreamOffer(event);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyLastStreamOffer, partyStatus, partySelfId, stream, isTrailerStream, showUpNext, partyRoomKey, partyQueryKey]);

// Si la fuente del anfitrión no abre en este dispositivo: marcar fallo (la
// sala siempre usa su fuente; reintentar desde el aviso).
useEffect(() => {
  if (partyStatus !== "connected" || partyIsOwner) return;
  if (!mpvStatus || !/no inici/i.test(mpvStatus)) return;
  if (!partyAppliedOfferTargetRef.current || partyStreamFailed) return;
  partyFailedTargetRef.current = partyAppliedOfferTargetRef.current;
  partyStreamSwitchAtRef.current = Date.now();
  partyNoteRemote();
  setPartyStreamFailed(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [mpvStatus, partyStatus, partyIsOwner, partyStreamFailed]);

// Avisar si me congelo: solo si persiste 2s (evita flapping de seeks) y veo lo mismo que la sala.
const partyBuffering = playbackStarted && !isTrailerStream && playing && (mpvPausedForCache || stalledPlayback || seekBuffering);
useEffect(() => {
  if (partyStatus !== "connected" || partyLobby || !partyBuffering || (partyRoomKey && partyQueryKey !== partyRoomKey)) {
    window.clearTimeout(partyBufferTimerRef.current);
    if (partyBufferingSentRef.current) {
      partyBufferingSentRef.current = false;
      partySendPresence(false);
    }
    return;
  }
  if (partyBufferingSentRef.current) return;
  window.clearTimeout(partyBufferTimerRef.current);
  partyBufferTimerRef.current = window.setTimeout(() => {
    partyBufferingSentRef.current = true;
    partySendPresence(true);
  }, 2000);
  return () => window.clearTimeout(partyBufferTimerRef.current);
}, [partyBuffering, partyStatus, partyLobby, partyQueryKey, partyRoomKey, partySendPresence]);

// Esperar a los que cargan: pauso en silencio (sin emitir) y reanudo solo.
useEffect(() => {
  if (partyStatus !== "connected" || partyLobby || !playbackStarted || isTrailerStream || showUpNext) return;
  if (partyRoomKey && partyQueryKey && partyRoomKey !== partyQueryKey) return;
  if (partyWaitingFor.length === 0) {
    partyWaitOverrideRef.current = false;
    if (partyWaitPauseRef.current) {
      partyWaitPauseRef.current = false;
      if (!playing) togglePlay();
    }
    return;
  }
  if (partyWaitOverrideRef.current) return;
  if (playing) {
    partyWaitPauseRef.current = true;
    partyNoteRemote();
    togglePlay();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyWaitingFor, partyStatus, partyLobby, playbackStarted, isTrailerStream, showUpNext, playing, partyQueryKey, partyRoomKey]);

// Emitir play/pausa locales.
useEffect(() => {
  const was = partyPrevPlayingRef.current;
  partyPrevPlayingRef.current = playing;
  if (playing && partyWaitPauseRef.current && partyWaitingFor.length > 0) {
    // El usuario forzó reanudar durante la espera: su intención manda solo
    // para él (no arrastra al grupo) hasta que nadie cargue.
    partyWaitPauseRef.current = false;
    partyWaitOverrideRef.current = true;
    partyNoteRemote();
    return;
  }
  if (was === playing) return;
  if (!partyCanBroadcast()) return;
  if (currentTimeRef.current < 2) return;
  partySendControl(playing ? "play" : "pause", Math.max(0, currentTimeRef.current), Number(selectedSpeed) || 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [playing, partyStatus, playbackStarted, isTrailerStream]);

// Emitir seeks locales (saltos > 3s entre ticks = seek manual).
useEffect(() => {
  if (partyStatus !== "connected" || !playbackStarted || isTrailerStream) return;
  const previous = partyLastSeekTimeRef.current;
  partyLastSeekTimeRef.current = currentTime;
  if (previous == null) return;
  if (!partyCanBroadcast()) return;
  if (Math.abs(currentTime - previous) > PARTY_SEEK_JUMP_S) {
    partySendControl("seek", Math.max(0, currentTime), Number(selectedSpeed) || 1);
  }
}, [currentTime, partyStatus, playbackStarted, isTrailerStream, partySendControl, partyLastRemoteAt]);

// Aplicar acciones remotas del grupo.
useEffect(() => {
  const event = partyLastControl;
  if (partyStatus !== "connected" || !event) return;
  if (event.from === partySelfId || event.at <= partyLastAppliedControlAtRef.current) return;
  if (!playbackStarted || isTrailerStream || showUpNext) return;
  // En lobby el play lo libera solo la secuencia de arranque (que ya limpió el lobby).
  if (partyLobby) return;
  if (partyRoomKey && partyQueryKey && partyRoomKey !== partyQueryKey) return;
  // Anti-grief: más de 8 acciones en 10s = mute 60s + aviso.
  const now = Date.now();
  if ((partyMutedPeersRef.current[event.from] ?? 0) > now) return;
  const log = (partyPeerControlLogRef.current[event.from] ?? []).filter(stamp => now - stamp < 10_000);
  log.push(now);
  partyPeerControlLogRef.current[event.from] = log;
  if (log.length > 8) {
    partyMutedPeersRef.current[event.from] = now + 60_000;
    const offender = partyPeers.find(peer => peer.id === event.from);
    partyNotify(`Se ignora a ${offender?.name ?? "un miembro"} 60s por spam de controles.`);
    return;
  }
  partyLastAppliedControlAtRef.current = event.at;
  partyNoteRemote();
  // Al dar play, el emisor siguió avanzando durante el tránsito del mensaje:
  // compensar con el tiempo transcurrido desde el sello del servidor.
  // En pausa/seek la posición es exacta y no se compensa.
  const transitS = event.kind === "play" && Number.isFinite(event.at) ? Math.max(0, (partyServerNow() - event.at) / 1000) : 0;
  const position = Math.max(0, event.position + transitS);
  if (event.kind === "seek") {
    seek(position);
    return;
  }
  const wantPlaying = event.kind === "play";
  void sendMpvCommand(["set_property", "speed", event.rate]);
  if (wantPlaying !== playing) {
    if (Math.abs(currentTimeRef.current - position) > PARTY_DRIFT_TOLERANCE_S) seek(position);
    togglePlay();
  } else if (Math.abs(currentTimeRef.current - position) > PARTY_DRIFT_TOLERANCE_S) {
    seek(position);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyLastControl, partyStatus, partyLobby, partySelfId, partyRoomKey, partyQueryKey, playbackStarted, isTrailerStream, showUpNext, playing, partyPeers, partyNotify, partyServerNow]);

// Motor de corrección continua: corrige el desfase con el reloj del servidor,
// usa seeks solo para errores grandes y un nudge temporal de velocidad para
// errores pequeños. No actúa mientras se carga, se busca o el lobby está activo.
useEffect(() => {
  if (partyStatus !== "connected" || !partyLastControl || isTrailerStream) {
    if (partySyncNudgeRef.current !== null) {
      partySyncNudgeRef.current = null;
      void sendMpvCommand(["set_property", "speed", Number(selectedSpeed) || 1]);
    }
    return;
  }
  const interval = window.setInterval(() => {
    const event = partyLastControl;
    if (!event || event.kind !== "play" || !playing || !playbackStarted || partyLobby
      || isTrailerStream || showUpNext || timelinePreviewTime !== null || mpvPausedForCache || stalledPlayback) return;
    const correction = getPartyCorrection(
      currentTimeRef.current,
      { seq: event.seq, memberId: event.from, paused: false, position: event.position, rate: event.rate, at: event.at },
      partyServerNow(),
      partySyncNudgeRef.current !== null,
    );
    if (correction.type === "seek") {
      partySyncNudgeRef.current = null;
      void sendMpvCommand(["set_property", "speed", event.rate]);
      seek(correction.position);
    } else if (correction.type === "nudge") {
      if (partySyncNudgeRef.current !== correction.rate) {
        partySyncNudgeRef.current = correction.rate;
        void sendMpvCommand(["set_property", "speed", correction.rate]);
      }
    } else if (partySyncNudgeRef.current !== null) {
      partySyncNudgeRef.current = null;
      void sendMpvCommand(["set_property", "speed", event.rate]);
    }
  }, 500);
  return () => window.clearInterval(interval);
}, [partyStatus, partyLastControl, partyLobby, playbackStarted, isTrailerStream, showUpNext, playing, timelinePreviewTime, mpvPausedForCache, stalledPlayback, selectedSpeed, partyServerNow]);

// ---- Party lobby (sala de espera): retener en pausa al inicio y precargar ----
function partyLobbyReady(): boolean {
  return !!stream && mpvFileLoaded && !partyStreamFailed
    && !!partyQueryKey && !!partyRoomKey && partyQueryKey === partyRoomKey;
}

// Entrar al lobby: pausa + vuelta al inicio + hold de autoplay (el preload de
// mpv carga en pausa). El contexto estampa `waiting` al conectar.
useEffect(() => {
  if (partyLobby === partyLobbyPrevRef.current) return;
  partyLobbyPrevRef.current = partyLobby;
  if (!partyLobby || isTrailerStream) return;
  manualPausedRef.current = true;
  setManualPaused(true);
  setPlaying(false);
  setStalledPlayback(false);
  void sendMpvCommand(["set_property", "pause", true]);
  if (playbackStarted || mpvFileLoaded) {
    partyLobbyStartBypassRef.current = true;
    try {
      seek(0);
    } finally {
      partyLobbyStartBypassRef.current = false;
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyLobby, isTrailerStream, playbackStarted, mpvFileLoaded]);

// Presencia de lobby: `buffering=true` = aún cargando; `false` = listo.
// (El efecto normal de buffering se pausa en lobby y este toma el mando.)
useEffect(() => {
  if (partyStatus !== "connected" || !partyLobby || isTrailerStream) return;
  partySendPresence(!partyLobbyReady());
}, [partyStatus, partyLobby, isTrailerStream, stream, mpvFileLoaded, partyStreamFailed, partyQueryKey, partyRoomKey, partySendPresence]);

// Watchdog del hold: re-impone pausa+inicio mientras haya lobby. Cubre el
// `pause` inicial perdido (mpv aún sin IPC al abrir), StrictMode y cualquier
// desincronización (mpv reproduciendo con React en pausa). Converge solo.
useEffect(() => {
  if (partyStatus !== "connected" || !partyLobby || isTrailerStream) return;
  const id = window.setInterval(() => {
    if (!partyLobbyRef.current || partyLobbyStartBypassRef.current) return;
    manualPausedRef.current = true;
    setManualPaused(true);
    setPlaying(false);
    setStalledPlayback(false);
    if (mpvFileLoaded && mpvReadyForCommands) {
      void sendMpvCommand(["set_property", "pause", true]);
      if (currentTimeRef.current > 2) {
        partyLobbyStartBypassRef.current = true;
        try {
          seek(0);
        } finally {
          partyLobbyStartBypassRef.current = false;
        }
      }
    }
  }, 800);
  return () => window.clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyStatus, partyLobby, isTrailerStream, mpvFileLoaded, mpvReadyForCommands]);

// Arranque local desde el inicio (sin emitir: lo usa quien recibe "started").
function playPartyFromStart() {
  partyLobbyStartBypassRef.current = true;
  try {
    manualPausedRef.current = false;
    setManualPaused(false);
    seek(0);
    partyNoteRemote();
    if (!playing) togglePlay();
  } finally {
    partyLobbyStartBypassRef.current = false;
  }
}

// Arranque del grupo (anfitrión): libera el lobby, reparte contenido + oferta
// por debajo (cubre a quien entró tarde) y emite play@0.
function startPartyPlayback() {
  if (!partyIsOwner || !partyLobbyRef.current) return;
  partySendLobby("started");
  if (query && !isTrailerStream) {
    partySendMedia({ type: query.type, id: query.id, season: query.season, episode: query.episode, title: mediaTitle });
    if (stream) {
      const { offer } = buildShareableOffer(stream);
      if (offer) {
        partyLastSharedTargetRef.current = offer.target;
        partySendStream(offer);
      }
    }
  }
  playPartyFromStart();
  partySendControl("play", 0, Number(selectedSpeed) || 1);
}

// Reaccionar a "started": el anfitrión ya arrancó en su click (from propio).
useEffect(() => {
  const event = partyLastLobbyEvent;
  if (partyStatus !== "connected" || !event || event.state !== "started") return;
  if (event.at <= partyLobbyAppliedStartRef.current) return;
  partyLobbyAppliedStartRef.current = event.at;
  if (event.from === partySelfId) return;
  if (isTrailerStream || showUpNext) return;
  playPartyFromStart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [partyLastLobbyEvent, partyStatus, partySelfId, isTrailerStream, showUpNext, playing]);

// Corrección de deriva: converge a la línea de tiempo compartida cada 12s.
const partyActionsRef = useRef({ togglePlay, seek });
partyActionsRef.current = { togglePlay, seek };
const partyLiveRef = useRef({ control: partyLastControl, playing, started: playbackStarted, trailer: isTrailerStream, upNext: showUpNext, queryKey: partyQueryKey, roomKey: partyRoomKey });
partyLiveRef.current = { control: partyLastControl, playing, started: playbackStarted, trailer: isTrailerStream, upNext: showUpNext, queryKey: partyQueryKey, roomKey: partyRoomKey };
useEffect(() => {
  if (partyStatus !== "connected") return;
  const id = window.setInterval(() => {
    const live = partyLiveRef.current;
    const event = live.control;
    if (!event || !live.started || live.trailer || live.upNext) return;
    if (!live.queryKey || !live.roomKey || live.queryKey !== live.roomKey) return;
    if (Date.now() - partyLastRemoteAt() < PARTY_ECHO_WINDOW_MS) return;
    const expected = event.kind === "play" ? event.position + (Date.now() - event.at) / 1000 : event.position;
    if (!Number.isFinite(expected) || expected < 0) return;
    const current = currentTimeRef.current;
    partyNoteRemote();
    if (event.kind === "pause") {
      if (live.playing && Date.now() - event.at > 3000) {
        if (Math.abs(current - expected) > 1) partyActionsRef.current.seek(expected);
        partyActionsRef.current.togglePlay();
      }
      return;
    }
    if (Math.abs(current - expected) > PARTY_DRIFT_TOLERANCE_S) {
      partyActionsRef.current.seek(expected);
    }
  }, PARTY_DRIFT_INTERVAL_MS);
  return () => window.clearInterval(id);
}, [partyStatus, partyNoteRemote, partyLastRemoteAt]);

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
    if (isIframeStream) return;
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
}, [showUpNext, isIframeStream, mpvReadyForCommands, mpvFileLoaded, videoScaleMode, mpvTracks, mpvVideoWidth, mpvVideoHeight]);

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
// Panel fallback (error MPV): el mando/teclado se enfoca solo en
// "Reintentar reproducción" (A lo activa, B/Esc sale). Normal y Big Picture.
useEffect(() => {
  if (!showFallbackPanel) return;
  const timer = window.setTimeout(() => {
    fallbackRetryButtonRef.current?.focus({ preventScroll: true });
  }, 60);
  return () => window.clearTimeout(timer);
}, [showFallbackPanel]);
const playerVisuallyReady = playbackStarted || (mpvReadyForCommands && mpvFileLoaded && playing);
const bufferingActive = seekBuffering || stalledPlayback || mpvPausedForCache;
const bufferingSignal = !manualPaused
  && !showFallbackPanel
  && ((playbackStarted && bufferingActive) || (mpvFileLoaded && bufferingActive));
const initialPlaybackLoading = !playerVisuallyReady;
const showPrePlaybackBackdrop = !showFallbackPanel && !playbackStarted && !mpvError;

  // ---- Pantalla de pausa (estilo Netflix) -------------------------------
  // Va ANTES de los `return` de carga y de estado vacio: el hook del retraso
  // tiene que ejecutarse en todos los renders, o React complains con
  // "Rendered more hooks than during the previous render".
  //
  // Sustituye a los controles en vez de superponerse: aparece 3 s despues de
  // pausar, cuando la barra ya se ocultó sola, y cualquier `wakeControls()` la
  // retira. Todo lo que bloquea (avisos, paneles, Up Next, lobby de Party,
  // buffering) la mantiene oculta para que nunca tape algo accionable.
  const pauseScreenBlocked = showUpNext
    || hasPostPlayPrompt
    || activeSidePanel !== null
    || bigPictureEpisodesOpen
    || playerMenu !== null
    || subtitleSync.open
    || partyLobby
    || stalledPlayback
    || seekBuffering
    || loadingOverlayVisible;
  const pauseScreenArmed = manualPaused
    && playbackStarted
    && !showFallbackPanel
    && !isLiveStream
    && !isTrailerStream
    && !pauseScreenBlocked;
  const pauseScreenReady = usePauseScreenDelay(pauseScreenArmed, 3000);
  const pauseScreenVisible = pauseScreenReady && !controlsVisible;

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
        sandbox="allow-scripts allow-same-origin allow-presentation"
      />
      <div className="absolute left-5 top-5 z-20 flex gap-2">
        <button
          type="button"
          onClick={goBack}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-white/16 bg-black/72 text-white backdrop-blur-glass-sm gsap-transition hover:bg-black/88"
          title="Volver"
          aria-label="Volver"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          type="button"
          onClick={() => void openExternalUrl(playbackTarget)}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-white/16 bg-black/72 text-white backdrop-blur-glass-sm gsap-transition hover:bg-black/88"
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
  // Invitado en sala: su fuente es la del anfitrión; si aún no llegó, esperarla
  // (lobby/cargando) en vez de "No hay una fuente seleccionada".
  if (partyStatus === "connected" && !partyIsOwner) {
    return (
      <div className="relative flex h-screen items-center justify-center overflow-hidden bg-black text-white">
        {partyLobbyBackdrop ? (
          <img
            src={partyLobbyBackdrop}
            alt=""
            decoding="async"
            className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center opacity-30 grayscale"
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 bg-black/60" />
        <div className="relative z-10 flex flex-col items-center gap-4">
          <AppleSpinner size={34} color="rgba(255,255,255,0.7)" />
          <p className="text-sm font-semibold text-white/70">
            {partyRoomKey && partyQueryKey && partyRoomKey !== partyQueryKey
              ? "La sala cambió de contenido, cargando…"
              : "Conectado a la sala, esperando la fuente del anfitrión…"}
          </p>
          {partyRoomCode ? <p className="text-xs font-bold tracking-[0.25em] text-white/40">{partyRoomCode}</p> : null}
          {partyWaitExceeded ? (
            <p className="max-w-[300px] text-center text-xs leading-5 text-white/45">
              Si tarda demasiado, el anfitrión puede no estar compartiendo su fuente.
            </p>
          ) : null}
          <button onClick={goBack} className="liquid-glass mt-1 rounded-md px-5 py-2 text-sm font-bold">
            Volver
          </button>
        </div>
      </div>
    );
  }
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
  const loadingArtwork =
    selectedMediaLogo
    || sanitizeLogoUrl(resumeEntry?.logo)
    || detailLogoUrl
    || addonLogoUrl
    || seriesLogoUrl
    || null;
  const backgroundArtwork = contrastArtwork;
  const playerShellClassName = !showFallbackPanel
    ? `relative h-screen w-screen overflow-hidden ${nativeSurfaceVisible ? "bg-transparent" : "bg-black"} text-white`
    : "relative h-screen w-screen overflow-hidden bg-[#1e1e1e] text-white";

  // El logo del medio. Para una serie manda el logo de la serie; si no hay, el
  // que resolvio el catalogo (mismo orden de preferencia que `loadingArtwork`).
  const pauseScreenLogo = query
    ? (seriesLogoUrl || selectedMediaLogo || detailLogoUrl || addonLogoUrl || null)
    : null;
  const pauseScreenOverview = query
    ? (currentEpisode?.overview?.trim()
      || readDetailMediaMeta(query.type, query.id)?.description?.trim()
      || "")
    : "";
  
  return (
    <div
      ref={playerShellRef}
      className={playerShellClassName}
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      data-player-direct-input={!showFallbackPanel && !subtitleSync.open && playerMenu === null && activeSidePanel === null && !showUpNext && !gamepadBarMode ? "true" : "false"}
      onPointerMove={() => {
        if (gamepadBarMode) setGamepadBarMode(false);
        wakeControls();
      }}
      onPointerDown={startHoldToAccelerate}
      onPointerUp={stopHoldToAccelerate}
      onPointerCancel={stopHoldToAccelerate}
      onPointerLeave={stopHoldToAccelerate}
      onClickCapture={releasePointerControlFocus}
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
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#1e1e1e] px-8 text-center">
          <div className="pointer-events-auto liquid-glass-dark max-w-lg rounded-lg p-6 opacity-95 gsap-transition hover:opacity-100">
            <h1 className="mb-3 text-xl font-black">{isLiveStream && mpvBundled !== false ? "No se pudo reproducir el directo" : "libmpv interno"}</h1>
            {mpvBundled === false && (
              <p className="mb-4 rounded-md bg-white/10 px-4 py-3 text-xs text-white/62">
                MPV interno no esta instalado en el bundle. Instala el runtime compatible con libmpv en src-tauri/bin/mpv y vuelve a empaquetar.
              </p>
            )}
            {mpvStatus && <p className="mb-4 text-xs text-white/58">{mpvStatus}</p>}
            {isLiveStream && liveRetryDelay(liveFailure, liveRetryAttempts) !== null && !manualPaused ? (
              <p role="status" className="mb-4 text-sm text-white/80">Intentando recuperar la conexión ({liveRetryAttempts + 1}/2)…</p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-3">
            <button
              ref={fallbackRetryButtonRef}
              data-player-interactive
              onClick={() => void retryMpvPlayback()}
              className="min-h-11 rounded-md bg-white px-5 py-2.5 font-bold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
            >
              Reintentar reproducción
            </button>
            {canHaveSources ? <button type="button" data-player-interactive onClick={() => setActiveSidePanel("sources")}
              className="min-h-11 rounded-md border border-white/30 bg-white/10 px-5 py-2.5 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Elegir otra fuente</button> : null}
            </div>
            {playbackTarget && <p className="mt-4 break-all text-xs text-white/32">{playbackTarget}</p>}
          </div>
        </div>
      ) : null}
      {/*
        El aviso "el reproductor nativo se abre en pantalla completa" se elimino
        junto con el soporte de Android: solo tenia sentido alli, donde Media3
        corria en su propia Activity y el webview quedaba vacio.

        En escritorio mpv se dibuja en la ventana nativa por detras de este DOM,
        asi que el cartel solo tapaba el video. Sin Android queda un unico
        camino, y en web un fallo de apertura lo cubre `showFallbackPanel`.
      */}


      <PlayerLoadingOverlay visible={loadingOverlayVisible} artwork={loadingArtwork} title={mediaTitle} message={mpvStatus} hideMessage={playbackStarted} p2p={isP2pStream} sportsMatch={selectedSportsMatch} compactSports={playbackStarted} />
      {isLiveStream ? (
        <LiveBadge
          atEdge={livePlayback.atLiveEdge}
          latencySeconds={livePlayback.latency}
          playing={playing}
        />
      ) : null}
      {isLiveStream && livePlayback.ended ? (
        <LiveEndedNotice
          onRetry={() => {
            setMpvStatus("Reconectando al directo...");
            void launchMpv(false);
          }}
        />
      ) : null}
      {/* OSD central: play/pausa/seek/volumen por teclado o click. No despierta la barra. */}
      <PlayerActionFeedback feedback={actionFeedback} />
      {contentRatingVisible && contentRating ? (
        <PlayerContentRating
          key={`${contentRatingKey}:${contentRating.age}:${contentRating.advisories.join("|")}`}
          rating={contentRating}
          bigPicture={isBigPicturePlayer}
          onComplete={completeContentRating}
        />
      ) : null}
      {fileDropNotice ? (
        <PlayerFloatingNotice top={24} nativeSurfaceVisible={nativeSurfaceVisible} interactive>
          {fileDropNotice}
        </PlayerFloatingNotice>
      ) : null}
      {subtitleSyncNotice ? (
        <PlayerFloatingNotice top={24} nativeSurfaceVisible={nativeSurfaceVisible} interactive>
          {subtitleSyncNotice}
        </PlayerFloatingNotice>
      ) : null}
      {playbackSelectionNotice ? (
        <PlayerFloatingNotice top={108} nativeSurfaceVisible={nativeSurfaceVisible} playbackSelection>
          {playbackSelectionNotice}
        </PlayerFloatingNotice>
      ) : null}
      {videoFilterNotice ? (
        <PlayerFloatingNotice top={68} nativeSurfaceVisible={nativeSurfaceVisible} interactive>
          {videoFilterNotice}
        </PlayerFloatingNotice>
      ) : null}

      {postPlayAction === "skip" && floatingActionsVisible && activeSkipSegment && playbackStarted ? (
        <button
          ref={skipButtonRef}
          data-player-interactive
          data-player-skip
          type="button"
          // The controls' transparent metadata area overlaps this button. Keep
          // it above their z-40 layer so the visible button receives clicks.
          className="bp-skip-button absolute z-50 flex items-center justify-center whitespace-nowrap gsap-transition"
          style={isBigPicturePlayer
            ? {
              // `right` = el padding lateral de la barra, para que el extremo
              // derecho de la pastilla coincida con el de la linea de tiempo
              // (regla que se ve en la referencia). `bottom` la deja por encima
              // del contenido: en la referencia el boton ocupa la fila de los
              // metadatos, aqui esa fila tiene los iconos a la derecha.
              // Fija: no baja al cerrarse la barra, el salto se notaba.
              right: "clamp(28px, 6.4vw, 132px)",
              bottom: "clamp(160px, 23vh, 280px)",
            }
            : {
              right: "max(32px, calc((100vw - min(1240px, calc(100vw - 32px))) / 2 + 24px))",
              bottom: controlsActive ? 166 : 44,
            }}
          onClick={event => {
            event.stopPropagation();
            seek(activeSkipSegment.end + 0.15);
          }}
        >
          {activeSkipSegment.kind === "recap" ? "Saltar resumen" : activeSkipSegment.kind === "outro" ? "Saltar outro" : "Saltar intro"}
        </button>
      ) : null}

      {postPlayVisible ? (
        <PlayerNextPrompt
          key={postPlayKey}
          rootRef={postPlayRef}
          label={postPlayAction === "next-episode" ? "Siguiente episodio" : "Ver recomendación"}
          autoPlay={postPlayAction === "next-episode" && playbackPreferences.autoPlayNextEpisode}
          running={(playing || mpvEofReached) && !manualPaused && !mpvPausedForCache && !(mpvCacheBuffering > 0 && mpvCacheBuffering < 100) && !stalledPlayback && !seekBuffering}
          onPlay={activatePostPlayPrompt}
          onCancel={cancelPostPlayPrompt}
          onControls={() => {
            wakeControls();
            setGamepadBarMode(true);
            focusBarTimeline();
          }}
        />
      ) : null}

      {isBigPictureRoute ? (
        <EpisodePanel
          visible={activeSidePanel === "episodes" && showPanelToggle}
          title={title}
          streamName={mediaTitle}
          seriesLogoUrl={seriesLogoUrl}
          currentEpisode={currentEpisode}
          currentOverview={currentOverview}
          items={panelItems}
          hasEpisodeOptions={episodeOptions.length > 0}
          canGoPrevEpisode={canGoPrevEpisode}
          canGoNextEpisode={canGoNextEpisode}
          bigPicture
          onClose={() => setActiveSidePanel(null)}
          onNavigateEpisode={navigateEpisode}
        />
      ) : null}

      <SourcePanel
        visible={activeSidePanel === "sources"}
        bigPicture={isBigPictureRoute}
        streams={availableStreams}
        loading={resolvingSources}
        currentStreamId={stream.id}
        onClose={() => setActiveSidePanel(null)}
        onSelect={selectSource}
      />
      {!isSportsReplay && activeSidePanel === "sources" && sourcesMediaKey && resolveAttemptedKeyRef.current !== sourcesMediaKey ? (
        <SourceResolver
          key={sourcesMediaKey}
          query={query as StreamQuery}
          currentStream={stream}
          searchName={selectedMediaName || title}
          onResolved={resolved => {
            resolveAttemptedKeyRef.current = sourcesMediaKey;
            setResolvingSources(false);
            setAvailableStreams(current => (current.length ? current : resolved));
            // Se guarda ya resuelta: la siguiente vez el panel abre al instante.
            if (resolved.length) writeAvailableStreamsSnapshot(sourcesMediaKey, resolved);
          }}
        />
      ) : null}

      {isBigPicturePlayer ? (
        <div
          data-player-episode-row-backdrop
          aria-hidden="true"
          className={`bp-player-episode-row-backdrop pointer-events-none absolute inset-0 z-30${bigPictureEpisodesOpen ? " is-open" : ""}`}
          style={{
            background: "rgba(20,21,24,0.42)",
            // MPV dibuja sobre una superficie nativa: el blur real lo añade
            // episodePanel del shader. En web la misma capa usa el material CSS.
            backdropFilter: nativeSurfaceVisible ? "none" : "var(--lg-filter-xl)",
            WebkitBackdropFilter: nativeSurfaceVisible ? "none" : "var(--lg-filter-xl)",
          }}
        />
      ) : null}

      {/* Pantalla de pausa: solo cuando los controles ya se ocultaron solos. */}
      <PlayerPauseScreen
        visible={pauseScreenVisible}
        mediumTitle={mediaTitle}
        logoUrl={pauseScreenLogo}
        isSeries={!isMovie}
        season={query?.season}
        episode={query?.episode}
        episodeTitle={currentEpisode?.name ?? null}
        overview={pauseScreenOverview}
      />

      <PlayerControls
        active={controlsReady && controlsActive && !showUpNext && !pauseScreenVisible}
        bigPicture={isBigPicturePlayer}
        legacyTv={isBigPictureRoute}
        currentMetaTitle={currentMetaTitle}
        streamingServiceBadge={streamingServiceBadge}
        videoFormatBadges={videoFormatBadges}
        title={title}
        bufferedAheadSeconds={mpvFileLoaded && !isLiveStream ? mpvDemuxerCacheDuration : 0}
        timelinePreviewTime={timelinePreviewTime}
        onTimelinePreviewChange={updateTimelinePreview}
        onConfirmTimelinePreview={confirmTimelinePreview}
        onCancelTimelinePreview={cancelTimelinePreview}
        currentTime={currentTime}
        duration={duration}
        playing={playing}
        volume={volume}
        selectedMpvAudio={selectedMpvAudio}
        selectedSubtitleValue={selectedSubtitleValue}
        selectedSpeed={selectedSpeed}
        selectedVideoProfile={selectedVideoProfile}
        videoScaleMode={videoScaleMode}
        isLocalPlayback={isLocalPlayback}
        repeatEnabled={isLocalPlayback && repeatLocal}
        onToggleRepeat={() => setRepeatLocal(value => !value)}
        audioOptions={normalizedAudioOptions}
      audioTechLogo={audioTechLogo}
        subtitleOptions={subtitleOptions}
        speedOptions={speedOptions}
        videoProfileOptions={VIDEO_ENHANCEMENT_OPTIONS}
        subtitlesLoading={subtitlesLoading}
        subtitleDelayMs={subtitleDelayMs}
        subtitleScalePercent={subtitleScalePercent}
         subtitleVerticalPercent={subtitleVerticalPercent}
          subtitleSyncOpen={subtitleSync.open}
          subtitleSyncLoading={subtitleSync.loading}
          subtitleSyncError={subtitleSync.error}
          subtitleSyncCanUseManual={subtitleSync.canUseManual}
          subtitleSyncStage={subtitleSync.stage}
          subtitleSyncCues={subtitleSync.visibleCues}
          subtitleSyncCapturedVideoMs={subtitleSync.capturedVideoMs}
        subtitleSyncTrackLabel={subtitleOptions.find(option => option.value === selectedMpvSubtitle)?.label ?? ""}
        liveMode={isLiveStream}
        sportsLiveMode={isSportsLiveStream}
        sportsSourceStreams={availableStreams}
        selectedSportsSourceId={stream.id}
        onSportsSourceChange={sourceId => {
          const nextSource = availableStreams.find(candidate => candidate.id === sourceId);
          if (nextSource) selectSource(nextSource);
        }}
        liveLatencySeconds={livePlayback.latency}
        liveAtEdge={livePlayback.atLiveEdge}
        liveDvrProgress={livePlayback.dvrProgress}
        onGoLive={livePlayback.goLive}
        nativeSurfaceVisible={nativeSurfaceVisible}
         openMenu={playerMenu}
        onOpenMenuChange={setPlayerMenu}
        showPanelToggle={showPanelToggle}
        activeSidePanel={activeSidePanel}
        episodesRowOpen={bigPictureEpisodesOpen}
        episodeOptions={episodeOptions}
        currentEpisodeNumber={query?.episode}
        hasEpisodeOptions={episodeOptions.length > 0}
        controlsLocked={false}
        lobbyMode={partyLobby}
        partyConnected={partyStatus === "connected"}
        partyPeerNames={partyPeers.map(peer => peer.name)}
        canGoPrevEpisode={canGoPrevEpisode}
        canGoNextEpisode={canGoNextEpisode}
        canChangeSource={canHaveSources}
        onBarFocusChange={handleBarFocusChange}
        onBarFocusWithinChange={handleBarFocusWithinChange}
        onCloseEpisodeRow={closeEpisodeRow}
        onSelectEpisode={episode => {
          const nextParams = new URLSearchParams({
            type: query?.type ?? "series",
            id: query?.id ?? "",
            season: String(episode.season),
            ep: String(episode.episode),
          });
          void stopNativePlayback().finally(() => navigate(buildEpisodePath(nextParams.toString())));
        }}
        onControlsEnter={holdControls}
        onControlsLeave={() => releaseControls(2)}
        onJump={jumpWithFeedback}
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
          const semanticAudio = audioOptions.find(option => option.value === value);
          if (semanticAudio && createPlaybackTrackPreference(semanticAudio)) {
            const saveResult = playbackSelection.saveAudioPreference(semanticAudio);
            if (!saveResult.ok) showPlaybackSelectionNotice("No se pudo guardar en este dispositivo");
          }
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
          const semanticSubtitle = value
            ? subtitleOptions.find(option => option.value === value) ?? null
            : null;
          if (!semanticSubtitle || createPlaybackTrackPreference(semanticSubtitle)) {
            const saveResult = playbackSelection.saveSubtitlePreference(semanticSubtitle);
            if (!saveResult.ok) showPlaybackSelectionNotice("No se pudo guardar en este dispositivo");
          }
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
        onCloseSubtitleSync={subtitleSync.closeSync}
        onForgetTitle={subtitleTitleKey ? () => {
          clearAutoSyncTitleMode(subtitleTitleKey);
          subtitleSync.closeSync();
        } : undefined}
        onCaptureSubtitleSync={() => void subtitleSync.capture()}
        onApplySubtitleSyncCue={subtitleSync.applyCue}
        onUseManualSubtitleSync={subtitleSync.fallbackToManual}
        onPickSubtitleTrack={() => {
          subtitleSync.closeSync();
          focusSubtitleMenuTrack();
        }}
        onSpeedChange={value => {
          setSelectedSpeed(value);
          void sendMpvCommand(["set_property", "speed", Number(value)]);
        }}
        onVideoProfileChange={applyVideoProfile}
        onToggleVideoScale={toggleVideoScale}
        onToggleSourcePanel={() => setActiveSidePanel(value => value === "sources" ? null : "sources")}
        onToggleEpisodePanel={() => setBigPictureEpisodesOpen(value => !value)}
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
            if (rec) navigate(buildEpisodePath(`type=${rec.type}&id=tmdb:${rec.tmdbId}`));
            }}
            onDetails={() => {
            dismissUpNext();
            const rec = related.recommendation;
            if (rec) navigate(buildDetailPath(rec.type, `tmdb:${rec.tmdbId}`));
            }}
            onCountdownEnd={() => {
            dismissUpNext();
            const rec = related.recommendation;
            if (rec) navigate(buildEpisodePath(`type=${rec.type}&id=tmdb:${rec.tmdbId}`));
            }}
            onMiniClick={dismissUpNext}
            />
      ) : null}

      {partyStatus === "connected" && !partyLobby && partyWaitingFor.length > 0 ? (
        <div className="gsap-fade-in pointer-events-none fixed bottom-24 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/15 bg-black/70 py-2.5 pl-4 pr-5 backdrop-blur-glass-sm">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <p className="whitespace-nowrap text-sm font-bold text-white">
            Esperando a {partyWaitingFor.slice(0, 2).map(peer => peer.name).join(", ")}{partyWaitingFor.length > 2 ? ` +${partyWaitingFor.length - 2}` : ""}…
          </p>
        </div>
      ) : null}
      {partyLobby && partyStatus === "connected" && !isTrailerStream ? (
        <div
          className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-black/70 p-5"
          onClick={event => event.stopPropagation()}
        >
          {lobbyBgStack.curr ? (
            <>
              {lobbyBgStack.prev ? (
                <img ref={lobbyBgPrevRef} src={lobbyBgStack.prev} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <img ref={lobbyBgCurrRef} src={lobbyBgStack.curr} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/65" />
            </>
          ) : null}
          <div role="dialog" aria-label="Sala de espera Party" className="gsap-fade-in relative w-full max-w-sm rounded-[28px] border border-white/10 bg-white/[0.06] p-6 shadow-[0_32px_90px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-glass-lg">
            <p className="text-sm font-bold text-white/55">Sala de espera</p>
            {lobbyLogoStack.curr ? (
              <div className="relative mt-2 flex min-h-10 items-center">
                {lobbyLogoStack.prev ? (
                  <img ref={lobbyLogoPrevRef} src={lobbyLogoStack.prev} alt="" aria-hidden="true" className="absolute inset-0 max-h-20 w-auto max-w-full object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.8)]" />
                ) : null}
                <img ref={lobbyLogoCurrRef} src={lobbyLogoStack.curr} alt={mediaTitle} className="max-h-20 w-auto max-w-full object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.8)]" />
              </div>
            ) : (
              <p className="mt-1 truncate text-xl font-black tracking-tight text-white">{mediaTitle}</p>
            )}
            <button
              type="button"
              onClick={() => {
                if (!partyRoomCode) return;
                void navigator.clipboard?.writeText(partyRoomCode).then(() => {
                  setPartyCodeCopied(true);
                  window.setTimeout(() => setPartyCodeCopied(false), 1500);
                }).catch(() => undefined);
              }}
              className="gsap-transition mt-3 flex w-full items-center justify-center gap-2.5 rounded-full border border-white/12 bg-white/10 px-5 py-2.5 active:scale-[0.97]"
              aria-label="Copiar código de sala"
            >
              <span className="text-2xl font-black tracking-[0.25em] text-white">{partyRoomCode}</span>
              <span className="text-xs font-bold text-white/55">{partyCodeCopied ? "¡Copiado!" : "Copiar"}</span>
            </button>
            <div className="mt-4 flex flex-wrap gap-2">
              {[{ id: partySelfId, name: `${partyPeers.find(peer => peer.id === partySelfId)?.name ?? "Tú"} (tú)`, ready: partyLobbyReady() },
                ...partyPeers.filter(peer => peer.id !== partySelfId).map(peer => ({
                  id: peer.id,
                  name: `${peer.name}${peer.isOwner ? " · anfitrión" : ""}`,
                  ready: !partyBufferingPeers.some(entry => entry.id === peer.id),
                })),
              ].map(member => (
                <span key={member.id || member.name} className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/85">
                  <span className={`h-1.5 w-1.5 rounded-full ${member.ready ? "bg-emerald-300" : "animate-pulse bg-white/70"}`} />
                  {member.name}{member.ready ? "" : " · cargando"}
                </span>
              ))}
            </div>
            {partyStreamFailed && !partyIsOwner ? (
              <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-xs leading-5 text-amber-200/90">
                  La fuente del anfitrión no abrió en tu dispositivo.
                </p>
                <button
                  type="button"
                  onClick={() => retryPartyStream()}
                  className="gsap-transition mt-2.5 w-full rounded-full bg-white px-4 py-2 text-xs font-black text-black hover:bg-white/86 active:scale-[0.97]"
                >
                  Reintentar
                </button>
                <button
                  type="button"
                  onClick={() => { const streamsPath = getStreamsPath(); if (streamsPath) navigate(streamsPath); }}
                  className="gsap-transition mt-2 w-full rounded-full border border-white/12 px-4 py-2 text-xs font-black text-white/70 hover:bg-white/10 hover:text-white active:scale-[0.98]"
                >
                  Usar mi propia fuente
                </button>
              </div>
            ) : null}
            {partyIsOwner ? (
              <>
                <button
                  type="button"
                  onClick={() => startPartyPlayback()}
                  className="gsap-transition mt-4 w-full rounded-full bg-white px-5 py-3 text-sm font-black text-black hover:bg-white/86 active:scale-[0.97]"
                >
                  Empezar para todos
                </button>
                <p className="mt-2 text-center text-xs text-white/50">
                  {[partyLobbyReady(), ...partyPeers.map(peer => !partyBufferingPeers.some(entry => entry.id === peer.id))].filter(Boolean).length} de {partyPeers.length + 1} listos · los que falten se ponen al día solos
                </p>
              </>
            ) : (
              <p className="mt-4 flex items-center justify-center gap-2 text-center text-sm font-bold text-white/70">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                </span>
                Esperando al anfitrión…
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
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
