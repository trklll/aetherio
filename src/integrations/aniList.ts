import { getAccountToken, getAniListAccessToken } from "../auth/authClient";
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
  const token = requireAniListToken();
  const viewer = await aniListGraphql<{
    Viewer?: { id?: number };
  }>(token, "query { Viewer { id } }");
  if (!viewer.Viewer?.id) throw new Error("AniList no devolvió el usuario conectado.");
  const collection = await aniListGraphql<{
    MediaListCollection?: {
      lists?: Array<{
        entries?: Array<{
          mediaId?: number;
          status?: string;
          score?: number;
          progress?: number;
          updatedAt?: number;
          media?: {
            id?: number;
            title?: { userPreferred?: string; romaji?: string; english?: string };
            episodes?: number;
            coverImage?: { extraLarge?: string; large?: string };
            startDate?: { year?: number };
          };
        }>;
      }>;
    };
  }>(
    token,
    `query AetherioAnimeList($userId: Int!) {
      MediaListCollection(userId: $userId, type: ANIME) {
        lists {
          entries {
            mediaId
            status
            score(format: POINT_10)
            progress
            updatedAt
            media {
              id
              title { userPreferred romaji english }
              episodes
              coverImage { extraLarge large }
              startDate { year }
            }
          }
        }
      }
    }`,
    { userId: viewer.Viewer.id },
  );
  const entries: AniListLibraryEntry[] = (collection.MediaListCollection?.lists ?? []).flatMap(list =>
    (list.entries ?? []).flatMap(entry => {
      const media = entry.media;
      const aniListId = media?.id ?? entry.mediaId;
      const status = fromAniListStatus(entry.status);
      const title = media?.title?.userPreferred || media?.title?.english || media?.title?.romaji;
      if (!aniListId || !status || !title) return [];
      return [{
        aniListId,
        mediaId: `anilist:${aniListId}`,
        title,
        originalTitle: media?.title?.romaji || title,
        status,
        score: entry.score ?? 0,
        watchedEpisodes: entry.progress ?? 0,
        totalEpisodes: media?.episodes ?? 0,
        poster: media?.coverImage?.extraLarge ?? media?.coverImage?.large,
        year: media?.startDate?.year,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt * 1000).toISOString() : null,
      }];
    }),
  );
  const syncedAt = Date.now();
  localStorage.setItem(getScopedStorageKey(ANILIST_LIBRARY_KEY), JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent(ANILIST_LIBRARY_CHANGED_EVENT, {
    detail: { count: entries.length, syncedAt },
  }));
  return entries;
}

export async function updateAniListProgress(
  aniListId: number,
  input: { status?: AniListAnimeStatus; watchedEpisodes?: number; score?: number },
) {
  const variables: Record<string, unknown> = { mediaId: aniListId };
  if (input.status) variables.status = toAniListStatus(input.status);
  if (input.watchedEpisodes != null) variables.progress = input.watchedEpisodes;
  if (input.score != null) variables.score = input.score;
  return aniListGraphql(
    requireAniListToken(),
    `mutation AetherioUpdateAnime(
      $mediaId: Int!,
      $status: MediaListStatus,
      $progress: Int,
      $score: Float
    ) {
      SaveMediaListEntry(
        mediaId: $mediaId,
        status: $status,
        progress: $progress,
        score: $score
      ) {
        id
        status
        progress
        score(format: POINT_10)
      }
    }`,
    variables,
  );
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

function requireAniListToken() {
  const token = getAniListAccessToken();
  if (!token) throw new Error("Conecta AniList para sincronizar tu biblioteca.");
  return token;
}

async function aniListGraphql<T>(
  accessToken: string,
  query: string,
  variables: Record<string, unknown> = {},
) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (!response.ok || payload.errors?.length || !payload.data) {
    throw new Error(payload.errors?.[0]?.message || `AniList respondió con ${response.status}.`);
  }
  return payload.data;
}

function fromAniListStatus(status?: string): AniListAnimeStatus | null {
  const statuses: Record<string, AniListAnimeStatus> = {
    CURRENT: "watching",
    REPEATING: "watching",
    COMPLETED: "completed",
    PAUSED: "on_hold",
    DROPPED: "dropped",
    PLANNING: "plan_to_watch",
  };
  return status ? statuses[status] ?? null : null;
}

function toAniListStatus(status: AniListAnimeStatus) {
  const statuses: Record<AniListAnimeStatus, string> = {
    watching: "CURRENT",
    completed: "COMPLETED",
    on_hold: "PAUSED",
    dropped: "DROPPED",
    plan_to_watch: "PLANNING",
  };
  return statuses[status];
}
