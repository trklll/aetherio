import type { MediaStream, StreamQuery } from "../types/stream.ts";
import { sanitizeLogoUrl } from "./artwork";
import { captureExperienceScope, getScopedStorageKey } from "./localProfiles";
import { mediaRefFromLegacy, MediaIdentityError } from "../domain/mediaIdentity";
import { recoverExperienceJournal, writeExperienceBatch, writeExperienceJSON } from "../domain/experienceStorage";
import { storageFailure, type StorageResult } from "../domain/storageResult";
import {
  clearDeletionTombstone,
  isDeletionTombstone,
  mergeDeletionTombstones,
  readDeletionTombstones,
  recordDeletionTombstone,
  replaceDeletionTombstones,
  TOMBSTONE_MAX_ITEMS,
  type DeletionTombstone,
} from "../domain/tombstones";

export const CONTINUE_WATCHING_EVENT = "aetherio-continue-watching-updated";

const STORAGE_KEY = "aetherio-continue-watching-v1";
const WATCHED_HISTORY_STORAGE_KEY = "aetherio-watched-history-v1";
const AUDIO_SELECTION_STORAGE_KEY = "aetherio-continue-watching-audio-selection-v1";
const TOMBSTONES_KEY = "aetherio-continue-watching-tombstones-v1";
const MAX_ENTRIES = 80;
const MAX_WATCHED_HISTORY_ENTRIES = 12000;
const MIN_SAVE_SECONDS = 5;
const MIN_RESUME_SECONDS = 12;
const COMPLETE_PERCENT = 0.92;
const COMPLETE_REMAINING_SECONDS = 90;
const RECENT_RELEASE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export type ContinueWatchingEntryKind = "resume" | "next" | "new" | "new-season";

export interface ContinueWatchingEntry {
  source?: "local";
  key: string;
  mediaKey: string;
  type: string;
  id: string;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  originalPoster?: string;
  genres?: string[];
  genreIds?: number[];
  episodeStill?: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
  completed: boolean;
  entryKind?: ContinueWatchingEntryKind;
  remoteProgressPercent?: number;
  streamId?: string;
  streamName?: string;
  selectedAudio?: string;
  selectedAudioLabel?: string;
  selectedAudioLanguage?: string;
  selectedSubtitle?: string;
  selectedSubtitleLabel?: string;
  selectedSubtitleLanguage?: string;
}

export interface ContinueWatchingInput {
  query: StreamQuery;
  stream: MediaStream;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  episodeStill?: string;
  episodeName?: string;
  currentTime: number;
  duration: number;
  selectedAudio?: string;
  selectedAudioLabel?: string;
  selectedAudioLanguage?: string;
  selectedSubtitle?: string;
  selectedSubtitleLabel?: string;
  selectedSubtitleLanguage?: string;
}

export interface ContinueWatchingSelectionPatch {
  selectedAudio?: string;
  selectedAudioLabel?: string;
  selectedAudioLanguage?: string;
  selectedSubtitle?: string;
  selectedSubtitleLabel?: string;
  selectedSubtitleLanguage?: string;
}

export interface ContinueWatchingAudioSelection {
  value: string;
  label?: string;
  language?: string;
  trackLang?: string;
  trackTitle?: string;
  updatedAt: number;
}

export interface MarkEpisodeWatchedInput {
  query: StreamQuery;
  name: string;
  episodeName?: string;
  runtimeSeconds?: number;
  logo?: string;
  background?: string;
  poster?: string;
  episodeStill?: string;
}

export interface NextEpisodePromptInput {
  source?: "local";
  query: StreamQuery;
  name: string;
  episodeName?: string;
  logo?: string;
  background?: string;
  poster?: string;
  episodeStill?: string;
  runtimeSeconds?: number;
  entryKind?: Exclude<ContinueWatchingEntryKind, "resume">;
  updatedAt?: number;
}

export function buildMediaKey(type: string, id: string) {
  return `${type}:${id}`;
}

export function buildContinueWatchingKey(query: StreamQuery) {
  if (query.type === "movie") return buildMediaKey(query.type, query.id);
  return `${buildMediaKey(query.type, query.id)}:${query.season ?? 0}:${query.episode ?? 0}`;
}

export function classifyContinueWatchingEntryKind(input: {
  nextSeason: number;
  watchedSeason?: number;
  releaseAt: number;
  watchedAt: number;
  now?: number;
}): Exclude<ContinueWatchingEntryKind, "resume"> {
  const now = input.now ?? Date.now();
  const isRecentRelease = input.releaseAt > input.watchedAt
    && input.releaseAt <= now
    && now - input.releaseAt < RECENT_RELEASE_WINDOW_MS;

  if (!isRecentRelease) return "next";
  if (typeof input.watchedSeason === "number" && input.nextSeason > input.watchedSeason) {
    return "new-season";
  }
  return "new";
}

