import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { MpvLaunchResult, MpvStatusSnapshot } from "../pages/Player/types.ts";
import { installSpatialNavigation } from "../navigation/spatialNav.ts";

export type RuntimeKind = "desktop" | "web";

export interface PlaybackOpenRequest {
  target: string;
  subtitle?: string;
  headers?: Record<string, string>;
  fileIdx?: number;
  episode?: number;
  startTime?: number;
  privateTorrent?: boolean;
  providerSessionKey?: string;
  audioPassthrough?: boolean;
  /**
   * Reproduccion en directo. El backend reduce el buffer del demuxer: en un
   * stream en vivo, el buffer de VOD ES la latencia que ve el usuario.
   */
  live?: boolean;
}

export interface PlaybackCapabilities {
  mpvBundled: boolean;
  backend?: string;
  formats?: string[];
}

export interface MpvVideoEnhancementResult {
  profile: string;
  kind: string;
  verified: boolean;
  requestedShaders: string[];
  activeShaders: string;
  requestedVideoFilter: string;
  activeVideoFilter: string;
  activeScale: string;
  activeDeband: string;
}

export interface NativeVideoLightness {
  average: number;
  brightPixelRatio: number;
}

export function isTauriRuntime() {
  if (typeof window === "undefined") return false;
  const tauriWindow = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  return Boolean(tauriWindow.__TAURI_INTERNALS__ || tauriWindow.__TAURI__);
}

export function getRuntimeKind(): RuntimeKind {
  if (isTauriRuntime()) return "desktop";
  return "web";
}

export function installRuntimeDocumentClasses() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;

  const apply = () => {
    const root = document.documentElement;
    root.dataset.aetherioRuntime = getRuntimeKind();
  };

  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };
  document.addEventListener("contextmenu", onContextMenu, { capture: true });
  return () => {
    window.removeEventListener("resize", apply);
    window.removeEventListener("orientationchange", apply);
    document.removeEventListener("contextmenu", onContextMenu, { capture: true } as AddEventListenerOptions);
  };
}

export function isBigPictureMode() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("aetherio-big-picture");
}

export function isSpatialNavMode() {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("aetherio-big-picture")
    || document.documentElement.classList.contains("aetherio-profile-selection");
}

/**
 * Navegación con mando/teclado en modo espacial (big-picture).
 * Delega en el motor espacial 2D (src/navigation/spatialNav.ts), port del
 * foco direccional de Compose TV: vecino más cercano en la dirección, sin
 * wrap en los bordes. El antiguo ciclado lineal en orden DOM no existe en
 * el nativo y se eliminó.
 */
export function installSpatialRemoteNavigation() {
  return installSpatialNavigation();
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

export async function takePendingOpenFiles() {
  if (!isTauriRuntime()) return [] as string[];
  return invokeCommand<string[]>("take_pending_open_files");
}

export async function listenOpenFiles(handler: (paths: string[]) => void) {
  if (!isTauriRuntime()) return () => undefined;
  return listenPlatformEvent<string[]>("aetherio-open-files", event => handler(event.payload));
}

/**
 * Despertar con mando desde el hilo nativo (fase 3, aún sin implementar en Rust).
 * Hoy lo emite el botón Start del hook web; cuando el watcher XInput exista
 * emitirá este mismo evento Tauri y el frontend ya sabrá reaccionar.
 */
export async function listenGamepadWake(handler: () => void) {
  if (!isTauriRuntime()) return () => undefined;
  try {
    return await listenPlatformEvent("aetherio-gamepad-wake", () => handler());
  } catch {
    return () => undefined;
  }
}

export async function listenWindowFileDrops(handler: (paths: string[]) => void) {
  if (!isTauriRuntime()) return () => undefined;
  return getCurrentWindow().onDragDropEvent(event => {
    if (event.payload.type === "drop") handler(event.payload.paths);
  });
}

export async function openExternalUrl(url: string) {
  if (!isSafeExternalUrl(url)) return;
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

/**
 * Solo https, mas http en localhost/loopback para desarrollo. Rechaza
 * file:, data:, javascript:, magnet: y cualquier otro esquema antes de
 * llegar al plugin opener o al fallback del navegador.
 */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol === "http:") {
      const host = parsed.hostname.toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
    }
  } catch {
    // URL invalida.
  }
  return false;
}

