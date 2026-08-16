/**
 * Discord Rich Presence bindings for the Aetherio desktop runtime.
 *
 * The native client lives in the Tauri (Rust) process — `src-tauri/src/discord_rpc.rs` —
 * because the renderer is plain web (no Node, so the `@xhayper/discord-rpc` package that
 * stremio-enhanced uses cannot run here). These helpers mirror the Rust commands and
 * follow the same shape as the other platform helpers in `runtime/platform.ts`.
 */
import { invokeCommand } from "../runtime/platform";

export interface DiscordActivityButton {
  label: string;
  url: string;
}

export interface DiscordActivityPayload {
  /** Free-form first line, typically the media title. */
  details: string;
  /** Free-form second line, e.g. "Watching S1 E3" or "Paused at 00:42:11". */
  state: string;
  /** Unix epoch (seconds) for the play start. Omit while paused. */
  startTimestamp?: number;
  /** Unix epoch (seconds) for the expected end. Omit while paused. */
  endTimestamp?: number;
  /** Large image key (asset name or external URL). Falls back to the Aetherio asset. */
  largeImageKey?: string;
  /** Tooltip for the large image. */
  largeImageText?: string;
  /** Small image key (e.g. "play"/"pause"). */
  smallImageKey?: string;
  /** Tooltip for the small image. */
  smallImageText?: string;
  /** Up to two clickable buttons. Discord renders at most two. */
  buttons?: DiscordActivityButton[];
}

/**
 * Connects (or reuses) the Discord IPC client. Idempotent: safe to call when
 * already connected. The renderer should call this once on startup if the
 * user toggle is enabled so the connection is warm before playback.
 */
export async function startDiscordRichPresence(): Promise<void> {
  try {
    await invokeCommand("discord_rpc_start");
  } catch (error) {
    console.warn("[AETHERIO:DISCORD] start failed", String(error));
  }
}

/** Tears down the Discord IPC client and clears any visible activity. */
export async function stopDiscordRichPresence(): Promise<void> {
  try {
    await invokeCommand("discord_rpc_stop");
  } catch (error) {
    console.warn("[AETHERIO:DISCORD] stop failed", String(error));
  }
}

/**
 * Replaces the current activity. If the IPC client is not yet connected we
 * attempt a one-shot connect on the Rust side, so a missing `start()` call
 * does not silently swallow the first update.
 */
export async function setDiscordActivity(payload: DiscordActivityPayload): Promise<void> {
  try {
    await invokeCommand("discord_rpc_set_activity", {
      payload: {
        details: payload.details ?? "",
        state: payload.state ?? "",
        startTimestamp: payload.startTimestamp ?? 0,
        endTimestamp: payload.endTimestamp ?? 0,
        largeImageKey: payload.largeImageKey ?? null,
        largeImageText: payload.largeImageText ?? null,
        smallImageKey: payload.smallImageKey ?? null,
        smallImageText: payload.smallImageText ?? null,
        buttons: payload.buttons ?? [],
      },
    });
  } catch (error) {
    console.warn("[AETHERIO:DISCORD] setActivity failed", String(error));
  }
}

/** Clears the activity but keeps the IPC client connected. */
export async function clearDiscordActivity(): Promise<void> {
  try {
    await invokeCommand("discord_rpc_clear");
  } catch (error) {
    console.warn("[AETHERIO:DISCORD] clear failed", String(error));
  }
}