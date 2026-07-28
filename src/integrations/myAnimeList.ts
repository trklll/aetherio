import { authenticatedRequest, getAccountToken } from "../auth/authClient";
import { resolveMalToTmdb } from "../services/LibraryService";
import type { MediaItem } from "../types/ui";
import {
  CONTINUE_WATCHING_EVENT,
  readWatchedHistoryEntries,
  type ContinueWatchingEntry,
} from "../utils/continueWatching";
import { getScopedStorageKey } from "../utils/localProfiles";

export type MalAnimeStatus = "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";

export interface MalLibraryEntry {
  malId: number;
  mediaId: string;
  title: string;
  originalTitle: string;
  status: MalAnimeStatus;
  score: number;
  watchedEpisodes: number;
  totalEpisodes: number;
  poster?: string;
  year?: number;
  updatedAt?: string | null;
}

interface MalApiEntry extends Omit<MalLibraryEntry, "mediaId"> {}

const MAL_LIBRARY_KEY = "aetherio-mal-library-v1";
const MAL_SYNCED_PROGRESS_KEY = "aetherio-mal-progress-sync-v1";
export const MAL_LIBRARY_CHANGED_EVENT = "aetherio-mal-library-changed";

let progressSyncTimer: number | null = null;
let initialized = false;

export function readMalLibrary(): MalLibraryEntry[] {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(MAL_LIBRARY_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is MalLibraryEntry => (
          Number.isInteger(entry?.malId)
          && typeof entry?.mediaId === "string"
          && typeof entry?.title === "string"
          && typeof entry?.status === "string"
        ))
      : [];
  } catch {
    return [];
  }
}

export async function syncMyAnimeListLibrary() {
  const response = await authenticatedRequest<{ entries: MalApiEntry[]; syncedAt: number }>(
    "/api/integrations/mal/anime",
  );
  const rawEntries = response.entries;
  const mediaItems = rawEntries.map(entry => ({
    id: `mal:${entry.malId}`,
    type: "anime",
    name: entry.title,
    poster: entry.poster,
    year: entry.year,
    _malId: entry.malId,
  })) as Array<MediaItem & { _malId: number }>;
  const resolved = await resolveMalToTmdb(mediaItems);
  const resolvedByMalId = new Map<number, string>();
  for (const item of resolved) {
    const malId = Number((item as MediaItem & { _malId?: number })._malId);
    if (Number.isInteger(malId)) resolvedByMalId.set(malId, item.id);
  }
  const entries: MalLibraryEntry[] = rawEntries.map(entry => ({
    ...entry,
    mediaId: resolvedByMalId.get(entry.malId) ?? `mal:${entry.malId}`,
  }));
  localStorage.setItem(getScopedStorageKey(MAL_LIBRARY_KEY), JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(MAL_LIBRARY_CHANGED_EVENT, {
    detail: { count: entries.length, syncedAt: response.syncedAt },
  }));
  return entries;
}

export async function updateMyAnimeListProgress(
  malId: number,
  input: { status?: MalAnimeStatus; watchedEpisodes?: number; score?: number },
) {
  return authenticatedRequest(`/api/integrations/mal/anime/${malId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function initializeMyAnimeListProgressSync() {
  if (initialized) return () => undefined;
  initialized = true;
  const schedule = () => {
    if (!getAccountToken()) return;
    if (progressSyncTimer !== null) window.clearTimeout(progressSyncTimer);
    progressSyncTimer = window.setTimeout(() => {
      progressSyncTimer = null;
      void syncLatestCompletedEpisodes();
    }, 1_200);
  };
  window.addEventListener(CONTINUE_WATCHING_EVENT, schedule as EventListener);
  return () => {
    window.removeEventListener(CONTINUE_WATCHING_EVENT, schedule as EventListener);
    if (progressSyncTimer !== null) window.clearTimeout(progressSyncTimer);
    progressSyncTimer = null;
    initialized = false;
  };
}

async function syncLatestCompletedEpisodes() {
  const library = readMalLibrary();
  if (!library.length) return;
  const syncState = readProgressSyncState();
  const completedEntries = readWatchedHistoryEntries()
    .filter(entry => entry.completed)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  for (const entry of completedEntries) {
    if (syncState[entry.key] === entry.updatedAt) continue;
    const match = findMalEntry(library, entry);
    if (!match) continue;
    const watchedEpisodes = Math.max(match.watchedEpisodes, entry.episode ?? (entry.type === "movie" ? 1 : 0));
    if (watchedEpisodes <= 0) continue;
    const status: MalAnimeStatus = match.totalEpisodes > 0 && watchedEpisodes >= match.totalEpisodes
      ? "completed"
      : "watching";
    try {
      await updateMyAnimeListProgress(match.malId, { status, watchedEpisodes });
      match.watchedEpisodes = watchedEpisodes;
      match.status = status;
      syncState[entry.key] = entry.updatedAt;
    } catch {
      break;
    }
  }
  localStorage.setItem(getScopedStorageKey(MAL_LIBRARY_KEY), JSON.stringify(library));
  localStorage.setItem(getScopedStorageKey(MAL_SYNCED_PROGRESS_KEY), JSON.stringify(syncState));
  window.dispatchEvent(new CustomEvent(MAL_LIBRARY_CHANGED_EVENT));
}

function findMalEntry(library: MalLibraryEntry[], playback: ContinueWatchingEntry) {
  const exact = library.filter(entry => entry.mediaId === playback.id);
  if (exact.length === 1) return exact[0];
  const normalizedPlayback = normalizeTitle(playback.name);
  return exact.find(entry => normalizeTitle(entry.title) === normalizedPlayback)
    ?? library.find(entry => normalizeTitle(entry.title) === normalizedPlayback)
    ?? null;
}

function normalizeTitle(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(season|part|cour)\s*\d+\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readProgressSyncState() {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(MAL_SYNCED_PROGRESS_KEY));
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch {
    return {};
  }
}