export function readContinueWatchingEntries(): ContinueWatchingEntry[] {
  try {
    recoverPlaybackJournal();
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isContinueWatchingEntry).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function readWatchedHistoryEntries(): ContinueWatchingEntry[] {
  try {
    recoverPlaybackJournal();
    const raw = localStorage.getItem(getWatchedHistoryStorageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isContinueWatchingEntry).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

let _cachedPlaybackEntries: ContinueWatchingEntry[] | null = null;

/** Limpia la caché en memoria del estado de reproducción (pensado para tests). */
export function resetPlaybackStateCacheForTests() {
  _cachedPlaybackEntries = null;
}

export function readPlaybackStateEntries(): ContinueWatchingEntry[] {
  ensurePlaybackCacheListener();
  if (_cachedPlaybackEntries) return _cachedPlaybackEntries;
  const byKey = new Map<string, ContinueWatchingEntry>();
  for (const entry of [...readWatchedHistoryEntries(), ...readContinueWatchingEntries()]) {
    const existing = byKey.get(entry.key);
    if (!existing || shouldReplaceEntry(existing, entry)) byKey.set(entry.key, entry);
  }
  _cachedPlaybackEntries = Array.from(byKey.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  return _cachedPlaybackEntries;
}

export function getContinueWatchingRows() {
  return readContinueWatchingEntries().filter(isVisibleContinueWatchingEntry);
}

function mediaDismissalKey(mediaKey: string) {
  return `media:${mediaKey}`;
}

export function isContinueWatchingEntryDismissed(key: string, mediaKey?: string) {
  return readDeletionTombstones(TOMBSTONES_KEY).some(tombstone => (
    tombstone.key === key || (mediaKey !== undefined && tombstone.key === mediaDismissalKey(mediaKey))
  ));
}

export function getLatestResumeForMedia(type: string, id: string) {
  const mediaKey = buildMediaKey(type, id);
  return readContinueWatchingEntries().find(entry => entry.mediaKey === mediaKey && isResumableEntry(entry)) ?? null;
}

export function getResumeForQuery(query: StreamQuery | null | undefined) {
  if (!query) return null;
  const entries = readContinueWatchingEntries();
  const exact = entries.find(entry => entry.key === buildContinueWatchingKey(query) && isResumableEntry(entry));
  if (exact) return exact;
  return entries.find(entry => entry.mediaKey === buildMediaKey(query.type, query.id) && isResumableEntry(entry)) ?? null;
}

export function getExactResumeForQuery(query: StreamQuery | null | undefined) {
  if (!query) return null;
  return readContinueWatchingEntries().find(entry => entry.key === buildContinueWatchingKey(query) && isResumableEntry(entry)) ?? null;
}

export function getResumeStartTime(query: StreamQuery | null | undefined) {
  const entry = getExactResumeForQuery(query);
  return entry ? entry.currentTime : 0;
}

export function updateContinueWatchingSelection(query: StreamQuery | null | undefined, patch: ContinueWatchingSelectionPatch) {
  tryUpdateContinueWatchingSelection(query, patch);
}

export function tryUpdateContinueWatchingSelection(
  query: StreamQuery | null | undefined,
  patch: ContinueWatchingSelectionPatch,
): StorageResult {
  if (!query) return storageFailure("not-written");
  try { mediaRefFromLegacy({ type: query.type, id: query.id }); }
  catch (error) { return storageFailure(error instanceof MediaIdentityError ? "invalid-identity" : "invalid-data", error); }
  const key = buildContinueWatchingKey(query);
  const entries = readContinueWatchingEntries();
  const index = entries.findIndex(entry => entry.key === key);
  if (index === -1) return storageFailure("not-written");

  const current = entries[index];
  const next: ContinueWatchingEntry = {
    ...current,
    selectedAudio: typeof patch.selectedAudio === "string" ? patch.selectedAudio : current.selectedAudio,
    selectedAudioLabel: typeof patch.selectedAudioLabel === "string" ? patch.selectedAudioLabel : current.selectedAudioLabel,
    selectedAudioLanguage: typeof patch.selectedAudioLanguage === "string" ? patch.selectedAudioLanguage : current.selectedAudioLanguage,
    selectedSubtitle: typeof patch.selectedSubtitle === "string" ? patch.selectedSubtitle : current.selectedSubtitle,
    selectedSubtitleLabel: typeof patch.selectedSubtitleLabel === "string" ? patch.selectedSubtitleLabel : current.selectedSubtitleLabel,
    selectedSubtitleLanguage: typeof patch.selectedSubtitleLanguage === "string" ? patch.selectedSubtitleLanguage : current.selectedSubtitleLanguage,
    updatedAt: Date.now(),
  };

  const updated = [next, ...entries.filter((_, entryIndex) => entryIndex !== index)].slice(0, MAX_ENTRIES);
  return writeEntries(updated);
}

export function saveContinueWatchingAudioSelection(
  query: StreamQuery | null | undefined,
  selection: Omit<ContinueWatchingAudioSelection, "updatedAt">,
) {
  if (!query) return;
  try {
    recoverPlaybackJournal();
    const cache = readAudioSelectionCache();
    cache[buildContinueWatchingKey(query)] = {
      ...selection,
      updatedAt: Date.now(),
    };
    writeExperienceJSON(captureExperienceScope(), AUDIO_SELECTION_STORAGE_KEY, cache);
  } catch {
    // Best-effort local persistence only.
  }
}

export function getContinueWatchingAudioSelection(query: StreamQuery | null | undefined) {
  if (!query) return null;
  try {
    recoverPlaybackJournal();
    const cache = readAudioSelectionCache();
    return cache[buildContinueWatchingKey(query)] ?? null;
  } catch {
    return null;
  }
}

export function saveContinueWatchingProgress(input: ContinueWatchingInput) {
  const entry = buildContinueWatchingProgress(input);
  if (!entry) return null;
  persistContinueWatchingProgress(entry);
  return entry;
}

export function trySaveContinueWatchingProgress(input: ContinueWatchingInput): StorageResult {
  let entry: ContinueWatchingEntry | null;
  try {
    mediaRefFromLegacy({ type: input.query.type, id: input.query.id });
    entry = buildContinueWatchingProgress(input);
  } catch (error) {
    return storageFailure(error instanceof MediaIdentityError ? "invalid-identity" : "invalid-data", error);
  }
  if (!entry) return storageFailure("not-written");
  return persistContinueWatchingProgress(entry);
}

function buildContinueWatchingProgress(input: ContinueWatchingInput): ContinueWatchingEntry | null {
  let currentTime = clampFinite(input.currentTime);
  let duration = clampFinite(input.duration);
  if (currentTime < MIN_SAVE_SECONDS) return null;
  if (duration > 0 && currentTime > duration) currentTime = duration * 0.99;

  const completed = isCompleted(currentTime, duration);
  const key = buildContinueWatchingKey(input.query);
  const mediaKey = buildMediaKey(input.query.type, input.query.id);
  const existing = readContinueWatchingEntries().find(item => item.key === key);
  const entry: ContinueWatchingEntry = {
    key,
    mediaKey,
    type: input.query.type,
    id: input.query.id,
    name: input.name || existing?.name || input.query.id,
    logo: sanitizeLogoUrl(input.logo) ?? existing?.logo,
    background: input.background ?? existing?.background,
    poster: input.poster ?? existing?.poster,
    episodeStill: input.episodeStill
      ?? existing?.episodeStill
      ?? (input.query.type !== "movie" ? input.background ?? existing?.background : undefined),
    season: input.query.season,
    episode: input.query.episode,
    episodeName: input.episodeName ?? existing?.episodeName,
    currentTime,
    duration,
    updatedAt: Date.now(),
    completed,
    entryKind: "resume",
    source: "local",
    streamId: input.stream.id,
    streamName: input.stream.title ?? input.stream.name,
    selectedAudio: typeof input.selectedAudio === "string" ? input.selectedAudio : undefined,
    selectedAudioLabel: typeof input.selectedAudioLabel === "string" ? input.selectedAudioLabel : undefined,
    selectedAudioLanguage: typeof input.selectedAudioLanguage === "string" ? input.selectedAudioLanguage : undefined,
    selectedSubtitle: typeof input.selectedSubtitle === "string" ? input.selectedSubtitle : undefined,
    selectedSubtitleLabel: typeof input.selectedSubtitleLabel === "string" ? input.selectedSubtitleLabel : undefined,
    selectedSubtitleLanguage: typeof input.selectedSubtitleLanguage === "string" ? input.selectedSubtitleLanguage : undefined,
  };

  return entry;
}

function persistContinueWatchingProgress(entry: ContinueWatchingEntry): StorageResult {
  const entries = readContinueWatchingEntries().filter(item => item.key !== entry.key);
  let result: StorageResult;
  if (entry.completed) {
    const nextHistory = mergeEntries(readWatchedHistoryEntries(), [entry], MAX_WATCHED_HISTORY_ENTRIES);
    result = writeExperienceBatch(captureExperienceScope(), [
      { key: STORAGE_KEY, value: JSON.stringify(entries.slice(0, MAX_ENTRIES)) },
      { key: WATCHED_HISTORY_STORAGE_KEY, value: JSON.stringify(nextHistory) },
    ], [CONTINUE_WATCHING_EVENT]);
  } else {
    result = writeEntries([entry, ...entries].slice(0, MAX_ENTRIES));
  }
  if (result.ok) {
    _cachedPlaybackEntries = null;
    // Solo reproducir de nuevo reactiva un título descartado. Ni un escaneo
    // del historial ni una actualización de arte deben deshacer el descarte.
    const tombstones = readDeletionTombstones(TOMBSTONES_KEY);
    const remaining = tombstones.filter(tombstone => (
      tombstone.key !== mediaDismissalKey(entry.mediaKey)
      && tombstone.key !== entry.mediaKey
      && !tombstone.key.startsWith(`${entry.mediaKey}:`)
    ));
    if (remaining.length !== tombstones.length) replaceDeletionTombstones(TOMBSTONES_KEY, remaining);
  }
  return result;
}

export function markEpisodeAsWatched(input: MarkEpisodeWatchedInput) {
  const key = buildContinueWatchingKey(input.query);
  const mediaKey = buildMediaKey(input.query.type, input.query.id);
  const entries = readContinueWatchingEntries();
  const existing = entries.find(entry => entry.key === key);
  const duration = Math.max(1, clampFinite(input.runtimeSeconds ?? existing?.duration ?? 0));

  const entry: ContinueWatchingEntry = {
    key,
    mediaKey,
    type: input.query.type,
    id: input.query.id,
    name: input.name || existing?.name || input.query.id,
    logo: sanitizeLogoUrl(input.logo) ?? existing?.logo,
    background: input.background ?? existing?.background,
    poster: input.poster ?? existing?.poster,
    episodeStill: input.episodeStill ?? existing?.episodeStill ?? (input.query.type !== "movie" ? input.background : undefined),
    season: input.query.season,
    episode: input.query.episode,
    episodeName: input.episodeName ?? existing?.episodeName,
    currentTime: duration,
    duration,
    updatedAt: Date.now(),
    completed: true,
    entryKind: "resume",
    source: "local",
    streamId: existing?.streamId,
    streamName: existing?.streamName,
    selectedAudio: existing?.selectedAudio,
    selectedAudioLabel: existing?.selectedAudioLabel,
    selectedAudioLanguage: existing?.selectedAudioLanguage,
    selectedSubtitle: existing?.selectedSubtitle,
    selectedSubtitleLabel: existing?.selectedSubtitleLabel,
    selectedSubtitleLanguage: existing?.selectedSubtitleLanguage,
  };

  const updated = entries.filter(item => item.key !== key).slice(0, MAX_ENTRIES);
  writeProgressAndHistory(updated, mergeEntries(readWatchedHistoryEntries(), [entry], MAX_WATCHED_HISTORY_ENTRIES));
  return entry;
}

export function saveNextEpisodePrompt(input: NextEpisodePromptInput) {
  if (input.query.type === "movie" || !input.query.season || !input.query.episode) return null;
  const key = buildContinueWatchingKey(input.query);  const mediaKey = buildMediaKey(input.query.type, input.query.id);
  if (isContinueWatchingEntryDismissed(key, mediaKey)) return null;
  const entries = readContinueWatchingEntries();
  const existing = entries.find(entry => entry.key === key);
  const duration = Math.max(1, clampFinite(input.runtimeSeconds ?? existing?.duration ?? 1));

  const entry: ContinueWatchingEntry = {
    key,
    mediaKey,
    type: input.query.type,
    id: input.query.id,
    name: input.name || existing?.name || input.query.id,
    logo: sanitizeLogoUrl(input.logo) ?? existing?.logo,
    background: input.background ?? existing?.background,
    poster: input.poster ?? existing?.poster,
    episodeStill: input.episodeStill ?? existing?.episodeStill ?? (input.query.type !== "movie" ? input.background : undefined),
    season: input.query.season,
    episode: input.query.episode,
    episodeName: input.episodeName ?? existing?.episodeName,
    currentTime: 0,
    duration,
    updatedAt: input.updatedAt ?? Date.now(),
    completed: false,
    entryKind: input.entryKind ?? "next",
    source: input.source ?? "local",
    streamId: existing?.streamId,
    streamName: existing?.streamName,
    selectedAudio: existing?.selectedAudio,
    selectedAudioLabel: existing?.selectedAudioLabel,
    selectedAudioLanguage: existing?.selectedAudioLanguage,
    selectedSubtitle: existing?.selectedSubtitle,
    selectedSubtitleLabel: existing?.selectedSubtitleLabel,
    selectedSubtitleLanguage: existing?.selectedSubtitleLanguage,
  };

  writeEntries([entry, ...entries.filter(item => item.key !== key)].slice(0, MAX_ENTRIES));
  return entry;
}

/** Quita el título completo de la fila, no su historial de episodios vistos. */
export function removeContinueWatchingMedia(type: string, id: string): StorageResult {
  const mediaKey = buildMediaKey(type, id);
  const current = readContinueWatchingEntries();
  const key = mediaDismissalKey(mediaKey);
  const deletedAt = Date.now();
  const tombstones = [
    { key, deletedAt },
    ...readDeletionTombstones(TOMBSTONES_KEY).filter(tombstone => tombstone.key !== key),
  ].slice(0, TOMBSTONE_MAX_ITEMS);
  // Publicar datos y descartes juntos: un refresco nunca debe ver el borrado
  // sin su protección frente a escaneos o sincronizaciones en curso.
  const result = writeExperienceBatch(captureExperienceScope(), [
    { key: STORAGE_KEY, value: JSON.stringify(current.filter(entry => entry.mediaKey !== mediaKey)) },
    { key: TOMBSTONES_KEY, value: JSON.stringify({ version: 1, tombstones }) },
  ], [CONTINUE_WATCHING_EVENT]);
  if (result.ok) _cachedPlaybackEntries = null;
  return result;
}

export function removeContinueWatchingEntry(key: string) {
  const current = readContinueWatchingEntries();
  const watched = readWatchedHistoryEntries();
  const removed = current.find(entry => entry.key === key) ?? watched.find(entry => entry.key === key) ?? null;
  const result = writeProgressAndHistory(
    current.filter(entry => entry.key !== key).slice(0, MAX_ENTRIES),
    watched.filter(entry => entry.key !== key),
  );
  if (result.ok) recordDeletionTombstone(TOMBSTONES_KEY, key);
  return removed;
}

export function markContinueWatchingEntryAsWatched(key: string) {
  const entries = readContinueWatchingEntries();
  const current = entries.find(entry => entry.key === key);
  if (!current) return null;
  const duration = Math.max(1, current.duration || current.currentTime || 1);
  const next: ContinueWatchingEntry = {
    ...current,
    currentTime: duration,
    duration,
    completed: true,
    entryKind: "resume",
    updatedAt: Date.now(),
    source: "local",
  };
  writeProgressAndHistory(
    entries.filter(entry => entry.key !== key).slice(0, MAX_ENTRIES),
    mergeEntries(readWatchedHistoryEntries(), [next], MAX_WATCHED_HISTORY_ENTRIES),
  );
  return next;
}

export function updateContinueWatchingEntryArtwork(
  key: string,
  artwork: Partial<Pick<ContinueWatchingEntry, "name" | "logo" | "background" | "poster" | "episodeStill" | "episodeName">>,
) {
  const entries = readContinueWatchingEntries();
  const current = entries.find(entry => entry.key === key);
  if (!current) return null;

  const next: ContinueWatchingEntry = {
    ...current,
    name: artwork.name || current.name,
    logo: sanitizeLogoUrl(artwork.logo) ?? current.logo,
    background: artwork.background ?? current.background,
    poster: artwork.poster ?? current.poster,
    episodeStill: artwork.episodeStill ?? current.episodeStill,
    episodeName: artwork.episodeName ?? current.episodeName,
  };

  if (
    next.name === current.name &&
    next.logo === current.logo &&
    next.background === current.background &&
    next.poster === current.poster &&
    next.episodeStill === current.episodeStill &&
    next.episodeName === current.episodeName
  ) {
    return current;
  }

  writeEntries([next, ...entries.filter(entry => entry.key !== key)].slice(0, MAX_ENTRIES));
  return next;
}

export function formatResumeTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function progressPercent(entry: ContinueWatchingEntry) {
  if ((!entry.duration || entry.duration <= 0) && typeof entry.remoteProgressPercent === "number") {
    return Math.min(100, Math.max(0, entry.remoteProgressPercent));
  }
  if (!entry.duration || entry.duration <= 0) return 0;
  return Math.min(100, Math.max(0, (entry.currentTime / entry.duration) * 100));
}

export function markMediaAsWatched(input: {
  type: string;
  id: string;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  originalPoster?: string;
}) {
  const entry = buildMediaWatchedEntry(input);
  persistMediaWatchedEntry(entry);
  return entry;
}

export function tryMarkMediaAsWatched(input: {
  type: string;
  id: string;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  originalPoster?: string;
}): StorageResult {
  try { mediaRefFromLegacy({ type: input.type, id: input.id }); }
  catch (error) { return storageFailure(error instanceof MediaIdentityError ? "invalid-identity" : "invalid-data", error); }
  return persistMediaWatchedEntry(buildMediaWatchedEntry(input));
}

function buildMediaWatchedEntry(input: {
  type: string;
  id: string;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  originalPoster?: string;
}) {
  const mediaKey = buildMediaKey(input.type, input.id);
  const key = `${mediaKey}:0:0`;
  const entries = readContinueWatchingEntries();
  const existing = entries.find(entry => entry.key === key);

  const entry: ContinueWatchingEntry = {
    key,
    mediaKey,
    type: input.type,
    id: input.id,
    name: input.name || existing?.name || input.id,
    logo: sanitizeLogoUrl(input.logo) ?? existing?.logo,
    background: input.background ?? existing?.background,
    poster: input.poster ?? existing?.poster,
    originalPoster: input.originalPoster ?? existing?.originalPoster,
    episodeStill: existing?.episodeStill,
    season: 0,
    episode: 0,
    episodeName: undefined,
    currentTime: 1,
    duration: 1,
    updatedAt: Date.now(),
    completed: true,
    entryKind: "resume",
    source: "local",
  };

  return entry;
}

function persistMediaWatchedEntry(entry: ContinueWatchingEntry): StorageResult {
  const current = readContinueWatchingEntries();
  return writeProgressAndHistory(
    current.filter(item => item.key !== entry.key).slice(0, MAX_ENTRIES),
    mergeEntries(readWatchedHistoryEntries(), [entry], MAX_WATCHED_HISTORY_ENTRIES),
  );
}

export function mergeContinueWatchingEntries(importedEntries: ContinueWatchingEntry[]) {
  if (!importedEntries.length) return;
  const watchedEntries = importedEntries.filter(entry => entry.completed);
  const nextHistory = watchedEntries.length
    ? mergeEntries(readWatchedHistoryEntries(), watchedEntries, MAX_WATCHED_HISTORY_ENTRIES)
    : readWatchedHistoryEntries();
  const nextProgress = mergeEntries(
    readContinueWatchingEntries().filter(entry => !entry.completed),
    importedEntries.filter(entry => !entry.completed),
    MAX_ENTRIES,
  );
  writeProgressAndHistory(nextProgress, nextHistory, watchedEntries.length > 0);
}

/** Import-only union: an existing progress/history entry is left untouched. */
export function addMissingContinueWatchingEntries(importedEntries: ContinueWatchingEntry[]) {
  if (!Array.isArray(importedEntries) || !importedEntries.length) return 0;
  const progress = readContinueWatchingEntries();
  const history = readWatchedHistoryEntries();
  const keys = new Set([...progress, ...history].map(entry => entry.key));
  const missing: ContinueWatchingEntry[] = [];
  for (const entry of importedEntries) {
    if (!entry || typeof entry.key !== "string" || keys.has(entry.key)) continue;
    keys.add(entry.key);
    missing.push(entry);
  }
  if (!missing.length) return 0;
  const completed = missing.filter(entry => entry.completed);
  const incomplete = missing.filter(entry => !entry.completed);
  const result = writeProgressAndHistory(
    [...incomplete, ...progress],
    [...completed, ...history],
    completed.length > 0,
  );
  if (!result.ok) throw new Error("No se pudo guardar el historial importado.");
  for (const entry of missing) clearDeletionTombstone(TOMBSTONES_KEY, entry.key);
  return missing.length;
}

export interface RemotePlaybackState {
  progress?: ContinueWatchingEntry[];
  history?: ContinueWatchingEntry[];
}

/**
 * Fusiona el estado de reproducción remoto (respaldo de Google Drive) con el
 * local: última escritura gana por entrada (`updatedAt`). Un progreso —local o
 * remoto— se descarta si el historial fusionado marca esa entrada como
 * completada en un momento igual o posterior (se vio en otro dispositivo).
 */
export function mergeRemotePlaybackState(remote: RemotePlaybackState) {
  const remoteHistory = Array.isArray(remote.history) ? remote.history.filter(isContinueWatchingEntry) : [];
  const remoteProgress = Array.isArray(remote.progress) ? remote.progress.filter(isContinueWatchingEntry) : [];
  if (!remoteHistory.length && !remoteProgress.length) return;

  const nextHistory = remoteHistory.length
    ? mergeEntries(readWatchedHistoryEntries(), remoteHistory, MAX_WATCHED_HISTORY_ENTRIES)
    : readWatchedHistoryEntries();

  const completedAt = new Map<string, number>();
  for (const entry of nextHistory) {
    if (entry.completed) completedAt.set(entry.key, entry.updatedAt);
  }

  const localProgress = dropSupersededProgress(readContinueWatchingEntries(), completedAt);
  const mergedProgress = remoteProgress.length
    ? mergeEntries(localProgress, dropSupersededProgress(remoteProgress, completedAt), MAX_ENTRIES)
    : localProgress;

  const tombstoneByKey = new Map(readDeletionTombstones(TOMBSTONES_KEY).map(tombstone => [tombstone.key, tombstone]));
  writeProgressAndHistory(
    mergedProgress.filter(entry => survivesContinueWatchingDismissal(entry, tombstoneByKey)),
    nextHistory.filter(entry => survivesContinueWatchingDismissal(entry, tombstoneByKey, false)),
    remoteHistory.length > 0,
  );
}

function survivesContinueWatchingDismissal(
  entry: ContinueWatchingEntry,
  tombstoneByKey: Map<string, DeletionTombstone>,
  includeMedia = true,
) {
  const exact = tombstoneByKey.get(entry.key);
  if (exact && entry.updatedAt <= exact.deletedAt) return false;
  const media = includeMedia ? tombstoneByKey.get(mediaDismissalKey(entry.mediaKey)) : undefined;
  if (!media) return true;
  // Los avisos automáticos pueden tener fecha nueva sin que el usuario haya
  // vuelto a reproducir nada: no cuentan como una reanudación del título.
  return entry.currentTime > 0 && entry.updatedAt > media.deletedAt;
}

function dropSupersededProgress(entries: ContinueWatchingEntry[], completedAt: Map<string, number>) {
  return entries.filter(entry => {
    if (entry.completed) return true;
    const watchedAt = completedAt.get(entry.key);
    return watchedAt === undefined || watchedAt < entry.updatedAt;
  });
}

/**
 * Aplica lápidas remotas (Google Drive) al estado de reproducción: un descarte
 * ("quitar de continuar viendo") gana si es posterior a la última escritura de
 * la entrada; si esta se recreó después del descarte, sobrevive y la lápida se
 * retira para que deje de circular entre dispositivos.
 */
export function applyContinueWatchingTombstones(remoteTombstones: unknown) {
  if (!Array.isArray(remoteTombstones)) return;
  const tombstones = mergeDeletionTombstones(TOMBSTONES_KEY, remoteTombstones.filter(isDeletionTombstone));
  if (!tombstones.length) return;
  const tombstoneByKey = new Map(tombstones.map(tombstone => [tombstone.key, tombstone] as const));

  const nextProgress = readContinueWatchingEntries().filter(entry => survivesContinueWatchingDismissal(entry, tombstoneByKey));
  const nextHistory = readWatchedHistoryEntries().filter(entry => survivesContinueWatchingDismissal(entry, tombstoneByKey, false));
  writeProgressAndHistory(nextProgress, nextHistory, true);

  // Lápidas cuya entrada sobrevivió (más nueva que el borrado) dejan de circular.
  const survivingKeys = new Set<string>();
  for (const entry of [...nextProgress, ...nextHistory]) {
    const tombstone = tombstoneByKey.get(entry.key);
    if (tombstone && entry.updatedAt > tombstone.deletedAt) survivingKeys.add(entry.key);
  }
  if (survivingKeys.size) {
    replaceDeletionTombstones(TOMBSTONES_KEY, tombstones.filter(tombstone => !survivingKeys.has(tombstone.key)));
  }
}

function writeEntries(entries: ContinueWatchingEntry[]) {
  const result = writeExperienceJSON(captureExperienceScope(), STORAGE_KEY, entries, [CONTINUE_WATCHING_EVENT]);
  if (result.ok) _cachedPlaybackEntries = null;
  return result;
}

function writeProgressAndHistory(
  entries: ContinueWatchingEntry[],
  history: ContinueWatchingEntry[],
  includeHistory = true,
): StorageResult {
  const writes = [
    { key: STORAGE_KEY, value: JSON.stringify(entries) },
    ...(includeHistory ? [{ key: WATCHED_HISTORY_STORAGE_KEY, value: JSON.stringify(history) }] : []),
  ];
  const result = writeExperienceBatch(captureExperienceScope(), writes, [CONTINUE_WATCHING_EVENT]);
  if (result.ok) _cachedPlaybackEntries = null;
  return result;
}

function recoverPlaybackJournal() {
  let hasJournal = false;
  try { hasJournal = localStorage.getItem("aetherio-experience-write-journal-v1") !== null; }
  catch { /* recovery reports storage errors */ }
  const result = recoverExperienceJournal();
  if (hasJournal && result.ok) _cachedPlaybackEntries = null;
  return result;
}

let playbackCacheListenerWindow: Window | null = null;

function ensurePlaybackCacheListener() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function" || playbackCacheListenerWindow === window) return;
  playbackCacheListenerWindow = window;
  window.addEventListener(CONTINUE_WATCHING_EVENT, () => { _cachedPlaybackEntries = null; });
  window.addEventListener("storage", () => { _cachedPlaybackEntries = null; });
}

function getStorageKey() {
  return getScopedStorageKey(STORAGE_KEY);
}

function getWatchedHistoryStorageKey() {
  return getScopedStorageKey(WATCHED_HISTORY_STORAGE_KEY);
}

function getAudioSelectionStorageKey() {
  return getScopedStorageKey(AUDIO_SELECTION_STORAGE_KEY);
}

function readAudioSelectionCache() {
  const raw = localStorage.getItem(getAudioSelectionStorageKey());
  if (!raw) return {} as Record<string, ContinueWatchingAudioSelection>;
  return JSON.parse(raw) as Record<string, ContinueWatchingAudioSelection>;
}

function isContinueWatchingEntry(value: unknown): value is ContinueWatchingEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as ContinueWatchingEntry;
  return (
    typeof entry.key === "string" &&
    typeof entry.mediaKey === "string" &&
    typeof entry.type === "string" &&
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.currentTime === "number" &&
    typeof entry.duration === "number" &&
    typeof entry.updatedAt === "number"
  );
}

const SCHEDULE_SPORT_TYPES = new Set(["live", "sports-replay", "sports-live"]);

export function isSportsEntry(entry: { type: string }) {
  return SCHEDULE_SPORT_TYPES.has(entry.type);
}

function isResumableEntry(entry: ContinueWatchingEntry) {
  if (isSportsEntry(entry)) return false;
  return !entry.completed && (entry.currentTime >= MIN_RESUME_SECONDS || progressPercent(entry) > 0);
}

function isVisibleContinueWatchingEntry(entry: ContinueWatchingEntry) {
  if (entry.completed) return false;
  if (entry.entryKind === "next" || entry.entryKind === "new" || entry.entryKind === "new-season") return true;
  return isResumableEntry(entry);
}

function isCompleted(currentTime: number, duration: number) {
  if (!duration || duration < 60) return false;
  const remaining = duration - currentTime;
  return currentTime / duration >= COMPLETE_PERCENT || remaining <= COMPLETE_REMAINING_SECONDS;
}

function clampFinite(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function shouldReplaceEntry(existing: ContinueWatchingEntry, candidate: ContinueWatchingEntry) {
  const existingKindPriority = entryKindPriority(existing.entryKind);
  const candidateKindPriority = entryKindPriority(candidate.entryKind);
  if (candidateKindPriority !== existingKindPriority) {
    return candidateKindPriority > existingKindPriority;
  }
  if (candidate.updatedAt !== existing.updatedAt) return candidate.updatedAt > existing.updatedAt;
  return metadataScore(candidate) > metadataScore(existing);
}

function entryKindPriority(kind: ContinueWatchingEntryKind | undefined) {
  switch (kind) {
    case "new-season":
      return 3;
    case "new":
      return 2;
    case "next":
      return 1;
    default:
      return 0;
  }
}

function mergeEntries(
  existingEntries: ContinueWatchingEntry[],
  candidateEntries: ContinueWatchingEntry[],
  limit: number,
) {
  const byKey = new Map<string, ContinueWatchingEntry>();
  for (const entry of [...existingEntries, ...candidateEntries]) {
    const existing = byKey.get(entry.key);
    if (!existing || shouldReplaceEntry(existing, entry)) {
      byKey.set(entry.key, normalizeImportedEntry(entry, existing));
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

function normalizeImportedEntry(entry: ContinueWatchingEntry, existing?: ContinueWatchingEntry) {
  const merged: ContinueWatchingEntry = existing
    ? {
        ...entry,
        name: entry.name || existing.name,
        logo: sanitizeLogoUrl(entry.logo) ?? existing.logo,
        background: entry.background ?? existing.background,
        poster: entry.poster ?? existing.poster,
        episodeStill: entry.episodeStill ?? existing.episodeStill,
        episodeName: entry.episodeName ?? existing.episodeName,
      }
    : entry;

  if (merged.duration > 0 || !existing?.duration || typeof merged.remoteProgressPercent !== "number") return merged;
  return {
    ...merged,
    duration: existing.duration,
    currentTime: (merged.remoteProgressPercent / 100) * existing.duration,
  };
}

function metadataScore(entry: ContinueWatchingEntry) {
  let score = 0;
  if (entry.logo) score += 1;
  if (entry.background) score += 1;
  if (entry.poster) score += 1;
  if (entry.episodeStill) score += 1;
  if (entry.episodeName) score += 1;
  if (entry.duration > 0) score += 1;
  return score;
}
