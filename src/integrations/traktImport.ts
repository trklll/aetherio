import { strFromU8, unzipSync } from "fflate";
import type { LibraryStatus, MediaItem } from "../types/ui";
import {
  addMissingContinueWatchingEntries,
  buildContinueWatchingKey,
  buildMediaKey,
  readPlaybackStateEntries,
  type ContinueWatchingEntry,
} from "../utils/continueWatching";
import { addMissingLibraryItems, setLibraryStatus } from "../utils/library";
import { getSeriesEpisodeCompletionStatus } from "../utils/libraryCompletion";

interface TraktMedia {
  ids?: { tmdb?: number | string; imdb?: string; trakt?: number | string; slug?: string };
  title?: string;
  year?: number;
  aired_episodes?: number;
}

interface TraktRecord {
  type?: string;
  action?: string;
  watched_at?: string;
  last_watched_at?: string;
  last_updated_at?: string;
  paused_at?: string;
  listed_at?: string;
  rated_at?: string;
  collected_at?: string;
  rating?: number;
  progress?: number;
  seasons?: Array<{ number?: number; episodes?: Array<{ number?: number }> }>;
  movie?: TraktMedia;
  show?: TraktMedia;
  episode?: { title?: string; season?: number; number?: number };
}

export interface TraktImportSummary {
  watchedMovies: number;
  watchedEpisodes: number;
  inProgress: number;
  savedItems: number;
  ratedItems: number;
  favorites: number;
  watchlist: number;
  collection: number;
}

const HISTORY_FILE = /^watched-history-\d+\.json$/;
const TRAKT_EXPORT_FILES = new Set([
  "watched-movies.json",
  "watched-shows.json",
  "watched-playback.json",
  "ratings-movies.json",
  "ratings-shows.json",
  "collection-movies.json",
  "collection-shows.json",
  "collection-episodes.json",
  "lists-watchlist.json",
  "lists-favorites.json",
]);
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

