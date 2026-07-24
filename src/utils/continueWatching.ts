import type { MediaStream, StreamQuery } from "../types/stream.ts";
import { sanitizeLogoUrl } from "./artwork";
import { getScopedStorageKey } from "./localProfiles";

export const CONTINUE_WATCHING_EVENT = "aetherio-continue-watching-updated";

const STORAGE_KEY = "aetherio-continue-watching-v1";
const WATCHED_HISTORY_STORAGE_KEY = "aetherio-watched-history-v1";
const AUDIO_SELECTION_STORAGE_KEY = "aetherio-continue-watching-audio-selection-v1";
const MAX_ENTRIES = 80;
const MAX_WATCHED_HISTORY_ENTRIES = 12000;
const MIN_SAVE_SECONDS = 5;
const MIN_RESUME_SECONDS = 12;
const COMPLETE_PERCENT = 0.92;
const COMPLETE_REMAINING_SECONDS = 90;

export interface ContinueWatchingEntry {
  key: string;
  mediaKey: string;
  type: string;
  id: string;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  episodeStill?: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
  completed: boolean;
  entryKind?: "resume" | "next" | "new";
  remoteProgressPercent?: number;
  source?: "local" | "trakt";
  traktPlaybackId?: number;
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
  query: StreamQuery;
  name: string;
  episodeName?: string;
  logo?: string;
  background?: string;
  poster?: string;
  episodeStill?: string;
  runtimeSeconds?: number;
  entryKind?: "next" | "new";
  updatedAt?: number;
  source?: "local" | "trakt";
}

export function buildMediaKey(type: string, id: string) {
  return `${type}:${id}`;
}

export function buildContinueWatchingKey(query: StreamQuery) {
  if (query.type === "movie") return buildMediaKey(query.type, query.id);
  return `${buildMediaKey(query.type, query.id)}:${query.season ?? 0}:${query.episode ?? 0}`;
}

export function readContinueWatchingEntries(): ContinueWatchingEntry[] {
  try {
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

export function readPlaybackStateEntries(): ContinueWatchingEntry[] {
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
  if (!query) return;
  const key = buildContinueWatchingKey(query);
  const entries = readContinueWatchingEntries();
  const index = entries.findIndex(entry => entry.key === key);
  if (index === -1) return;

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
  writeEntries(updated);
}

export function saveContinueWatchingAudioSelection(
  query: StreamQuery | null | undefined,
  selection: Omit<ContinueWatchingAudioSelection, "updatedAt">,
) {
  if (!query) return;
  try {
    const cache = readAudioSelectionCache();
    cache[buildContinueWatchingKey(query)] = {
      ...selection,
      updatedAt: Date.now(),
    };
    localStorage.setItem(getAudioSelectionStorageKey(), JSON.stringify(cache));
  } catch {
    // Best-effort local persistence only.
  }
}

export function getContinueWatchingAudioSelection(query: StreamQuery | null | undefined) {
  if (!query) return null;
  try {
    const cache = readAudioSelectionCache();
    return cache[buildContinueWatchingKey(query)] ?? null;
  } catch {
    return null;
  }
}

export function saveContinueWatchingProgress(input: ContinueWatchingInput) {
  const currentTime = clampFinite(input.currentTime);
  const duration = clampFinite(input.duration);
  if (currentTime < MIN_SAVE_SECONDS) return null;

  const completed = isCompleted(currentTime, duration);
  const key = buildContinueWatchingKey(input.query);
  const mediaKey = buildMediaKey(input.query.type, input.query.id);
  const entry: ContinueWatchingEntry = {
    key,
    mediaKey,
    type: input.query.type,
    id: input.query.id,
    name: input.name || input.query.id,
    logo: sanitizeLogoUrl(input.logo),
    background: input.background,
    poster: input.poster,
    episodeStill: input.episodeStill ?? (input.query.type !== "movie" ? input.background : undefined),
    season: input.query.season,
    episode: input.query.episode,
    episodeName: input.episodeName,
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

  const entries = readContinueWatchingEntries().filter(item => item.key !== key);
  if (completed) {
    writeEntries(entries.slice(0, MAX_ENTRIES));
    writeWatchedHistoryEntries(mergeEntries(readWatchedHistoryEntries(), [entry], MAX_WATCHED_HISTORY_ENTRIES));
    return entry;
  }
  writeEntries([entry, ...entries].slice(0, MAX_ENTRIES));
  return entry;
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
  writeEntries(updated);
  writeWatchedHistoryEntries(mergeEntries(readWatchedHistoryEntries(), [entry], MAX_WATCHED_HISTORY_ENTRIES));
  return entry;
}

export function saveNextEpisodePrompt(input: NextEpisodePromptInput) {
  if (input.query.type === "movie" || !input.query.season || !input.query.episode) return null;
  const key = buildContinueWatchingKey(input.query);
  const mediaKey = buildMediaKey(input.query.type, input.query.id);
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

export function removeContinueWatchingEntry(key: string) {
  const current = readContinueWatchingEntries();
  const watched = readWatchedHistoryEntries();
  const removed = current.find(entry => entry.key === key) ?? watched.find(entry => entry.key === key) ?? null;
  const entries = current.filter(entry => entry.key !== key);
  writeEntries(entries.slice(0, MAX_ENTRIES));
  writeWatchedHistoryEntries(watched.filter(entry => entry.key !== key));
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
  writeEntries(entries.filter(entry => entry.key !== key).slice(0, MAX_ENTRIES));
  writeWatchedHistoryEntries(mergeEntries(readWatchedHistoryEntries(), [next], MAX_WATCHED_HISTORY_ENTRIES));
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

export function mergeContinueWatchingEntries(importedEntries: ContinueWatchingEntry[]) {
  if (!importedEntries.length) return;
  const watchedEntries = importedEntries.filter(entry => entry.completed);
  if (watchedEntries.length) {
    writeWatchedHistoryEntries(mergeEntries(readWatchedHistoryEntries(), watchedEntries, MAX_WATCHED_HISTORY_ENTRIES));
  }
  writeEntries(mergeEntries(
    readContinueWatchingEntries().filter(entry => !entry.completed),
    importedEntries.filter(entry => !entry.completed),
    MAX_ENTRIES,
  ));
}

function writeEntries(entries: ContinueWatchingEntry[]) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(entries));
    _cachedPlaybackEntries = null;
    window.dispatchEvent(new CustomEvent(CONTINUE_WATCHING_EVENT));
  } catch {
    // Ignore storage failures; playback must not depend on local persistence.
  }
}

function writeWatchedHistoryEntries(entries: ContinueWatchingEntry[]) {
  try {
    localStorage.setItem(getWatchedHistoryStorageKey(), JSON.stringify(entries));
    _cachedPlaybackEntries = null;
    window.dispatchEvent(new CustomEvent(CONTINUE_WATCHING_EVENT));
  } catch {
    // Best-effort watched history cache only.
  }
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

function isResumableEntry(entry: ContinueWatchingEntry) {
  return !entry.completed && (entry.currentTime >= MIN_RESUME_SECONDS || progressPercent(entry) > 0);
}

function isVisibleContinueWatchingEntry(entry: ContinueWatchingEntry) {
  if (entry.completed) return false;
  if (entry.entryKind === "next" || entry.entryKind === "new") return true;
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
  if (candidate.updatedAt !== existing.updatedAt) return candidate.updatedAt > existing.updatedAt;
  return metadataScore(candidate) > metadataScore(existing);
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
