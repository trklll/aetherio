import { useCallback, useEffect, useMemo, useState } from "react";
import type { StreamQuery } from "../types/stream.ts";
import {
  createPlaybackTrackPreference,
  normalizeSemanticPlaybackTrackPreference,
  type PlaybackTrackCandidate,
  type SemanticPlaybackTrackPreference,
} from "../domain/playbackSelection.ts";
import { episodeRefKey, mediaRefFromLegacy, mediaRefKey } from "../domain/mediaIdentity.ts";
import {
  EXPERIENCE_STORAGE_CHANGED_EVENT,
  registerExperienceStorageKey,
  readExperienceJSON,
  writeExperienceJSON,
} from "../domain/experienceStorage.ts";
import { storageFailure, type StorageResult } from "../domain/storageResult.ts";
import {
  captureExperienceScope,
  EXPERIENCE_SCOPE_CHANGED_EVENT,
  subscribeExperienceScope,
} from "../utils/localProfiles.ts";

export const PLAYBACK_SELECTIONS_STORAGE_KEY = "aetherio-title-playback-selections-v1";
export const PLAYBACK_SELECTION_CHANGED_EVENT = "aetherio-playback-selection-changed";
registerExperienceStorageKey(PLAYBACK_SELECTIONS_STORAGE_KEY);

export interface StoredPlaybackSelection {
  audio?: SemanticPlaybackTrackPreference;
  subtitle?: SemanticPlaybackTrackPreference;
  updatedAt: number;
}

interface PlaybackSelectionStore {
  version: 1;
  deliveries: Record<string, StoredPlaybackSelection>;
  episodes: Record<string, StoredPlaybackSelection>;
}

export interface PlaybackSelectionSnapshot {
  delivery: StoredPlaybackSelection | null;
  episode: StoredPlaybackSelection | null;
}

export interface UsePlaybackSelectionResult extends PlaybackSelectionSnapshot {
  saveAudioPreference: (candidate: PlaybackTrackCandidate) => StorageResult;
  saveSubtitlePreference: (candidate: PlaybackTrackCandidate | null) => StorageResult;
}

const EMPTY_STORE: PlaybackSelectionStore = { version: 1, deliveries: {}, episodes: {} };
const EMPTY_SELECTION: PlaybackSelectionSnapshot = { delivery: null, episode: null };

export function readPlaybackSelection(query: StreamQuery | null | undefined): PlaybackSelectionSnapshot {
  try {
    const keys = getSelectionKeys(query);
    if (!keys) return EMPTY_SELECTION;
    const scope = captureExperienceScope();
    const result = readExperienceJSON<PlaybackSelectionStore>(scope, PLAYBACK_SELECTIONS_STORAGE_KEY, isPlaybackSelectionStore);
    if (!result.ok || !result.value) return EMPTY_SELECTION;
    return {
      delivery: result.value.deliveries[keys.deliveryKey] ?? null,
      episode: keys.episodeKey ? result.value.episodes[keys.episodeKey] ?? null : null,
    };
  } catch {
    return EMPTY_SELECTION;
  }
}

export function savePlaybackSelection(
  query: StreamQuery | null | undefined,
  patch: { audio?: SemanticPlaybackTrackPreference; subtitle?: SemanticPlaybackTrackPreference },
): StorageResult {
  let keys: ReturnType<typeof getSelectionKeys>;
  try {
    keys = getSelectionKeys(query);
  } catch {
    return storageFailure("invalid-identity");
  }
  if (!keys) return storageFailure("invalid-identity");

  const audio = patch.audio === undefined
    ? undefined
    : normalizeSemanticPlaybackTrackPreference(patch.audio, "audio");
  const subtitle = patch.subtitle === undefined
    ? undefined
    : normalizeSemanticPlaybackTrackPreference(patch.subtitle, "subtitle");
  if ((patch.audio !== undefined && !audio) || (patch.subtitle !== undefined && !subtitle)) {
    return storageFailure("invalid-data");
  }

  const scope = captureExperienceScope();
  const read = readExperienceJSON<PlaybackSelectionStore>(scope, PLAYBACK_SELECTIONS_STORAGE_KEY, isPlaybackSelectionStore);
  if (!read.ok) return storageFailure(read.code);
  const current = read.value ?? EMPTY_STORE;
  const updatedAt = Date.now();
  const next: PlaybackSelectionStore = {
    version: 1,
    deliveries: {
      ...current.deliveries,
      [keys.deliveryKey]: mergeSelection(current.deliveries[keys.deliveryKey], { audio: audio ?? undefined, subtitle: subtitle ?? undefined }, updatedAt),
    },
    episodes: keys.episodeKey
      ? {
        ...current.episodes,
        [keys.episodeKey]: mergeSelection(current.episodes[keys.episodeKey], { audio: audio ?? undefined, subtitle: subtitle ?? undefined }, updatedAt),
      }
      : current.episodes,
  };
  return writeExperienceJSON(scope, PLAYBACK_SELECTIONS_STORAGE_KEY, next, [PLAYBACK_SELECTION_CHANGED_EVENT]);
}

