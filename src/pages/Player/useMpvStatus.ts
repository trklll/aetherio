import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChapterOption, MpvStatusSnapshot, MpvTrack } from "./types";

interface MpvEventPayload {
  event?: string;
  property?: string;
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
  setSelectedMpvSubtitle: Dispatch<SetStateAction<string>>;
  setSelectedMpvAudio: Dispatch<SetStateAction<string>>;
  setSelectedSpeed: Dispatch<SetStateAction<string>>;
  setChapterIndex: Dispatch<SetStateAction<number | null>>;
  setChapterOptions: Dispatch<SetStateAction<ChapterOption[]>>;
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
  setSelectedMpvSubtitle,
  setSelectedMpvAudio,
  setSelectedSpeed,
  setChapterIndex,
  setChapterOptions,
}: UseMpvStatusArgs) {
  useEffect(() => {
    let cancelled = false;

    function applyStatus(status: MpvStatusSnapshot) {
      if (cancelled) return;

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
      setChapterOptions([]);
      setMpvFileLoaded(false);
      setMpvPausedForCache(false);
      setMpvCacheBuffering(0);
    }

    const syncMpvStatus = async () => {
      try {
        const status = await invoke<MpvStatusSnapshot>("mpv_status");
        applyStatus(status);
      } catch {
        if (!cancelled) resetMpvState();
      }
    };

    const unlistenPromise = listen<MpvEventPayload>("mpv-event", event => {
      if (event.payload.event) debugLog("mpv event", { event: event.payload.event, property: event.payload.property });
      if (event.payload.snapshot) applyStatus(event.payload.snapshot);
    });

    void syncMpvStatus();
    const interval = window.setInterval(() => {
      void syncMpvStatus();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      void unlistenPromise.then(unlisten => unlisten());
      resetMpvState();
    };
  }, []);
}
