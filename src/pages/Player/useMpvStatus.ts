import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getNativePlaybackStatus, listenPlatformEvent } from "../../runtime/platform";
import type { ChapterOption, MpvStatusSnapshot, MpvTrack } from "./types";

interface MpvEventPayload {
  event?: string;
  property?: unknown;
  target?: string;
  snapshot?: MpvStatusSnapshot;
}

interface UseMpvStatusArgs {
  lastMpvFileLoadedRef: { current: boolean };
  lastMpvCacheRef: { current: number };
  lastMpvPauseRef: { current: boolean | null };
  debugLog: (event: string, extra?: Record<string, unknown>) => void;
  setCurrentTime: Dispatch<SetStateAction<number>>;
  setDuration: Dispatch<SetStateAction<number>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setMpvFileLoaded: Dispatch<SetStateAction<boolean>>;
  setMpvPausedForCache: Dispatch<SetStateAction<boolean>>;
  setMpvCacheBuffering: Dispatch<SetStateAction<number>>;
  setMpvTracks: Dispatch<SetStateAction<MpvTrack[]>>;
  setMpvVideoWidth?: Dispatch<SetStateAction<number | null>>;
  setMpvVideoHeight?: Dispatch<SetStateAction<number | null>>;
  setMpvEofReached?: Dispatch<SetStateAction<boolean>>;
  setMpvDemuxerCacheDuration?: Dispatch<SetStateAction<number>>;
  setSelectedMpvSubtitle: Dispatch<SetStateAction<string>>;
  setSelectedMpvAudio: Dispatch<SetStateAction<string>>;
  setSelectedSpeed: Dispatch<SetStateAction<string>>;
  setChapterIndex: Dispatch<SetStateAction<number | null>>;
  setChapterOptions: Dispatch<SetStateAction<ChapterOption[]>>;
  setMpvStatus?: Dispatch<SetStateAction<string | null>>;
  onPlaybackRestart?: () => void;
  onThroughputStatus?: (status: MpvStatusSnapshot) => void;
  isP2pStream?: boolean;
  enabled?: boolean;
}

