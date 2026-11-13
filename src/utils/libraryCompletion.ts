import { buildMediaKey, type ContinueWatchingEntry } from "./continueWatching";
import { getScopedStorageKey } from "./localProfiles";

export interface SeriesEpisodePosition {
  season: number;
  episode: number;
}

export interface SeriesEpisodeManifest {
  type: string;
  id: string;
  episodes: SeriesEpisodePosition[];
}

export interface SeriesEpisodeCompletion extends SeriesEpisodeManifest {
  complete: boolean;
}

const SERIES_EPISODE_MANIFEST_KEY = "aetherio-series-episode-manifests-v1";

export function saveSeriesEpisodeManifest(type: string, id: string, episodes: readonly SeriesEpisodePosition[]) {
  const positions = Array.from(new Set(
    episodes
      .filter(item => Number.isInteger(item.season) && item.season > 0 && Number.isInteger(item.episode) && item.episode > 0)
      .map(item => `${item.season}:${item.episode}`),
  )).map(position => {
    const [season, episode] = position.split(":").map(Number);
    return { season, episode };
  });
  if (!positions.length) return false;

  try {
    const storageKey = getScopedStorageKey(SERIES_EPISODE_MANIFEST_KEY);
    const current = readStoredManifests(storageKey);
    current[buildMediaKey(type, id)] = { type, id, episodes: positions };
    localStorage.setItem(storageKey, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

export function getCompletedSeriesEpisodeManifests(history: readonly ContinueWatchingEntry[]) {
  return getSeriesEpisodeCompletions(history).filter(manifest => manifest.complete);
}

export function getSeriesEpisodeCompletions(history: readonly ContinueWatchingEntry[]): SeriesEpisodeCompletion[] {
  try {
    const manifests = readStoredManifests(getScopedStorageKey(SERIES_EPISODE_MANIFEST_KEY));
    return Object.values(manifests).map(manifest => ({
      ...manifest,
      complete: hasCompletedSeriesEpisodes(manifest.type, manifest.id, manifest.episodes, history),
    }));
  } catch {
    return [];
  }
}

export function getSeriesEpisodeCompletionStatus(
  type: string,
  id: string,
  history: readonly ContinueWatchingEntry[],
): "watched" | "to_watch" | null {
  const mediaKey = buildMediaKey(type, id);
  const manifest = getSeriesEpisodeCompletions(history).find(item => buildMediaKey(item.type, item.id) === mediaKey);
  if (!manifest) return null;
  return manifest.complete ? "watched" : "to_watch";
}

/** True only when every known regular episode has a completed history entry. */
export function hasCompletedSeriesEpisodes(
  type: string,
  id: string,
  episodes: readonly SeriesEpisodePosition[],
  history: readonly ContinueWatchingEntry[],
) {
  const mediaKey = buildMediaKey(type, id);
  const expected = new Set(
    episodes
      .filter(item => Number.isInteger(item.season) && item.season > 0 && Number.isInteger(item.episode) && item.episode > 0)
      .map(item => `${item.season}:${item.episode}`),
  );
  if (!expected.size) return false;

  const completed = new Set(
    history
      .filter(entry => entry.completed && entry.mediaKey === mediaKey && entry.season != null && entry.episode != null)
      .map(entry => `${entry.season}:${entry.episode}`),
  );
  return Array.from(expected).every(position => completed.has(position));
}

function readStoredManifests(storageKey: string): Record<string, SeriesEpisodeManifest> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isSeriesEpisodeManifest(value))) as Record<string, SeriesEpisodeManifest>;
}

function isSeriesEpisodeManifest(value: unknown): value is SeriesEpisodeManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as SeriesEpisodeManifest;
  return typeof manifest.type === "string"
    && typeof manifest.id === "string"
    && Array.isArray(manifest.episodes)
    && manifest.episodes.every(position => (
      Number.isInteger(position?.season)
      && position.season > 0
      && Number.isInteger(position?.episode)
      && position.episode > 0
    ));
}