export async function isWindowFullscreen() {
  if (!isTauriRuntime()) return false;
  try {
    return await getCurrentWindow().isFullscreen();
  } catch {
    return false;
  }
}

export async function toggleWindowFullscreen() {
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
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().minimize();
  } catch {
    // Desktop chrome controls are best-effort.
  }
}

export async function maximizeWindow() {
  if (!isTauriRuntime()) return;
  try {
    await invokeCommand("toggle_window_maximize");
    return;
  } catch {
    // Fall back to the JS window API when the native command is unavailable.
  }
  try {
    const win = getCurrentWindow();
    if (!(await win.isMaximized())) await win.maximize();
  } catch {
    // Best-effort.
  }
}

/** Trae la ventana al frente: show + unminimize + focus. Clave para el despertar con mando. */
export async function showAndFocusWindow() {
  if (!isTauriRuntime()) return;
  try {
    const win = getCurrentWindow();
    await win.show().catch(() => undefined);
    if (await win.isMinimized().catch(() => false)) {
      await win.unminimize().catch(() => undefined);
    }
    await win.setFocus().catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

/** Entrar en Big Picture estilo Steam: pantalla completa exclusiva. */
export async function enterBigPictureWindow() {
  if (!isTauriRuntime()) {
    // Web: fullscreen del navegador (exige gesto del usuario; si el
    // navegador lo rechaza se ignora y la clase CSS hace el resto).
    try {
      if (typeof document !== "undefined" && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen().catch(() => undefined);
      }
    } catch {
      // Best-effort.
    }
    return;
  }
  await showAndFocusWindow();
  try {
    const win = getCurrentWindow();
    if (!(await win.isMaximized().catch(() => true))) {
      await maximizeWindow();
    }
    if (!(await win.isFullscreen().catch(() => true))) {
      await toggleWindowFullscreen();
    }
  } catch {
    // Best-effort.
  }
}

/** Salir de Big Picture: devuelve la ventana a modo ventana (simetría Steam). */
export async function exitBigPictureWindow() {
  if (!isTauriRuntime()) {
    try {
      if (typeof document !== "undefined" && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined);
      }
    } catch {
      // Best-effort.
    }
    return;
  }
  try {
    const win = getCurrentWindow();
    if (await win.isFullscreen().catch(() => false)) {
      try {
        await invokeCommand("toggle_window_fullscreen");
      } catch {
        await win.setFullscreen(false).catch(() => undefined);
      }
    }
  } catch {
    // Best-effort.
  }
}

export function setBigPictureActive(active: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("aetherio-big-picture", active);
  const title = active ? "Modo inmersivo de Aetherio" : "Aetherio";
  document.title = title;
  if (isTauriRuntime()) {
    getCurrentWindow().setTitle(title).catch(() => undefined);
  }
}

export async function closeWindow() {
  if (!isTauriRuntime()) return;
  try {
    await getCurrentWindow().close();
  } catch {
    // Desktop chrome controls are best-effort.
  }
}

export async function getPlaybackCapabilities(): Promise<PlaybackCapabilities> {
  return invokeCommand<PlaybackCapabilities>("playback_capabilities");
}

export async function openNativePlayback(request: PlaybackOpenRequest): Promise<MpvLaunchResult> {
  return invokeCommand<MpvLaunchResult>("open_mpv", {
    target: request.target,
    subtitle: request.subtitle,
    headers: request.headers,
    fileIdx: request.fileIdx,
    episode: request.episode,
    startTime: request.startTime,
    privateTorrent: request.privateTorrent,
    providerSessionKey: request.providerSessionKey,
    audioPassthrough: request.audioPassthrough,
    live: request.live,
  });
}

/**
 * Salta al borde del directo. No existe como comando mpv generico porque el
 * "final" de un stream en vivo lo fija el demuxer segun el manifiesto, no la
 * duracion conocida del archivo.
 */
export async function seekNativePlaybackToLive() {
  await invokeCommand("mpv_seek_live");
}

export async function stopNativePlayback() {
  try {
    await invokeCommand("stop_mpv");
  } catch {
    // Stopping playback is intentionally best-effort during navigation cleanup.
  }
}

export async function getNativePlaybackStatus(): Promise<MpvStatusSnapshot> {
  return invokeCommand<MpvStatusSnapshot>("mpv_status");
}

export async function sendNativePlaybackCommand(command: unknown[]) {
  if (command[0] === "set_property") {
    const name = command[1];
    if (typeof name !== "string") throw new Error("Propiedad MPV invalida.");
    await invokeCommand("mpv_set_property", { name, value: command[2] ?? null });
    return;
  }

  await invokeCommand("mpv_command", { command });
}

export async function setNativeAutocrop(enabled: boolean) {
  return invokeCommand("mpv_autocrop", { enabled });
}

export async function sampleNativeVideoLightness(): Promise<NativeVideoLightness | null> {
  if (!isTauriRuntime()) return null;
  return invokeCommand<NativeVideoLightness>("mpv_sample_video_lightness");
}

export async function setNativeMpvVideoProfile(profile: string) {
  if (!isTauriRuntime()) return;
  return invokeCommand<MpvVideoEnhancementResult>("set_mpv_video_profile", { profile });
}

export async function setNativeMpvSurfaceVisible(visible: boolean) {
  await invokeCommand("set_mpv_surface_visible", { visible });
}

export async function setNativeMpvControlsBlur(
  enabled: boolean,
  rect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    cornerRadius: number;
    viewportWidth: number;
    viewportHeight: number;
    episodePanel?: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      cornerRadius: number;
    };
    subtitlePanel?: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      cornerRadius: number;
    };
  },
  alpha?: {
    blurAlpha?: number;
    episodeBlurAlpha?: number;
    subtitleBlurAlpha?: number;
  },
) {
  if (!isTauriRuntime()) return;
  await invokeCommand("set_mpv_controls_blur", {
    enabled,
    left: rect?.left ?? 0,
    top: rect?.top ?? 0,
    right: rect?.right ?? 0,
    bottom: rect?.bottom ?? 0,
    cornerRadius: rect?.cornerRadius ?? 0,
    viewportWidth: rect?.viewportWidth ?? 1,
    viewportHeight: rect?.viewportHeight ?? 1,
    episodeEnabled: Boolean(rect?.episodePanel),
    episodeLeft: rect?.episodePanel?.left ?? 0,
    episodeTop: rect?.episodePanel?.top ?? 0,
    episodeRight: rect?.episodePanel?.right ?? 0,
    episodeBottom: rect?.episodePanel?.bottom ?? 0,
    episodeCornerRadius: rect?.episodePanel?.cornerRadius ?? 0,
    subtitlePanelEnabled: Boolean(rect?.subtitlePanel),
    subtitlePanelLeft: rect?.subtitlePanel?.left ?? 0,
    subtitlePanelTop: rect?.subtitlePanel?.top ?? 0,
    subtitlePanelRight: rect?.subtitlePanel?.right ?? 0,
    subtitlePanelBottom: rect?.subtitlePanel?.bottom ?? 0,
    subtitlePanelCornerRadius: rect?.subtitlePanel?.cornerRadius ?? 0,
    blurAlpha: alpha?.blurAlpha ?? (enabled ? 1 : 0),
    episodeBlurAlpha: alpha?.episodeBlurAlpha ?? (rect?.episodePanel ? 1 : 0),
    subtitleBlurAlpha: alpha?.subtitleBlurAlpha ?? (rect?.subtitlePanel ? 1 : 0),
  });
}