export function useMpvStatus({
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
  setMpvVideoWidth,
  setMpvVideoHeight,
  setMpvEofReached,
  setMpvDemuxerCacheDuration,
  setSelectedMpvSubtitle,
  setSelectedMpvAudio,
  setSelectedSpeed,
  setChapterIndex,
  setChapterOptions,
  setMpvStatus,
  onPlaybackRestart,
  onThroughputStatus,
  isP2pStream = false,
  enabled = true,
}: UseMpvStatusArgs) {
  useEffect(() => {
    let cancelled = false;

    function applyStatus(status: MpvStatusSnapshot) {
      if (cancelled) return;
      onThroughputStatus?.(status);

      const nextTime = Number(status.timePos ?? 0);
      const nextDuration = Number(status.duration ?? 0);
      const nextFileLoaded = Boolean(status.fileLoaded);
      const nextCache = Number(status.cacheBufferingState ?? 0);
      const nextPause = status.pause === null || status.pause === undefined ? null : Boolean(status.pause);

      if (nextFileLoaded !== lastMpvFileLoadedRef.current) {
        lastMpvFileLoadedRef.current = nextFileLoaded;
        debugLog("mpv fileLoaded changed", { fileLoaded: nextFileLoaded });
      }
      if (nextCache !== lastMpvCacheRef.current) {
        lastMpvCacheRef.current = nextCache;
        debugLog("mpv cacheBuffering changed", { cacheBufferingState: nextCache });
      }
      if (nextPause !== lastMpvPauseRef.current) {
        lastMpvPauseRef.current = nextPause;
        debugLog("mpv pause changed", { pause: nextPause });
      }

      setCurrentTime(prev => {
        const next = Number.isFinite(nextTime) ? nextTime : 0;
        return Math.abs(prev - next) < 0.25 ? prev : next;
      });
      setDuration(prev => {
        const next = Number.isFinite(nextDuration) ? Math.max(0, nextDuration) : 0;
        return prev === next ? prev : next;
      });
      setPlaying(prev => {
        const hasPlayableState = nextFileLoaded || nextDuration > 0 || nextTime > 0.05 || nextPause === false;
        const next = hasPlayableState && nextPause !== true;
        return prev === next ? prev : next;
      });
      setMpvFileLoaded(nextFileLoaded);
      setMpvPausedForCache(Boolean(status.pausedForCache));
      setMpvCacheBuffering(nextCache);

      const nextTracks = status.tracks ?? [];
      setMpvTracks(prev => JSON.stringify(prev) === JSON.stringify(nextTracks) ? prev : nextTracks);
      if (setMpvVideoWidth) {
        const w = typeof status.videoWidth === "number" && Number.isFinite(status.videoWidth) ? status.videoWidth : null;
        setMpvVideoWidth(prev => (prev === w ? prev : w));
      }
      if (setMpvVideoHeight) {
        const h = typeof status.videoHeight === "number" && Number.isFinite(status.videoHeight) ? status.videoHeight : null;
        setMpvVideoHeight(prev => (prev === h ? prev : h));
      }
      // Solo se propagan en directo: son las dos senales que definen el borde y
      // el final de una transmision, irrelevantes en VOD.
      if (setMpvEofReached) {
        const eof = Boolean(status.eofReached);
        setMpvEofReached(prev => (prev === eof ? prev : eof));
      }
      if (setMpvDemuxerCacheDuration) {
        const cached = Number(status.demuxerCacheDuration ?? 0);
        const next = Number.isFinite(cached) ? Math.max(0, cached) : 0;
        setMpvDemuxerCacheDuration(prev => (Math.abs(prev - next) < 0.2 ? prev : next));
      }

      const selectedSubtitleTrack = (status.tracks ?? []).find(track => {
        const kind = String(track.type ?? "").toLowerCase();
        return (
          (kind === "sub" || kind === "subtitle" || kind.includes("sub")) &&
          track.selected &&
          Number.isFinite(Number(track.id))
        );
      });
      const nextSub = typeof status.sid === "number"
        ? `track:${status.sid}`
        : selectedSubtitleTrack
          ? `track:${Number(selectedSubtitleTrack.id)}`
          : "";
      setSelectedMpvSubtitle(prev => (prev === nextSub ? prev : nextSub));

      const selectedAudioTrack = (status.tracks ?? []).find(track => {
        const kind = String(track.type ?? "").toLowerCase();
        return (
          (kind === "audio" || kind === "a" || kind.includes("audio")) &&
          track.selected &&
          Number.isFinite(Number(track.id))
        );
      });
      const nextAudio = typeof status.aid === "number"
        ? `track:${status.aid}`
        : selectedAudioTrack
          ? `track:${Number(selectedAudioTrack.id)}`
          : "";
      setSelectedMpvAudio(prev => (prev === nextAudio ? prev : nextAudio));

      const nextSpeed = String(status.speed ?? 1);
      setSelectedSpeed(prev => (prev === nextSpeed ? prev : nextSpeed));
      setChapterIndex(typeof status.chapter === "number" ? status.chapter : null);

      const nextChapters = (status.chapterList ?? []).map((chapter, index) => ({
        index,
        title: chapter.title?.trim() || `Capitulo ${index + 1}`,
        time: Number(chapter.time ?? 0),
      }));
      setChapterOptions(prev => JSON.stringify(prev) === JSON.stringify(nextChapters) ? prev : nextChapters);
    }

    function resetMpvState() {
      setMpvTracks([]);
      setMpvVideoWidth?.(null);
      setMpvVideoHeight?.(null);
      setMpvEofReached?.(false);
      setMpvDemuxerCacheDuration?.(0);
      setChapterOptions([]);
      setMpvFileLoaded(false);
      setMpvPausedForCache(false);
      setMpvCacheBuffering(0);
    }

    if (!enabled) {
      resetMpvState();
      return () => {
        cancelled = true;
        resetMpvState();
      };
    }

    const syncMpvStatus = async () => {
      try {
        const status = await getNativePlaybackStatus();
        applyStatus(status);
      } catch {
        if (!cancelled) resetMpvState();
      }
    };

    const unlistenPromise = listenPlatformEvent<MpvEventPayload>("mpv-event", event => {
      if (event.payload.event) debugLog("mpv event", { event: event.payload.event, property: event.payload.property });
      if (event.payload.event === "playback-restart") onPlaybackRestart?.();
      if (event.payload.event === "end-file" && !lastMpvFileLoadedRef.current) {
        setMpvStatus?.(isP2pStream
          ? "El torrent no entrego datos reproducibles. Puede no tener peers disponibles."
          : "MPV no pudo cargar esta fuente. Puede estar expirada o bloqueada por el servidor.");
      }
      if (event.payload.snapshot) applyStatus(event.payload.snapshot);
    });

    void syncMpvStatus();
    const interval = window.setInterval(() => {
      void syncMpvStatus();
    }, 300);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void unlistenPromise.then(unlisten => unlisten());
      resetMpvState();
    };
  }, [enabled, isP2pStream, onThroughputStatus]);
}
