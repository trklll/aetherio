import type { MediaStream } from "../types/stream";
import type { SubtitleSource } from "../types/subtitle";
import { getDownloadsEnabled } from "../config/downloadPreferences";
import { invokeCommand, isTauriRuntime, listenPlatformEvent } from "../runtime/platform";

export interface DownloadRecord {
  id: string;
  title: string;
  mediaType?: string | null;
  mediaId?: string | null;
  episodeTitle?: string | null;
  episodeStill?: string | null;
  poster?: string | null;
  background?: string | null;
  status: "queued" | "downloading" | "completed" | "failed" | "cancelled" | "interrupted";
  bytesDownloaded: number;
  totalBytes?: number | null;
  segmentsDownloaded?: number | null;
  totalSegments?: number | null;
  filePath?: string | null;
  subtitlePaths?: string[];
  error?: string | null;
  retryAvailable?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DownloadSubtitleRequest {
  url: string;
  lang: string;
  label: string;
  format?: string;
}

export interface DownloadStartRequest {
  target: string;
  fileIdx?: number;
  headers?: Record<string, string>;
  title: string;
  mediaType?: string;
  mediaId?: string;
  episodeTitle?: string;
  episodeStill?: string;
  poster?: string;
  background?: string;
  subtitles?: DownloadSubtitleRequest[];
  live?: boolean;
}

export function getOpenSubtitlesForDownload(sources: SubtitleSource[]): DownloadSubtitleRequest[] {
  const seen = new Set<string>();
  return sources.flatMap(source => {
    const provider = `${source.addonId} ${source.addonName}`.toLowerCase();
    if (!provider.includes("opensubtitles")) return [];
    try {
      const url = new URL(source.url);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || seen.has(url.href)) return [];
      seen.add(url.href);
      return [{ url: url.href, lang: source.lang, label: source.label, format: source.format }];
    } catch {
      return [];
    }
  }).slice(0, 20);
}

export type DownloadEvent = DownloadRecord | { id: string; deleted: true };

function assertDesktop() {
  if (!isTauriRuntime()) throw new Error("Las descargas están disponibles en la app de escritorio.");
}

function assertDownloadsEnabled() {
  if (!getDownloadsEnabled()) throw new Error("Las descargas están desactivadas en Ajustes.");
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  assertDesktop();
  return invokeCommand<DownloadRecord[]>("download_list");
}

export async function startDownload(request: DownloadStartRequest): Promise<DownloadRecord> {
  assertDownloadsEnabled();
  assertDesktop();
  return invokeCommand<DownloadRecord>("download_start", { request });
}

export async function cancelDownload(id: string): Promise<void> {
  assertDesktop();
  await invokeCommand("download_cancel", { id });
}

export async function retryDownload(id: string): Promise<DownloadRecord> {
  assertDownloadsEnabled();
  assertDesktop();
  return invokeCommand<DownloadRecord>("download_retry", { id });
}

export async function deleteDownload(id: string): Promise<void> {
  assertDesktop();
  await invokeCommand("download_delete", { id });
}

export async function openDownloadFolder(id: string): Promise<void> {
  assertDesktop();
  await invokeCommand("download_open_folder", { id });
}

export function subscribeToDownloads(handler: (event: DownloadEvent) => void) {
  return listenPlatformEvent<DownloadEvent>("download-progress", event => handler(event.payload));
}

export function createDownloadRequest(
  stream: MediaStream,
  metadata: Omit<DownloadStartRequest, "target" | "headers" | "live">,
  target: string,
  headers?: Record<string, string>,
): DownloadStartRequest {
  return {
    ...metadata,
    target,
    fileIdx: stream.fileIdx,
    headers,
    live: stream.behaviorHints?.live === true,
  };
}