/** Imports a Trakt data export as an additive merge into the active Aetherio profile. */
export function importTraktArchive(archive: Uint8Array): TraktImportSummary {
  if (!archive.length || archive.length > MAX_ARCHIVE_BYTES) {
    throw new Error("El ZIP está vacío o supera el límite de 100 MB.");
  }

  const files = unzipSync(archive);
  const jsonNames = Object.keys(files).filter(name => name.toLowerCase().endsWith(".json"));
  const arrays = new Map<string, unknown[]>();
  for (const name of jsonNames) {
    const baseName = name.split("/").pop()?.toLowerCase();
    if (!baseName) continue;
    try {
      const parsed: unknown = JSON.parse(strFromU8(files[name]));
      if (Array.isArray(parsed)) arrays.set(baseName, parsed);
    } catch {
      // Ignore unrelated or malformed export files; relevant arrays are read below.
    }
  }

  const containsTraktExport = [...arrays.keys()].some(name => TRAKT_EXPORT_FILES.has(name) || HISTORY_FILE.test(name));
  if (!containsTraktExport) throw new Error("El ZIP no contiene archivos JSON reconocibles de una exportación de Trakt.");
  const get = (name: string) => (arrays.get(name) ?? []) as TraktRecord[];
  const history = [...arrays.entries()]
    .filter(([name]) => HISTORY_FILE.test(name))
    .sort(([a], [b]) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
    .flatMap(([, rows]) => rows as TraktRecord[]);

  const watchedByKey = new Map<string, ContinueWatchingEntry>();
  const aetherioPlayback = readPlaybackStateEntries();
  const watchedLibraryMedia: MediaItem[] = [];
  const watchedShowStats = new Map<string, {
    item: MediaItem;
    episodes: Set<string>;
    airedEpisodes?: number;
    lastWatchedAt?: string;
  }>();
  const addWatched = (entry: ContinueWatchingEntry) => {
    const current = watchedByKey.get(entry.key);
    if (!current || entry.updatedAt > current.updatedAt) watchedByKey.set(entry.key, entry);
  };
  const noteWatchedShow = (
    item: MediaItem,
    airedEpisodes?: number,
    season?: number,
    episode?: number,
    watchedAt?: string,
  ) => {
    const key = buildMediaKey(item.type, item.id);
    let stats = watchedShowStats.get(key);
    if (!stats) {
      stats = { item, episodes: new Set<string>() };
      watchedShowStats.set(key, stats);
    }
    if (typeof airedEpisodes === "number" && Number.isInteger(airedEpisodes) && airedEpisodes > 0) {
      stats.airedEpisodes = Math.max(stats.airedEpisodes ?? 0, airedEpisodes);
    }
    if (season != null && season > 0 && episode != null && episode > 0) {
      stats.episodes.add(`${season}:${episode}`);
    }
    if (watchedAt && (!stats.lastWatchedAt || (parseDate(watchedAt) ?? 0) > (parseDate(stats.lastWatchedAt) ?? 0))) {
      stats.lastWatchedAt = watchedAt;
    }
  };

  for (const record of get("watched-movies.json")) {
    const item = mediaItem(record.movie, "movie");
    if (item) {
      watchedLibraryMedia.push(item);
      addWatched(makePlaybackEntry(item, record.last_watched_at ?? record.last_updated_at));
    }
  }

  for (const record of history) {
    if (record.type === "movie" || record.movie) {
      const item = mediaItem(record.movie, "movie");
      if (item) {
        watchedLibraryMedia.push(item);
        addWatched(makePlaybackEntry(item, record.watched_at));
      }
      continue;
    }
    if (record.type === "episode" || record.episode) {
      const item = mediaItem(record.show, "series");
      const season = positiveInteger(record.episode?.season);
      const episode = positiveInteger(record.episode?.number);
      if (!item || season == null || episode == null) continue;
      noteWatchedShow(item, record.show?.aired_episodes, season, episode, record.watched_at);
      addWatched(makePlaybackEntry(item, record.watched_at, season, episode, record.episode?.title));
    }
  }

  // The watched aggregate includes the episodes seen per season. Combine it
  // with history so a series is marked watched only when every aired episode
  // is accounted for (episode histories can contain re-watches).
  for (const record of get("watched-shows.json")) {
    const item = mediaItem(record.show, "series");
    if (!item) continue;
    noteWatchedShow(item, record.show?.aired_episodes, undefined, undefined, record.last_watched_at ?? record.last_updated_at);
    for (const season of record.seasons ?? []) {
      const seasonNumber = positiveInteger(season.number);
      if (seasonNumber == null || seasonNumber === 0) continue;
      for (const episode of season.episodes ?? []) {
        const episodeNumber = positiveInteger(episode.number);
        if (episodeNumber != null && episodeNumber > 0) {
          noteWatchedShow(item, record.show?.aired_episodes, seasonNumber, episodeNumber, record.last_watched_at ?? record.last_updated_at);
        }
      }
    }
  }

  const watchedShowLibraryItems: Array<{ item: MediaItem; status: LibraryStatus }> = [];
  for (const stats of watchedShowStats.values()) {
    const traktComplete = stats.airedEpisodes != null && stats.episodes.size >= stats.airedEpisodes;
    const status: LibraryStatus = getSeriesEpisodeCompletionStatus(stats.item.type, stats.item.id, aetherioPlayback)
      ?? (traktComplete ? "watched" : "to_watch");
    watchedShowLibraryItems.push({ item: stats.item, status });
    if (status === "watched") addWatched(makePlaybackEntry(stats.item, stats.lastWatchedAt, 0, 0));
  }

  const inProgressEntries = get("watched-playback.json").flatMap(record => {
    const isMovie = record.type === "movie" || Boolean(record.movie);
    const item = mediaItem(isMovie ? record.movie : record.show, isMovie ? "movie" : "series");
    if (!item) return [];
    const season = isMovie ? undefined : positiveInteger(record.episode?.season) ?? undefined;
    const episode = isMovie ? undefined : positiveInteger(record.episode?.number) ?? undefined;
    if (!isMovie && (season == null || episode == null)) return [];
    const updatedAt = parseDate(record.paused_at) ?? Date.now();
    const progress = typeof record.progress === "number" && Number.isFinite(record.progress)
      ? Math.max(0, Math.min(100, record.progress))
      : 0;
    return [{
      ...makePlaybackEntry(item, record.paused_at, season, episode, record.episode?.title),
      currentTime: 0,
      duration: 0,
      updatedAt,
      completed: false,
      entryKind: "resume" as const,
      remoteProgressPercent: progress,
    }];
  });

  const saveByKey = new Map<string, MediaItem>();
  const addSavedItem = (item: MediaItem, status: LibraryStatus, rating?: number) => {
    const key = buildMediaKey(item.type, item.id);
    const aetherioStatus = getSeriesEpisodeCompletionStatus(item.type, item.id, aetherioPlayback);
    const resolvedStatus = aetherioStatus ?? status;
    if (!saveByKey.has(key)) saveByKey.set(key, { ...item, libraryStatus: resolvedStatus });
    const saved = saveByKey.get(key)!;
    if (aetherioStatus) saved.libraryStatus = aetherioStatus;
    else if (status === "watched") saved.libraryStatus = "watched";
    if (typeof rating === "number" && Number.isFinite(rating)) {
      saved.userRating = Math.max(0, Math.min(10, rating));
    }
  };
  const addSaved = (
    record: TraktRecord,
    media: TraktMedia | undefined,
    type: "movie" | "series",
    status: LibraryStatus,
  ) => {
    const item = mediaItem(media, type);
    if (item) addSavedItem(item, status, record.rating);
  };

  for (const item of watchedLibraryMedia) addSavedItem(item, "watched");
  for (const { item, status } of watchedShowLibraryItems) addSavedItem(item, status);

  const watchlist = get("lists-watchlist.json");
  const favorites = get("lists-favorites.json");
  const collection = [
    ...get("collection-movies.json"),
    ...get("collection-shows.json"),
    ...get("collection-episodes.json"),
  ];
  const ratings = [...get("ratings-movies.json"), ...get("ratings-shows.json")];
  for (const record of watchlist) addSaved(record, record.movie ?? record.show, record.type === "show" ? "series" : "movie", "to_watch");
  for (const record of favorites) addSaved(record, record.movie ?? record.show, record.type === "show" ? "series" : "movie", "to_watch");
  for (const record of collection) {
    const type = record.type === "show" || record.type === "episode" || Boolean(record.show) ? "series" : "movie";
    addSaved(record, record.movie ?? record.show, type, "to_watch");
  }
  for (const record of ratings) addSaved(record, record.movie ?? record.show, record.type === "show" ? "series" : "movie", "watched");

  const existingCompleted = new Set(watchedByKey.keys());
  const missingProgress = inProgressEntries.filter(entry => !existingCompleted.has(entry.key));
  const uniqueWatchedEpisodes = [...watchedByKey.values()].filter(entry => entry.type === "series" && (entry.season ?? 0) > 0).length;
  const uniqueWatchedMovies = [...watchedByKey.values()].filter(entry => entry.type === "movie").length;
  const savedItems = addMissingLibraryItems([...saveByKey.values()]);
  for (const item of saveByKey.values()) {
    const aetherioStatus = getSeriesEpisodeCompletionStatus(item.type, item.id, aetherioPlayback);
    if (aetherioStatus) setLibraryStatus(item.type, item.id, aetherioStatus);
  }
  addMissingContinueWatchingEntries([...watchedByKey.values(), ...missingProgress]);

  return {
    watchedMovies: uniqueWatchedMovies,
    watchedEpisodes: uniqueWatchedEpisodes,
    inProgress: missingProgress.length,
    savedItems,
    ratedItems: ratings.length,
    favorites: favorites.length,
    watchlist: watchlist.length,
    collection: collection.length,
  };
}

function mediaItem(media: TraktMedia | undefined, type: "movie" | "series"): MediaItem | null {
  if (!media || typeof media.title !== "string" || !media.title.trim()) return null;
  const ids = media.ids ?? {};
  const id = positiveId(ids.tmdb)
    ? `tmdb:${ids.tmdb}`
    : typeof ids.imdb === "string" && /^tt\d+$/i.test(ids.imdb)
      ? `imdb:${ids.imdb.toLowerCase()}`
      : positiveId(ids.trakt)
        ? `trakt:${ids.trakt}`
        : typeof ids.slug === "string" && ids.slug.trim()
          ? `trakt:${ids.slug.trim()}`
          : null;
  if (!id) return null;
  return {
    id,
    type,
    name: media.title.trim(),
    year: typeof media.year === "number" ? media.year : undefined,
  };
}

function makePlaybackEntry(
  item: MediaItem,
  date?: string,
  season?: number,
  episode?: number,
  episodeName?: string,
): ContinueWatchingEntry {
  const query = { type: item.type, id: item.id, season, episode };
  const updatedAt = parseDate(date) ?? Date.now();
  return {
    key: buildContinueWatchingKey(query),
    mediaKey: buildMediaKey(item.type, item.id),
    type: item.type,
    id: item.id,
    name: item.name,
    season,
    episode,
    episodeName,
    currentTime: 1,
    duration: 1,
    updatedAt,
    completed: true,
    entryKind: "resume",
    source: "local",
  };
}

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveId(value: unknown): value is number | string {
  return (typeof value === "number" && Number.isInteger(value) && value > 0)
    || (typeof value === "string" && /^[1-9]\d*$/.test(value));
}
