import type { MediaStream } from "../types/stream";
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
  error?: string | null;
  retryAvailable?: boolean;
  createdAt: number;
  updatedAt: number;
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
  live?: boolean;
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
