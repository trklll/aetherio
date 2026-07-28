import { authenticatedRequest, getAccountToken } from "../auth/authClient";
import {
  CONTINUE_WATCHING_EVENT,
  readWatchedHistoryEntries,
  type ContinueWatchingEntry,
} from "../utils/continueWatching";
import { getScopedStorageKey } from "../utils/localProfiles";

export type AniListAnimeStatus = "watching" | "completed" | "on_hold" | "dropped" | "plan_to_watch";

export interface AniListLibraryEntry {
  aniListId: number;
  mediaId: string;
  title: string;
  originalTitle: string;
  status: AniListAnimeStatus;
  score: number;
  watchedEpisodes: number;
  totalEpisodes: number;
  poster?: string;
  year?: number;
  updatedAt?: string | null;
}

interface AniListApiEntry extends Omit<AniListLibraryEntry, "mediaId"> {}

const ANILIST_LIBRARY_KEY = "aetherio-anilist-library-v1";
const ANILIST_SYNCED_PROGRESS_KEY = "aetherio-anilist-progress-sync-v1";
export const ANILIST_LIBRARY_CHANGED_EVENT = "aetherio-anilist-library-changed";

let progressSyncTimer: number | null = null;
let initialized = false;

export function readAniListLibrary(): AniListLibraryEntry[] {
  try {
    const raw = localStorage.getItem(getScopedStorageKey(ANILIST_LIBRARY_KEY));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is AniListLibraryEntry => (
          Number.isInteger(entry?.aniListId)
          && typeof entry?.mediaId === "string"
          && typeof entry?.title === "string"
          && typeof entry?.status === "string"
        ))
      : [];
  } catch {
    return [];
  }
}

export async function syncAniListLibrary() {
  const response = await authenticatedRequest<{ entries: AniListApiEntry[]; syncedAt: number }>(
    "/api/integrations/anilist/anime",
  );
  const entries: AniListLibraryEntry[] = response.entries.map(entry => ({
    ...entry,
    mediaId: `anilist:${entry.aniListId}`,
  }));
  localStorage.setItem(getScopedStorageKey(ANILIST_LIBRARY_KEY), JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(ANILIST_LIBRARY_CHANGED_EVENT, {
    detail: { count: entries.length, syncedAt: response.syncedAt },
  }));
  return entries;
}

export async function updateAniListProgress(
  aniListId: number,
  input: { status?: AniListAnimeStatus; watchedEpisodes?: number; score?: number },
) {
  return authenticatedRequest(`/api/integrations/anilist/anime/${aniListId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function initializeAniListProgressSync() {
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
  const library = readAniListLibrary();
  if (!library.length) return;
  const syncState = readProgressSyncState();
  const completedEntries = readWatchedHistoryEntries()
    .filter(entry => entry.completed)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  for (const entry of completedEntries) {
    if (syncState[entry.key] === entry.updatedAt) continue;
    const match = findAniListEntry(library, entry);
    if (!match) continue;
    const watchedEpisodes = Math.max(match.watchedEpisodes, entry.episode ?? (entry.type === "movie" ? 1 : 0));
    if (watchedEpisodes <= 0) continue;
    const status: AniListAnimeStatus = match.totalEpisodes > 0 && watchedEpisodes >= match.totalEpisodes
      ? "completed"
      : "watching";
    try {
      await updateAniListProgress(match.aniListId, { status, watchedEpisodes });
      match.watchedEpisodes = watchedEpisodes;
      match.status = status;
      syncState[entry.key] = entry.updatedAt;
    } catch {
      break;
    }
  }
  localStorage.setItem(getScopedStorageKey(ANILIST_LIBRARY_KEY), JSON.stringify(library));
  localStorage.setItem(getScopedStorageKey(ANILIST_SYNCED_PROGRESS_KEY), JSON.stringify(syncState));
  window.dispatchEvent(new CustomEvent(ANILIST_LIBRARY_CHANGED_EVENT));
}

function findAniListEntry(library: AniListLibraryEntry[], playback: ContinueWatchingEntry) {
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
    const raw = localStorage.getItem(getScopedStorageKey(ANILIST_SYNCED_PROGRESS_KEY));
    return raw ? JSON.parse(raw) as Record<string, number> : {};
  } catch {
    return {};
  }
}
