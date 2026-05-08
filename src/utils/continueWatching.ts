import type { MediaStream, StreamQuery } from "../types/stream";
import { sanitizeLogoUrl } from "./artwork";
import { getScopedStorageKey } from "./localProfiles";

export const CONTINUE_WATCHING_EVENT = "aetherio-continue-watching-updated";

const STORAGE_KEY = "aetherio-continue-watching-v1";
const MAX_ENTRIES = 80;
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
  season?: number;
  episode?: number;
  episodeName?: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
  completed: boolean;
  streamId?: string;
  streamName?: string;
}

export interface ContinueWatchingInput {
  query: StreamQuery;
  stream: MediaStream;
  name: string;
  logo?: string;
  background?: string;
  poster?: string;
  episodeName?: string;
  currentTime: number;
  duration: number;
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

export function getContinueWatchingRows() {
  return readContinueWatchingEntries().filter(entry => isResumableEntry(entry));
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

export function saveContinueWatchingProgress(input: ContinueWatchingInput) {
  const currentTime = clampFinite(input.currentTime);
  const duration = clampFinite(input.duration);
  if (currentTime < MIN_SAVE_SECONDS) return;

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
    season: input.query.season,
    episode: input.query.episode,
    episodeName: input.episodeName,
    currentTime,
    duration,
    updatedAt: Date.now(),
    completed,
    streamId: input.stream.id,
    streamName: input.stream.title ?? input.stream.name,
  };

  const entries = readContinueWatchingEntries().filter(item => item.key !== key);
  writeEntries([entry, ...entries].slice(0, MAX_ENTRIES));
}

export function formatResumeTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m`;
}

export function progressPercent(entry: ContinueWatchingEntry) {
  if (!entry.duration || entry.duration <= 0) return 0;
  return Math.min(100, Math.max(0, (entry.currentTime / entry.duration) * 100));
}

function writeEntries(entries: ContinueWatchingEntry[]) {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent(CONTINUE_WATCHING_EVENT));
  } catch {
    // Ignore storage failures; playback must not depend on local persistence.
  }
}

function getStorageKey() {
  return getScopedStorageKey(STORAGE_KEY);
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
  return !entry.completed && entry.currentTime >= MIN_RESUME_SECONDS;
}

function isCompleted(currentTime: number, duration: number) {
  if (!duration || duration < 60) return false;
  const remaining = duration - currentTime;
  return currentTime / duration >= COMPLETE_PERCENT || remaining <= COMPLETE_REMAINING_SECONDS;
}

function clampFinite(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
