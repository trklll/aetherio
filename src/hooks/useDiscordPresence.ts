/**
 * useDiscordPresence — Aetherio's port of stremio-enhanced's `discordTracker`.
 *
 * Unlike stremio-enhanced (Electron + `@xhayper/discord-rpc` running in the
 * renderer), Aetherio is Tauri: the Discord IPC client runs in native Rust
 * and the frontend drives it via the helpers in `integrations/discordPresence`.
 *
 * The hook mirrors stremio's "Watching" / "Paused" activity states and is
 * scoped to actual playback only (we agreed to leave "Exploring"/"Main Menu"
 * out). It is designed to be driven by `Player/index.tsx` — that page already
 * owns the canonical playback state and re-renders when it changes, so we
 * avoid the polling/observer hack stremio needs (which polls DOM <video>).
 */
import { useEffect, useRef } from "react";
import type { StreamQuery, MediaStream } from "../types/stream";
import {
  startDiscordRichPresence,
  stopDiscordRichPresence,
  setDiscordActivity,
  clearDiscordActivity,
} from "../integrations/discordPresence";

export interface DiscordPresenceInput {
  /** True when the user has enabled Rich Presence in Settings. */
  enabled: boolean;
  /** Whether there is a stream loaded in the native player. */
  hasStream: boolean;
  /** Whether playback has started (first frame received). */
  playbackStarted: boolean;
  /** Native player actively playing (not paused). */
  playing: boolean;
  /** User-initiated pause (vs. cache/buffer pause). */
  manualPaused: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Stream duration in seconds. */
  duration: number;
  /** Stream query (type / id / season / episode). */
  query: StreamQuery | null;
  /** The resolved stream object (used for poster fallback). */
  stream: MediaStream | null;
  /** Already-sanitized media title from the selected metadata snapshot. */
  mediaName: string;
  /** Episode title from TMDB, e.g. "Kassa". */
  episodeName?: string;
  /** Sanitized poster URL for the large image when available. */
  posterUrl?: string;
  /** Trailer streams should not advertise as "Watching". */
  isTrailer: boolean;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function buildEpisodeLabel(query: StreamQuery | null, episodeName?: string): string | null {
  if (!query || query.type === "movie") return null;
  const season = query.season ?? 0;
  const episode = query.episode ?? 0;
  const label = episodeName ? `${episodeName} (S${season}-E${episode})` : `S${season} E${episode}`;
  return label;
}

function buildDetailUrl(query: StreamQuery | null): string {
  if (!query) return "https://github.com/trklll/aetherio";
  return `https://www.themoviedb.org/${query.type}/${query.id}`;
}

export function useDiscordPresence(input: DiscordPresenceInput) {
  const lastSignatureRef = useRef<string>("");

  // Lifecycle: connect/disconnect the IPC client when the toggle flips.
  useEffect(() => {
    if (!input.enabled) {
      void clearDiscordActivity();
      void stopDiscordRichPresence();
      lastSignatureRef.current = "";
      return;
    }
    void startDiscordRichPresence();
    return () => {
      // Clear on unmount/disable but keep the client warm for next playback.
      void clearDiscordActivity();
      lastSignatureRef.current = "";
    };
  }, [input.enabled]);

  // Activity updates driven by state changes. We avoid redundant updates by
  // building a signature from the fields that affect the rendered activity.
  useEffect(() => {
    if (!input.enabled) return;
    if (!input.hasStream || !input.playbackStarted || input.isTrailer) {
      return;
    }

    const title = input.mediaName || input.stream?.name || input.stream?.title || "Reproduciendo";
    const detailUrl = buildDetailUrl(input.query);
    const buttons = [
      { label: "Más detalles", url: detailUrl },
      { label: "Ver en Aetherio", url: "https://github.com/trklll/aetherio" },
    ];

    let signature: string;
    if (input.playing) {
      signature = `playing:${input.query?.id}:${input.query?.season}:${input.query?.episode}:${Math.floor(input.currentTime)}`;
    } else {
      signature = `paused:${input.query?.id}:${input.query?.season}:${input.query?.episode}:${formatTimestamp(input.currentTime)}`;
    }

    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    if (input.playing) {
      const start = Math.floor(Date.now() / 1000) - Math.floor(Math.max(0, input.currentTime));
      const end = input.duration > 0 ? start + Math.floor(input.duration) : undefined;
      const episodeLabel = buildEpisodeLabel(input.query, input.episodeName);

      void setDiscordActivity({
        details: title,
        state: episodeLabel || title,
        startTimestamp: start,
        endTimestamp: end,
        largeImageKey: input.posterUrl || "aetherio",
        largeImageText: title,
        smallImageKey: "play",
        smallImageText: "Reproduciendo",
        buttons,
      });
      return;
    }

    // Paused branch — show position, no timestamps.
    void setDiscordActivity({
      details: title,
      state: `Pausado en ${formatTimestamp(input.currentTime)}`,
      largeImageKey: input.posterUrl || "aetherio",
      largeImageText: title,
      smallImageKey: "pause",
      smallImageText: "Pausado",
      buttons,
    });
  }, [
    input.enabled,
    input.hasStream,
    input.playbackStarted,
    input.playing,
    input.manualPaused,
    input.currentTime,
    input.duration,
    input.query,
    input.stream,
    input.mediaName,
    input.posterUrl,
    input.isTrailer,
  ]);

  // Hard clear when the stream is gone (e.g. navigating away mid-playback).
  useEffect(() => {
    if (!input.enabled) return;
    if (!input.hasStream || !input.playbackStarted) {
      if (lastSignatureRef.current !== "") {
        lastSignatureRef.current = "";
        void clearDiscordActivity();
      }
    }
  }, [input.enabled, input.hasStream, input.playbackStarted]);
}
