import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MpvLaunchResult, MpvStatusSnapshot } from "../pages/Player/types.ts";

export type RuntimeKind = "desktop" | "android-tv" | "android" | "web";

export interface PlaybackOpenRequest {
  target: string;
  subtitle?: string;
  headers?: Record<string, string>;
  fileIdx?: number;
  episode?: number;
  startTime?: number;
  privateTorrent?: boolean;
  providerSessionKey?: string;
}

export interface PlaybackCapabilities {
  mpvBundled: boolean;
  backend?: string;
  formats?: string[];
}

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

export function isAndroidRuntime() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent);
}

export function isAndroidTvRuntime() {
  if (!isAndroidRuntime()) return false;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/(android tv|aft|bravia|shield|chromecast|smart-tv|smarttv|googletv|leanback)/i.test(ua)) return true;
  if (typeof window === "undefined") return false;
  const landscapeTvSize = window.matchMedia("(min-width: 960px) and (orientation: landscape)").matches;
  const noFinePointer = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  return landscapeTvSize && noFinePointer;
}

export function getRuntimeKind(): RuntimeKind {
  if (isAndroidTvRuntime()) return "android-tv";
  if (isAndroidRuntime()) return "android";
  if (isTauriRuntime()) return "desktop";
  return "web";
}

export function installRuntimeDocumentClasses() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;

  const apply = () => {
    const root = document.documentElement;
    const android = isAndroidRuntime();
    const androidTv = isAndroidTvRuntime();
    root.classList.toggle("aetherio-android", android);
    root.classList.toggle("aetherio-android-tv", androidTv);
    root.dataset.aetherioRuntime = getRuntimeKind();
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
  };
}

export function installAndroidTvRemoteNavigation() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isAndroidTvRuntime()) return;
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;

    const focusables = getFocusableElements();
    if (!focusables.length) return;
    const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = current ? focusables.indexOf(current) : -1;
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + direction + focusables.length) % focusables.length;
    const next = focusables[nextIndex];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  };

  window.addEventListener("keydown", onKeyDown, true);
  return () => window.removeEventListener("keydown", onKeyDown, true);
}

function getFocusableElements() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>([
    "button:not([disabled])",
    "a[href]",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",")));
  return nodes.filter(element => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  });
}

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export function listenPlatformEvent<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return Promise.resolve(() => undefined);
  return listen<T>(event, handler);
}

export async function getCurrentDeepLinks() {
  if (!isTauriRuntime()) return [];
  try {
    return await getCurrent();
  } catch {
    return [];
  }
}

export async function listenOpenUrls(handler: (urls: string[]) => void) {
  if (!isTauriRuntime()) return () => undefined;
  try {
    return await onOpenUrl(handler);
  } catch {
    return () => undefined;
  }
}

export async function openExternalUrl(url: string) {
  if (isTauriRuntime()) {
    try {
      await openUrl(url);
      return;
    } catch {
      // Fall through to the browser fallback.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function isWindowFullscreen() {
  if (!isTauriRuntime() || isAndroidRuntime()) return false;
  try {
    return await getCurrentWindow().isFullscreen();
  } catch {
    return false;
  }
}

export async function toggleWindowFullscreen() {
  if (isAndroidRuntime()) return;
  try {
    await invokeCommand("toggle_window_fullscreen");
    return;
  } catch {
    // Fall back to the JS window API when the native command is unavailable.
  }

  try {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  } catch {
    // Window controls are best-effort outside the desktop runtime.
  }
}

export async function minimizeWindow() {
  if (!isTauriRuntime() || isAndroidRuntime()) return;
  try {
    await getCurrentWindow().minimize();
  } catch {
    // Desktop chrome controls are best-effort.
  }
}

export async function closeWindow() {
  if (!isTauriRuntime() || isAndroidRuntime()) return;
  try {
    await getCurrentWindow().close();
  } catch {
    // Desktop chrome controls are best-effort.
  }
}

export async function getPlaybackCapabilities(): Promise<PlaybackCapabilities> {
  if (isAndroidRuntime()) {
    return {
      mpvBundled: true,
      backend: "android-media3",
      formats: ["https", "hls", "dash", "external-subtitles"],
    };
  }
  return invokeCommand<PlaybackCapabilities>("playback_capabilities");
}

export async function openNativePlayback(request: PlaybackOpenRequest): Promise<MpvLaunchResult> {
  if (isAndroidRuntime()) {
    return invokeCommand<MpvLaunchResult>("android_player_open", {
      target: request.target,
      subtitle: request.subtitle,
      headers: request.headers,
      fileIdx: request.fileIdx,
      startTime: request.startTime,
    });
  }

  return invokeCommand<MpvLaunchResult>("open_mpv", {
    target: request.target,
    subtitle: request.subtitle,
    headers: request.headers,
    fileIdx: request.fileIdx,
    episode: request.episode,
    startTime: request.startTime,
    privateTorrent: request.privateTorrent,
    providerSessionKey: request.providerSessionKey,
  });
}

export async function stopNativePlayback() {
  try {
    if (isAndroidRuntime()) {
      await invokeCommand("android_player_stop");
      return;
    }
    await invokeCommand("stop_mpv");
  } catch {
    // Stopping playback is intentionally best-effort during navigation cleanup.
  }
}

export async function getNativePlaybackStatus(): Promise<MpvStatusSnapshot> {
  if (isAndroidRuntime()) {
    return invokeCommand<MpvStatusSnapshot>("android_player_status");
  }
  return invokeCommand<MpvStatusSnapshot>("mpv_status");
}

export async function sendNativePlaybackCommand(command: unknown[]) {
  if (isAndroidRuntime()) {
    await invokeCommand("android_player_command", { command });
    return;
  }

  if (command[0] === "set_property") {
    const name = command[1];
    if (typeof name !== "string") throw new Error("Propiedad MPV invalida.");
    await invokeCommand("mpv_set_property", { name, value: command[2] ?? null });
    return;
  }

  await invokeCommand("mpv_command", { command });
}

export async function setNativeAutocrop(enabled: boolean) {
  if (isAndroidRuntime()) return { enabled, sourceCropApplied: false };
  return invokeCommand("mpv_autocrop", { enabled });
}

export async function setNativeMpvSurfaceRect(rect: { x: number; y: number; width: number; height: number }) {
  if (isAndroidRuntime()) return;
  await invokeCommand("set_mpv_surface_rect", rect);
}

export async function setNativeMpvSurfaceVisible(visible: boolean) {
  if (isAndroidRuntime()) return;
  await invokeCommand("set_mpv_surface_visible", { visible });
}