export function usePlaybackSelection(query: StreamQuery | null | undefined): UsePlaybackSelectionResult {
  const identityKey = useMemo(() => selectionIdentityKey(query), [query?.type, query?.id, query?.season, query?.episode]);
  const [snapshot, setSnapshot] = useState(() => ({ identityKey, value: readPlaybackSelection(query) }));
  const value = snapshot.identityKey === identityKey ? snapshot.value : readPlaybackSelection(query);

  useEffect(() => {
    const refresh = () => setSnapshot({ identityKey, value: readPlaybackSelection(query) });
    window.addEventListener(PLAYBACK_SELECTION_CHANGED_EVENT, refresh);
    window.addEventListener(EXPERIENCE_STORAGE_CHANGED_EVENT, refresh);
    window.addEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const unsubscribe = subscribeExperienceScope(refresh);
    refresh();
    return () => {
      window.removeEventListener(PLAYBACK_SELECTION_CHANGED_EVENT, refresh);
      window.removeEventListener(EXPERIENCE_STORAGE_CHANGED_EVENT, refresh);
      window.removeEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      unsubscribe();
    };
  }, [identityKey, query]);

  const saveAudioPreference = useCallback((candidate: PlaybackTrackCandidate) => {
    const preference = createPlaybackTrackPreference(candidate);
    return preference ? savePlaybackSelection(query, { audio: preference }) : storageFailure("not-written");
  }, [query]);

  const saveSubtitlePreference = useCallback((candidate: PlaybackTrackCandidate | null) => {
    const preference = candidate
      ? createPlaybackTrackPreference(candidate)
      : { language: "", title: "", forced: false, sdh: false, subtitleMode: "off" as const };
    return preference ? savePlaybackSelection(query, { subtitle: preference }) : storageFailure("not-written");
  }, [query]);

  return {
    delivery: value.delivery,
    episode: value.episode,
    saveAudioPreference,
    saveSubtitlePreference,
  };
}

function getSelectionKeys(query: StreamQuery | null | undefined) {
  if (!query) return null;
  const media = mediaRefFromLegacy({ type: query.type, id: query.id });
  const deliveryKey = mediaRefKey(media);
  const hasEpisode = Number.isInteger(query.season) && Number(query.season) >= 0
    && Number.isInteger(query.episode) && Number(query.episode) >= 0;
  return {
    deliveryKey,
    episodeKey: hasEpisode ? episodeRefKey({ media, season: query.season, episode: query.episode }) : null,
  };
}

function selectionIdentityKey(query: StreamQuery | null | undefined): string {
  try {
    const keys = getSelectionKeys(query);
    return keys ? JSON.stringify([keys.deliveryKey, keys.episodeKey]) : "";
  } catch {
    return "";
  }
}

function mergeSelection(
  previous: StoredPlaybackSelection | undefined,
  patch: { audio?: SemanticPlaybackTrackPreference; subtitle?: SemanticPlaybackTrackPreference },
  updatedAt: number,
): StoredPlaybackSelection {
  return {
    ...(previous ?? { updatedAt }),
    ...(patch.audio ? { audio: patch.audio } : {}),
    ...(patch.subtitle ? { subtitle: patch.subtitle } : {}),
    updatedAt,
  };
}

function isPlaybackSelectionStore(value: unknown): value is PlaybackSelectionStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const store = value as Record<string, unknown>;
  return store.version === 1
    && isSelectionRecordMap(store.deliveries)
    && isSelectionRecordMap(store.episodes);
}

function isSelectionRecordMap(value: unknown): value is Record<string, StoredPlaybackSelection> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(([key, raw]) => {
    if (!key || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const entry = raw as Record<string, unknown>;
    if (!Number.isFinite(entry.updatedAt) || Number(entry.updatedAt) < 0) return false;
    const audio = entry.audio === undefined || normalizeSemanticPlaybackTrackPreference(entry.audio, "audio") !== null;
    const subtitle = entry.subtitle === undefined || normalizeSemanticPlaybackTrackPreference(entry.subtitle, "subtitle") !== null;
    return audio && subtitle && (entry.audio !== undefined || entry.subtitle !== undefined);
  });
}
