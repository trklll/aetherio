import { tmdbFetch } from "../config/apiKeys.ts";
import { invokeCommand, openExternalUrl } from "../runtime/platform.ts";
import {
  buildContinueWatchingKey,
  buildMediaKey,
  mergeContinueWatchingEntries,
  progressPercent,
  readPlaybackStateEntries,
  type ContinueWatchingEntry,
} from "../utils/continueWatching.ts";
import { getScopedStorageKey } from "../utils/localProfiles.ts";

const BASE_URL = "https://api.trakt.tv";
const AUTHORIZE_URL = "https://trakt.tv/oauth/authorize";
const REDIRECT_URI = "aetherio://trakt/callback";
const TMDB_IMG_URL = "https://image.tmdb.org/t/p";
const API_VERSION = "2";
const AUTH_STORAGE_KEY = "aetherio-trakt-auth-v1";
const QUEUE_STORAGE_KEY = "aetherio-trakt-queue-v1";
const SYNC_STORAGE_KEY = "aetherio-trakt-sync-v1";
const MAX_QUEUE_ITEMS = 80;
const COMPLETED_PERCENT = 90;
const SCROBBLE_DEDUP_MS = 8000;
const SCROBBLE_PROGRESS_WINDOW = 1.5;
const AUTHORIZATION_PENDING_TTL_MS = 10 * 60 * 1000;
const TRAKT_CLIENT_ID = (import.meta.env.VITE_TRAKT_CLIENT_ID as string | undefined)?.trim() ?? "";
const TRAKT_COMMENTS_SORT = "likes";
const TRAKT_COMMENTS_LIMIT = 50;
const TRAKT_COMMENTS_CACHE_TTL_MS = 10 * 60 * 1000;
const INLINE_SPOILER_REGEX = /\[spoiler\][\s\S]*?\[\/spoiler\]/i;
const INLINE_SPOILER_TAG_REGEX = /\[\/?spoiler\]/gi;

export const TRAKT_AUTH_CHANGED_EVENT = "aetherio-trakt-auth-changed";
export const TRAKT_SYNC_CHANGED_EVENT = "aetherio-trakt-sync-changed";

export interface TraktAuthState {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  createdAt?: number;
  expiresIn?: number;
  username?: string;
  userSlug?: string;
  redirectUri?: string;
  pendingAuthorizationState?: string;
  pendingAuthorizationStartedAt?: number;
}

export interface TraktAuthSnapshot {
  connected: boolean;
  credentialsConfigured: boolean;
  authorizationPending: boolean;
  username?: string;
  expiresAt?: number;
}

export type TraktAuthEventDetail =
  | { kind: "connected"; username?: string }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

export type TraktAuthorizationResult =
  | { status: "success"; username?: string }
  | { status: "ignored" };

export interface TraktCommentReview {
  id: number;
  authorDisplayName: string;
  authorUsername?: string;
  comment: string;
  spoiler: boolean;
  containsInlineSpoilers: boolean;
  review: boolean;
  likes: number;
  rating?: number;
  createdAt?: string;
  updatedAt?: string;
  hasSpoilerContent: boolean;
}

export interface TraktCommentsPage {
  items: TraktCommentReview[];
  currentPage: number;
  pageCount: number;
  itemCount: number;
}

export interface TraktCommentsMediaInput {
  type: string;
  id: string;
  ids?: TraktIds;
  season?: number;
  episode?: number;
  page?: number;
}

interface TraktIds {
  trakt?: number;
  imdb?: string;
  tmdb?: number;
  slug?: string;
}

interface TraktCommentDto {
  id?: number;
  created_at?: string;
  updated_at?: string;
  comment?: string;
  spoiler?: boolean;
  review?: boolean;
  likes?: number;
  user_stats?: {
    rating?: number;
  };
  user?: {
    username?: string;
    name?: string;
  };
}

type TraktQueueKind = "scrobble" | "history-add" | "history-remove" | "playback-remove";

interface TraktQueueItem {
  id: string;
  kind: TraktQueueKind;
  payload: unknown;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

interface TraktScrobblePayload {
  action: "start" | "pause" | "stop";
  entry: ContinueWatchingEntry;
}

interface TraktPlaybackRemovePayload {
  entry: ContinueWatchingEntry;
}

interface TraktApiGetResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface ScrobbleStamp {
  action: string;
  itemKey: string;
  progress: number;
  timestamp: number;
}

let lastScrobbleStamp: ScrobbleStamp | null = null;
const commentsCache = new Map<string, { page: TraktCommentsPage; expiresAt: number }>();

export function getTraktAuthSnapshot(): TraktAuthSnapshot {
  const state = readAuthState();
  return {
    connected: isAuthenticatedState(state),
    credentialsConfigured: Boolean(TRAKT_CLIENT_ID),
    authorizationPending: hasPendingAuthorization(state),
    username: state.username,
    expiresAt: tokenExpiresAtMs(state),
  };
}

export async function startTraktAuthorization() {
  await ensureTraktOauthConfigured();
  const state = createAuthorizationState();
  const startedAt = Date.now();
  writeAuthState({
    ...readAuthState(),
    redirectUri: REDIRECT_URI,
    pendingAuthorizationState: state,
    pendingAuthorizationStartedAt: startedAt,
  });
  dispatchAuthChanged();

  const authorizationUrl = buildAuthorizationUrl(state);
  traktLog("authorization requested", { authorizationUrl });
  await openAuthorizationUrl(authorizationUrl);
  return { authorizationUrl, state, expiresAt: startedAt + AUTHORIZATION_PENDING_TTL_MS };
}

export async function completeTraktAuthorization(callbackUrl: string): Promise<TraktAuthorizationResult> {
  const callback = parseTraktCallbackUrl(callbackUrl);
  if (!callback) return { status: "ignored" };
  const state = readAuthState();
  if (!state.pendingAuthorizationState || !state.pendingAuthorizationStartedAt) {
    traktLog("authorization callback ignored without pending state", {
      connected: isAuthenticatedState(state),
    });
    return { status: "ignored" };
  }
  if (callback.error) {
    writeAuthState(clearPendingAuthorization(state));
    dispatchAuthChanged();
    throw new Error(callback.errorDescription || "Autorizacion rechazada en Trakt.");
  }
  if (!callback.code) {
    throw new Error("Trakt no devolvio codigo de autorizacion.");
  }

  if (Date.now() - state.pendingAuthorizationStartedAt > AUTHORIZATION_PENDING_TTL_MS) {
    writeAuthState(clearPendingAuthorization(state));
    dispatchAuthChanged();
    throw new Error("La autorizacion de Trakt expiro. Vuelve a conectar.");
  }
  if (callback.state !== state.pendingAuthorizationState) {
    throw new Error("Respuesta de Trakt invalida. El estado OAuth no coincide.");
  }

  const token = await invokeTraktOAuthToken({
    grantType: "authorization_code",
    code: callback.code,
    redirectUri: state.redirectUri || REDIRECT_URI,
  });
  saveTokenResponse(token, clearPendingAuthorization(state), state.redirectUri || REDIRECT_URI);
  const username = await refreshTraktUserSettings().catch(() => undefined);
  dispatchAuthChanged({ kind: "connected", username });
  void processTraktQueue();
  void syncTraktNow();
  traktLog("authorization completed", { username });
  return { status: "success", username };
}

export async function disconnectTrakt() {
  const state = readAuthState();
  if (state.accessToken && TRAKT_CLIENT_ID) {
    await invokeCommand("trakt_oauth_revoke", {
      clientId: TRAKT_CLIENT_ID,
      token: state.accessToken,
    }).catch(error => {
      traktLog("token revoke failed", { error: String(error) });
    });
  }
  localStorage.removeItem(getAuthStorageKey());
  dispatchAuthChanged({ kind: "disconnected" });
  traktLog("disconnected");
}

export async function sendTraktScrobble(
  action: "start" | "pause" | "stop",
  entry: ContinueWatchingEntry,
) {
  const progress = progressPercent(entry);
  const itemKey = itemKeyForEntry(entry);
  if (!itemKey || shouldSkipScrobble(action, itemKey, progress)) return;

  const payload: TraktScrobblePayload = { action, entry };
  const sent = await sendScrobblePayload(payload, true);
  if (sent) {
    lastScrobbleStamp = { action, itemKey, progress, timestamp: Date.now() };
  }
}

export async function syncTraktProgressEntry(entry: ContinueWatchingEntry | null | undefined) {
  if (!entry) return;
  if (entry.completed) {
    await syncTraktMarkedWatched(entry);
    return;
  }
  await sendTraktScrobble("pause", entry);
}

export async function syncTraktMarkedWatched(entry: ContinueWatchingEntry | null | undefined) {
  if (!entry) return;
  const sent = await sendHistoryAddPayload(entry, true);
  if (sent) {
    traktLog("history add sent", { key: entry.key });
    await processTraktQueue();
  }
}

export async function syncTraktMarkedUnwatched(entry: ContinueWatchingEntry | null | undefined) {
  if (!entry) return;
  const sent = await sendHistoryRemovePayload(entry, true);
  if (sent) {
    traktLog("history remove sent", { key: entry.key });
    await processTraktQueue();
  }
}

export async function syncTraktRemovePlayback(entry: ContinueWatchingEntry | null | undefined) {
  if (!entry) return;
  await sendPlaybackRemovePayload({ entry }, true);
}

export async function syncTraktNow() {
  const headers = await authorizedTraktHeaders();
  if (!headers) return { imported: 0, queued: readQueue().length };

  await processTraktQueue();
  const localEntries = readPlaybackStateEntries();
  const localByKey = new Map(localEntries.map(entry => [entry.key, entry]));

  const [
    playbackMovies,
    playbackEpisodes,
    historyMovies,
    historyEpisodes,
    watchedShows,
  ] = await Promise.all([
    traktGet<TraktPlaybackItem[]>("/sync/playback/movies", headers).catch(() => []),
    traktGet<TraktPlaybackItem[]>("/sync/playback/episodes", headers).catch(() => []),
    traktGet<TraktHistoryMovieItem[]>("/sync/history/movies?limit=250", headers).catch(() => []),
    traktGet<TraktHistoryEpisodeItem[]>("/sync/history/episodes?limit=250", headers).catch(() => []),
    traktGet<TraktWatchedShowItem[]>("/sync/watched/shows", headers).catch(() => []),
  ]);

  const baseImported = [
    ...playbackMovies.map(item => mapPlaybackMovie(item, localByKey)),
    ...playbackEpisodes.map(item => mapPlaybackEpisode(item, localByKey)),
    ...historyMovies.map(item => mapHistoryMovie(item, localByKey)),
    ...historyEpisodes.map(item => mapHistoryEpisode(item, localByKey)),
    ...mapWatchedShows(watchedShows, localByKey),
  ].filter((entry): entry is ContinueWatchingEntry => Boolean(entry));

  const nextUpEntries = await buildNewEpisodeEntriesFromWatchedShows(watchedShows, localByKey).catch(error => {
    traktLog("next episode import failed", { error: String(error) });
    return [] as ContinueWatchingEntry[];
  });
  const imported = await enrichImportedEntries([...baseImported, ...nextUpEntries]);

  mergeContinueWatchingEntries(imported);
  writeSyncSnapshot({ lastSyncAt: Date.now(), imported: imported.length });
  dispatchSyncChanged();
  traktLog("sync completed", { imported: imported.length, queued: readQueue().length });
  return { imported: imported.length, queued: readQueue().length };
}

export async function fetchTraktCommentsForMedia(input: TraktCommentsMediaInput): Promise<TraktCommentsPage> {
  const target = await resolveTraktCommentsTarget(input);
  if (!target) {
    return { items: [], currentPage: input.page ?? 1, pageCount: 0, itemCount: 0 };
  }

  const page = Math.max(1, input.page ?? 1);
  const cacheKey = [
    target.kind,
    target.pathId,
    target.season ?? "",
    target.episode ?? "",
    page,
  ].join("|");
  const cached = commentsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.page;

  const headers = await commentsTraktHeaders();
  if (!headers) throw new Error("Trakt no esta configurado para cargar comentarios.");

  const path = target.kind === "movie"
    ? `/movies/${encodeURIComponent(target.pathId)}/comments/${TRAKT_COMMENTS_SORT}`
    : target.kind === "episode"
      ? `/shows/${encodeURIComponent(target.pathId)}/seasons/${target.season}/episodes/${target.episode}/comments/${TRAKT_COMMENTS_SORT}`
      : `/shows/${encodeURIComponent(target.pathId)}/comments/${TRAKT_COMMENTS_SORT}`;
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(TRAKT_COMMENTS_LIMIT));

  const response = await traktApiGet(url.toString(), headers);
  if (response.status === 404) {
    return { items: [], currentPage: page, pageCount: 0, itemCount: 0 };
  }
  if (response.status <= 0) {
    return { items: [], currentPage: page, pageCount: 0, itemCount: 0 };
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`No se pudieron cargar comentarios de Trakt (${response.status}).`);
  }

  const raw = JSON.parse(response.body || "[]") as TraktCommentDto[];
  const items = raw
    .filter(item => typeof item.comment === "string" && item.comment.trim())
    .map(mapTraktCommentReview);
  const result = {
    items,
    currentPage: page,
    pageCount: Number(readHeader(response.headers, "x-pagination-page-count")) || page,
    itemCount: Number(readHeader(response.headers, "x-pagination-item-count")) || items.length,
  };
  commentsCache.set(cacheKey, { page: result, expiresAt: Date.now() + TRAKT_COMMENTS_CACHE_TTL_MS });
  return result;
}

async function resolveTraktCommentsTarget(input: TraktCommentsMediaInput): Promise<{ kind: "movie" | "show" | "episode"; pathId: string; season?: number; episode?: number } | null> {
  const isMovie = input.type === "movie";
  const kind = !isMovie && typeof input.season === "number" && input.episode ? "episode" : isMovie ? "movie" : "show";
  const mergedIds = { ...parseTraktContentIds(input.id), ...(input.ids ?? {}) };
  const direct = mergedIds.imdb || (mergedIds.trakt ? String(mergedIds.trakt) : "") || mergedIds.slug;
  if (direct) {
    return {
      kind,
      pathId: direct,
      season: input.season,
      episode: input.episode,
    };
  }

  if (!mergedIds.tmdb) return null;
  const headers = await commentsTraktHeaders();
  if (!headers) return null;
  const searchType = isMovie ? "movie" : "show";
  const response = await traktApiGet(`${BASE_URL}/search/tmdb/${mergedIds.tmdb}?type=${searchType}`, headers).catch(() => null);
  if (!response || response.status < 200 || response.status >= 300) return null;
  const results = JSON.parse(response.body || "[]") as Array<{ type?: string; movie?: { ids?: TraktIds }; show?: { ids?: TraktIds } }>;
  const match = results.find(item => item.type === searchType);
  const ids = isMovie ? match?.movie?.ids : match?.show?.ids;
  const pathId = ids?.imdb || (ids?.trakt ? String(ids.trakt) : "") || ids?.slug;
  return pathId ? { kind, pathId, season: input.season, episode: input.episode } : null;
}

async function commentsTraktHeaders() {
  const authorized = await authorizedTraktHeaders();
  if (authorized) return authorized;
  if (!TRAKT_CLIENT_ID) return null;
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "trakt-api-version": API_VERSION,
    "trakt-api-key": TRAKT_CLIENT_ID,
  };
}

function mapTraktCommentReview(item: TraktCommentDto): TraktCommentReview {
  const comment = stripInlineSpoilerMarkup(item.comment);
  const containsInlineSpoilers = INLINE_SPOILER_REGEX.test(item.comment ?? "");
  const authorDisplayName = item.user?.name?.trim() || item.user?.username?.trim() || "Usuario de Trakt";
  const spoiler = item.spoiler === true;
  return {
    id: Number(item.id) || Math.abs(hashString(`${authorDisplayName}:${comment}:${item.created_at ?? ""}`)),
    authorDisplayName,
    authorUsername: item.user?.username?.trim() || undefined,
    comment,
    spoiler,
    containsInlineSpoilers,
    review: item.review === true,
    likes: Number(item.likes) || 0,
    rating: Number.isFinite(Number(item.user_stats?.rating)) ? Number(item.user_stats?.rating) : undefined,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    hasSpoilerContent: spoiler || containsInlineSpoilers,
  };
}

function readHeader(headers: Record<string, string>, key: string) {
  const normalized = key.toLowerCase();
  return headers[normalized] ?? headers[key] ?? "";
}

async function traktApiGet(url: string, headers: Record<string, string>): Promise<TraktApiGetResult> {
  try {
    const desktop = await invokeCommand<TraktApiGetResult>("trakt_api_get", { url, headers });
    return {
      status: Number(desktop?.status ?? 0),
      headers: normalizeHeaderMap(desktop?.headers),
      body: typeof desktop?.body === "string" ? desktop.body : "",
    };
  } catch {
    if (typeof window !== "undefined" && /^https?:$/i.test(window.location.protocol)) {
      return { status: 0, headers: {}, body: "" };
    }
    const response = await fetch(url, { headers });
    const body = await response.text();
    const map: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      map[key.toLowerCase()] = value;
    });
    return { status: response.status, headers: map, body };
  }
}

function normalizeHeaderMap(raw: unknown) {
  if (!raw || typeof raw !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    result[key.toLowerCase()] = value;
  }
  return result;
}

function stripInlineSpoilerMarkup(comment?: string) {
  return (comment ?? "")
    .replace(INLINE_SPOILER_TAG_REGEX, "")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

async function authorizedTraktHeaders(): Promise<Record<string, string> | null> {
  let state = readAuthState();
  if (!TRAKT_CLIENT_ID || !isAuthenticatedState(state)) return null;

  if (isTokenExpiredOrExpiring(state)) {
    const refreshed = await refreshTraktToken(state);
    if (!refreshed) return null;
    state = refreshed;
  }

  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "trakt-api-version": API_VERSION,
    "trakt-api-key": TRAKT_CLIENT_ID,
    "Authorization": `Bearer ${state.accessToken}`,
  };
}

async function refreshTraktToken(state: TraktAuthState) {
  if (!state.refreshToken) return null;
  const token = await invokeTraktOAuthToken({
    grantType: "refresh_token",
    refreshToken: state.refreshToken,
    redirectUri: state.redirectUri || REDIRECT_URI,
  }).catch(error => {
    traktLog("token refresh transport failed", { error: String(error) });
    return null;
  });
  if (!token) {
    traktLog("token refresh failed");
    return null;
  }
  saveTokenResponse(token, state, state.redirectUri || REDIRECT_URI);
  const refreshed = readAuthState();
  dispatchAuthChanged();
  return refreshed;
}

async function refreshTraktUserSettings() {
  const headers = await authorizedTraktHeaders();
  if (!headers) return undefined;
  const settings = await traktGet<{ user?: { username?: string; ids?: { slug?: string } } }>("/users/settings", headers);
  const state = readAuthState();
  const username = settings.user?.username;
  writeAuthState({
    ...state,
    username,
    userSlug: settings.user?.ids?.slug,
  });
  dispatchAuthChanged();
  return username;
}

async function sendScrobblePayload(payload: TraktScrobblePayload, queueOnFailure: boolean) {
  const body = buildScrobbleBody(payload.entry);
  if (!body) return false;
  const result = await traktPost(`/scrobble/${payload.action}`, body);
  if (result === "sent") return true;
  if (queueOnFailure && result === "failed") enqueueQueueItem("scrobble", payload);
  return false;
}

async function sendHistoryAddPayload(entry: ContinueWatchingEntry, queueOnFailure: boolean) {
  const body = buildHistoryAddBody(entry);
  if (!body) return false;
  const result = await traktPost("/sync/history", body);
  if (result === "sent") return true;
  if (queueOnFailure && result === "failed") enqueueQueueItem("history-add", entry);
  return false;
}

async function sendHistoryRemovePayload(entry: ContinueWatchingEntry, queueOnFailure: boolean) {
  const body = buildHistoryRemoveBody(entry);
  if (!body) return false;
  const result = await traktPost("/sync/history/remove", body);
  if (result === "sent") return true;
  if (queueOnFailure && result === "failed") enqueueQueueItem("history-remove", entry);
  return false;
}

async function sendPlaybackRemovePayload(payload: TraktPlaybackRemovePayload, queueOnFailure: boolean) {
  const result = await removeRemotePlayback(payload.entry);
  if (result === "sent") return true;
  if (queueOnFailure && result === "failed") enqueueQueueItem("playback-remove", payload);
  return false;
}

async function removeRemotePlayback(entry: ContinueWatchingEntry): Promise<"sent" | "auth-missing" | "failed"> {
  const headers = await authorizedTraktHeaders();
  if (!headers) return "auth-missing";

  const playbackPath = entry.type === "movie" ? "/sync/playback/movies" : "/sync/playback/episodes";
  const items = await traktGet<TraktPlaybackItem[]>(playbackPath, headers).catch(error => {
    traktLog("playback lookup failed", { error: String(error) });
    return null;
  });
  if (!items) return "failed";

  const target = items.find(item => playbackItemMatchesEntry(item, entry));
  if (!target?.id) return "sent";

  const response = await fetch(`${BASE_URL}/sync/playback/${target.id}`, {
    method: "DELETE",
    headers,
  }).catch(error => {
    traktLog("playback remove transport failed", { error: String(error) });
    return null;
  });
  if (!response) return "failed";
  return response.ok ? "sent" : "failed";
}

async function traktPost(path: string, body: unknown): Promise<"sent" | "auth-missing" | "failed"> {
  const headers = await authorizedTraktHeaders();
  if (!headers) return "auth-missing";
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }).catch(error => {
    traktLog("request transport failed", { path, error: String(error) });
    return null;
  });
  if (!response) return "failed";
  if (response.ok || response.status === 409) return "sent";
  traktLog("request failed", { path, status: response.status, body: await response.text().catch(() => "") });
  return "failed";
}

async function traktGet<T>(path: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, { headers });
  if (!response.ok) throw new Error(`Trakt GET ${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

async function processTraktQueue() {
  const queue = readQueue();
  if (!queue.length) return;
  const remaining: TraktQueueItem[] = [];

  for (const item of queue) {
    let sent = false;
    if (item.kind === "scrobble") {
      sent = await sendScrobblePayload(item.payload as TraktScrobblePayload, false);
    } else if (item.kind === "history-add") {
      sent = await sendHistoryAddPayload(item.payload as ContinueWatchingEntry, false);
    } else if (item.kind === "history-remove") {
      sent = await sendHistoryRemovePayload(item.payload as ContinueWatchingEntry, false);
    } else if (item.kind === "playback-remove") {
      sent = await sendPlaybackRemovePayload(item.payload as TraktPlaybackRemovePayload, false);
    }

    if (!sent && item.attempts < 8) {
      remaining.push({ ...item, attempts: item.attempts + 1, updatedAt: Date.now() });
    }
  }

  writeQueue(remaining);
  traktLog("queue processed", { before: queue.length, after: remaining.length });
}

async function ensureTraktOauthConfigured() {
  if (!TRAKT_CLIENT_ID) {
    throw new Error("Trakt no esta configurado en esta version de Aetherio.");
  }
  const ready = await invokeCommand<boolean>("trakt_oauth_configured").catch((error: unknown) => {
    traktLog("oauth config check failed", { error: String(error) });
    return false;
  });
  if (!ready) {
    throw new Error("Trakt no esta configurado en esta version de Aetherio.");
  }
}

function buildAuthorizationUrl(state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", TRAKT_CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);
  return url.toString();
}

async function openAuthorizationUrl(authorizationUrl: string) {
  try {
    await openExternalUrl(authorizationUrl);
  } catch (error) {
    traktLog("opener failed, falling back to window.open", { error: String(error) });
    window.open(authorizationUrl, "_blank", "noopener,noreferrer");
  }
}

function parseTraktCallbackUrl(callbackUrl: string) {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    return null;
  }

  const isTraktCallback =
    url.protocol === "aetherio:" &&
    url.hostname === "trakt" &&
    url.pathname.replace(/\/$/, "") === "/callback";
  if (!isTraktCallback) return null;

  return {
    code: url.searchParams.get("code") || undefined,
    state: url.searchParams.get("state") || undefined,
    error: url.searchParams.get("error") || undefined,
    errorDescription: url.searchParams.get("error_description") || undefined,
  };
}

async function invokeTraktOAuthToken(input: {
  grantType: "authorization_code" | "refresh_token";
  code?: string;
  refreshToken?: string;
  redirectUri: string;
}) {
  return invokeCommand<TraktTokenResponse>("trakt_oauth_token", {
    grantType: input.grantType,
    clientId: TRAKT_CLIENT_ID,
    code: input.code,
    refreshToken: input.refreshToken,
    redirectUri: input.redirectUri,
  });
}

function buildScrobbleBody(entry: ContinueWatchingEntry) {
  const ids = parseTraktContentIds(entry.id);
  const progress = Math.max(0, Math.min(100, progressPercent(entry)));

  if (entry.type === "movie") {
    const movie = {
      title: entry.name,
      ids: idsToBody(ids),
    };
    if (!movie.ids && !movie.title) return null;
    return { movie, progress };
  }

  if (!entry.season || !entry.episode) return null;
  const show = {
    title: entry.name,
    ids: idsToBody(ids),
  };
  return {
    show,
    episode: {
      title: entry.episodeName,
      season: entry.season,
      number: entry.episode,
    },
    progress,
  };
}

function buildHistoryAddBody(entry: ContinueWatchingEntry) {
  const ids = idsToBody(parseTraktContentIds(entry.id));
  const watchedAt = new Date(entry.updatedAt || Date.now()).toISOString();
  if (entry.type === "movie") {
    if (!ids) return null;
    return {
      movies: [{
        title: entry.name,
        ids,
        watched_at: watchedAt,
      }],
    };
  }

  if (!ids || !entry.season || !entry.episode) return null;
  return {
    shows: [{
      title: entry.name,
      ids,
      seasons: [{
        number: entry.season,
        episodes: [{
          number: entry.episode,
          watched_at: watchedAt,
        }],
      }],
    }],
  };
}

function buildHistoryRemoveBody(entry: ContinueWatchingEntry) {
  const ids = idsToBody(parseTraktContentIds(entry.id));
  if (entry.type === "movie") {
    if (!ids) return null;
    return {
      movies: [{
        title: entry.name,
        ids,
      }],
    };
  }

  if (!ids || !entry.season || !entry.episode) return null;
  return {
    shows: [{
      title: entry.name,
      ids,
      seasons: [{
        number: entry.season,
        episodes: [{
          number: entry.episode,
        }],
      }],
    }],
  };
}

function mapPlaybackMovie(item: TraktPlaybackItem, localByKey: Map<string, ContinueWatchingEntry>) {
  const movie = item.movie;
  const id = normalizeTraktContentId(movie?.ids, movie?.title);
  const progress = normalizeProgress(item.progress);
  if (!movie || !id || progress <= 0) return null;
  return buildRemoteEntry({
    type: "movie",
    id,
    name: movie.title ?? id,
    progress,
    updatedAt: parseTraktDate(item.paused_at),
    playbackId: item.id,
    localByKey,
  });
}

function mapPlaybackEpisode(item: TraktPlaybackItem, localByKey: Map<string, ContinueWatchingEntry>) {
  const show = item.show;
  const episode = item.episode;
  const season = numberOrUndefined(episode?.season);
  const number = numberOrUndefined(episode?.number);
  const id = normalizeTraktContentId(show?.ids, show?.title);
  const progress = normalizeProgress(item.progress);
  if (!show || !episode || !id || !season || !number || progress <= 0) return null;
  return buildRemoteEntry({
    type: "series",
    id,
    name: show.title ?? id,
    season,
    episode: number,
    episodeName: episode.title,
    progress,
    updatedAt: parseTraktDate(item.paused_at),
    playbackId: item.id,
    localByKey,
  });
}

function mapHistoryMovie(item: TraktHistoryMovieItem, localByKey: Map<string, ContinueWatchingEntry>) {
  const movie = item.movie;
  const id = normalizeTraktContentId(movie?.ids, movie?.title);
  if (!movie || !id) return null;
  return buildCompletedRemoteEntry({
    type: "movie",
    id,
    name: movie.title ?? id,
    updatedAt: parseTraktDate(item.watched_at),
    localByKey,
  });
}

function mapHistoryEpisode(item: TraktHistoryEpisodeItem, localByKey: Map<string, ContinueWatchingEntry>) {
  const show = item.show;
  const episode = item.episode;
  const season = numberOrUndefined(episode?.season);
  const number = numberOrUndefined(episode?.number);
  const id = normalizeTraktContentId(show?.ids, show?.title);
  if (!show || !episode || !id || !season || !number) return null;
  return buildCompletedRemoteEntry({
    type: "series",
    id,
    name: show.title ?? id,
    season,
    episode: number,
    episodeName: episode.title,
    updatedAt: parseTraktDate(item.watched_at),
    localByKey,
  });
}

function mapWatchedShows(items: TraktWatchedShowItem[], localByKey: Map<string, ContinueWatchingEntry>) {
  const entries: ContinueWatchingEntry[] = [];
  for (const item of items) {
    const show = item.show;
    const id = normalizeTraktContentId(show?.ids, show?.title);
    if (!show || !id) continue;
    for (const season of item.seasons ?? []) {
      const seasonNumber = numberOrUndefined(season.number);
      if (!seasonNumber || seasonNumber <= 0) continue;
      for (const episode of season.episodes ?? []) {
        const episodeNumber = numberOrUndefined(episode.number);
        if (!episodeNumber || (episode.plays ?? 1) <= 0) continue;
        const entry = buildCompletedRemoteEntry({
          type: "series",
          id,
          name: show.title ?? id,
          season: seasonNumber,
          episode: episodeNumber,
          updatedAt: parseTraktDate(episode.last_watched_at ?? item.last_watched_at),
          localByKey,
        });
        if (entry) entries.push(entry);
      }
    }
  }
  return entries;
}

function buildRemoteEntry(input: {
  type: string;
  id: string;
  name: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  progress: number;
  updatedAt: number;
  playbackId?: number;
  localByKey: Map<string, ContinueWatchingEntry>;
}): ContinueWatchingEntry {
  const query = { type: input.type, id: input.id, season: input.season, episode: input.episode };
  const key = buildContinueWatchingKey(query);
  const local = input.localByKey.get(key);
  const duration = local?.duration && local.duration > 0 ? local.duration : 0;
  const currentTime = duration > 0 ? (input.progress / 100) * duration : 0;
  return {
    key,
    mediaKey: buildMediaKey(input.type, input.id),
    type: input.type,
    id: input.id,
    name: local?.name || input.name,
    logo: local?.logo,
    background: local?.background,
    poster: local?.poster,
    episodeStill: local?.episodeStill,
    season: input.season,
    episode: input.episode,
    episodeName: input.episodeName ?? local?.episodeName,
    currentTime,
    duration,
    remoteProgressPercent: input.progress,
    updatedAt: input.updatedAt,
    completed: input.progress >= COMPLETED_PERCENT,
    source: "trakt",
    traktPlaybackId: input.playbackId,
  };
}

function buildCompletedRemoteEntry(input: {
  type: string;
  id: string;
  name: string;
  season?: number;
  episode?: number;
  episodeName?: string;
  updatedAt: number;
  localByKey: Map<string, ContinueWatchingEntry>;
}): ContinueWatchingEntry {
  const query = { type: input.type, id: input.id, season: input.season, episode: input.episode };
  const key = buildContinueWatchingKey(query);
  const local = input.localByKey.get(key);
  const duration = Math.max(1, local?.duration || local?.currentTime || 1);
  return {
    key,
    mediaKey: buildMediaKey(input.type, input.id),
    type: input.type,
    id: input.id,
    name: local?.name || input.name,
    logo: local?.logo,
    background: local?.background,
    poster: local?.poster,
    episodeStill: local?.episodeStill,
    season: input.season,
    episode: input.episode,
    episodeName: input.episodeName ?? local?.episodeName,
    currentTime: duration,
    duration,
    remoteProgressPercent: 100,
    updatedAt: input.updatedAt,
    completed: true,
    source: "trakt",
  };
}

async function enrichImportedEntries(entries: ContinueWatchingEntry[]) {
  if (!entries.length) return entries;

  const cache = new Map<string, Promise<Partial<ContinueWatchingEntry>>>();
  return Promise.all(entries.map(async entry => {
    if (
      entry.logo &&
      entry.poster &&
      (entry.type === "movie" ? entry.background : entry.episodeStill) &&
      (entry.type === "movie" || entry.episodeName)
    ) return entry;
    const cacheKey = `${entry.type}:${entry.id}:${entry.name}:${entry.season ?? 0}:${entry.episode ?? 0}`;
    let request = cache.get(cacheKey);
    if (!request) {
      request = fetchTmdbArtworkForEntry(entry);
      cache.set(cacheKey, request);
    }
    const artwork: Partial<ContinueWatchingEntry> = await request.catch(error => {
      traktLog("tmdb artwork enrichment failed", { key: entry.key, error: String(error) });
      return {};
    });
    return {
      ...entry,
      name: entry.name || artwork.name || entry.id,
      logo: sanitizeImportedLogo(entry.logo ?? artwork.logo),
      background: entry.background ?? artwork.background,
      poster: entry.poster ?? artwork.poster,
      episodeStill: entry.episodeStill ?? artwork.episodeStill,
      episodeName: entry.episodeName ?? artwork.episodeName,
    };
  }));
}

async function fetchTmdbArtworkForEntry(entry: ContinueWatchingEntry): Promise<Partial<ContinueWatchingEntry>> {
  const tmdbType = entry.type === "movie" ? "movie" : "tv";
  const tmdbId = await resolveTmdbIdForEntry(entry, tmdbType);
  if (!tmdbId) return {};

  const [details, images] = await Promise.all([
    tmdbFetch<{ title?: string; name?: string; backdrop_path?: string; poster_path?: string }>(`/${tmdbType}/${tmdbId}`, { params: { language: "es-ES" } }),
    entry.logo ? Promise.resolve(null) : tmdbFetch<{ logos?: unknown }>(`/${tmdbType}/${tmdbId}/images`, { params: { include_image_language: "es,en,null" } }),
  ]);
  const logoPath = entry.logo ? undefined : pickTmdbLogoPath(images?.logos);
  const episodeDetails = entry.type !== "movie" && entry.season && entry.episode
    ? await fetchTmdbEpisodeDetails(tmdbId, entry.season, entry.episode)
    : null;

  return {
    name: details?.title ?? details?.name ?? entry.name,
    background: entry.type === "movie"
      ? tmdbImage(details?.backdrop_path, "original")
      : tmdbImage(episodeDetails?.still_path, "original"),
    episodeStill: entry.type !== "movie" ? tmdbImage(episodeDetails?.still_path, "original") : undefined,
    poster: tmdbImage(details?.poster_path, "w780"),
    logo: entry.logo ?? sanitizeImportedLogo(tmdbImage(logoPath, "w500")),
    episodeName: episodeDetails?.name ?? entry.episodeName,
  };
}

async function fetchTmdbEpisodeDetails(tmdbId: number, season: number, episode: number) {
  return tmdbFetch(`/tv/${tmdbId}/season/${season}/episode/${episode}`, { params: { language: "es-ES" } });
}

async function buildNewEpisodeEntriesFromWatchedShows(
  items: TraktWatchedShowItem[],
  localByKey: Map<string, ContinueWatchingEntry>,
) {
  if (!items.length) return [];

  const candidates = [...items]
    .sort((a, b) => parseTraktDate(b.last_watched_at) - parseTraktDate(a.last_watched_at))
    .slice(0, 25);
  const entries: ContinueWatchingEntry[] = [];

  for (const item of candidates) {
    const show = item.show;
    const id = normalizeTraktContentId(show?.ids, show?.title);
    if (!show || !id) continue;
    const watched = collectWatchedEpisodes(item);
    if (!watched.latest) continue;

    const tmdbId = await resolveTmdbIdForEntry({
      key: buildMediaKey("series", id),
      mediaKey: buildMediaKey("series", id),
      type: "series",
      id,
      name: show.title ?? id,
      currentTime: 0,
      duration: 0,
      updatedAt: parseTraktDate(item.last_watched_at),
      completed: false,
    }, "tv");
    if (!tmdbId) continue;

    const nextEpisode = await fetchNextAiredEpisode(tmdbId, watched);
    if (!nextEpisode) continue;

    const query = {
      type: "series",
      id,
      season: nextEpisode.season,
      episode: nextEpisode.episode,
    };
    const key = buildContinueWatchingKey(query);
    const local = localByKey.get(key);
    if (local?.completed || (local && progressPercent(local) > 0)) continue;

    const details = nextEpisode.details;
    entries.push({
      key,
      mediaKey: buildMediaKey("series", id),
      type: "series",
      id,
      name: show.title ?? id,
      background: tmdbImage(details?.still_path, "original"),
      episodeStill: tmdbImage(details?.still_path, "original"),
      season: nextEpisode.season,
      episode: nextEpisode.episode,
      episodeName: details?.name,
      currentTime: 0,
      duration: Math.max(1, Number(details?.runtime) * 60 || 1),
      remoteProgressPercent: 0,
      updatedAt: Math.max(parseTraktDate(item.last_watched_at), parseTmdbDate(details?.air_date)),
      completed: false,
      entryKind: nextEpisode.isNew ? "new" : "next",
      source: "trakt",
    });
  }

  return entries;
}

function collectWatchedEpisodes(item: TraktWatchedShowItem) {
  const set = new Set<string>();
  let latest: { season: number; episode: number; watchedAt: number } | null = null;
  for (const season of item.seasons ?? []) {
    const seasonNumber = numberOrUndefined(season.number);
    if (!seasonNumber || seasonNumber <= 0) continue;
    for (const episode of season.episodes ?? []) {
      const episodeNumber = numberOrUndefined(episode.number);
      if (!episodeNumber || (episode.plays ?? 1) <= 0) continue;
      set.add(`${seasonNumber}:${episodeNumber}`);
      const watchedAt = parseTraktDate(episode.last_watched_at ?? item.last_watched_at);
      if (
        !latest ||
        watchedAt > latest.watchedAt ||
        (watchedAt === latest.watchedAt && (seasonNumber > latest.season || (seasonNumber === latest.season && episodeNumber > latest.episode)))
      ) {
        latest = { season: seasonNumber, episode: episodeNumber, watchedAt };
      }
    }
  }
  return { set, latest };
}

async function fetchNextAiredEpisode(
  tmdbId: number,
  watched: { set: Set<string>; latest: { season: number; episode: number; watchedAt: number } | null },
) {
  if (!watched.latest) return null;
  const details = await tmdbFetch<{ seasons?: Array<{ season_number?: number }> }>(`/tv/${tmdbId}`, { params: { language: "es-ES" } });
  if (!details) return null;
  const seasons = (details?.seasons ?? [])
    .map((season: any) => Number(season?.season_number))
    .filter((season: number) => Number.isFinite(season) && season > 0 && season >= watched.latest!.season)
    .sort((a: number, b: number) => a - b);

  const today = Date.now();
  for (const seasonNumber of seasons) {
    const season = await tmdbFetch<{ episodes?: Array<{ episode_number?: number; air_date?: string; name?: string; still_path?: string; runtime?: number }> }>(`/tv/${tmdbId}/season/${seasonNumber}`, { params: { language: "es-ES" } });
    if (!season) continue;
    const episodes = (season?.episodes ?? [])
      .map((episode: any) => ({
        episode: Number(episode?.episode_number),
        details: episode,
      }))
      .filter((episode: { episode: number }) => Number.isFinite(episode.episode) && episode.episode > 0)
      .sort((a: { episode: number }, b: { episode: number }) => a.episode - b.episode);

    for (const episode of episodes) {
      if (seasonNumber < watched.latest.season) continue;
      if (seasonNumber === watched.latest.season && episode.episode <= watched.latest.episode) continue;
      if (watched.set.has(`${seasonNumber}:${episode.episode}`)) continue;
      const airAt = parseTmdbDate(episode.details?.air_date);
      if (!airAt || airAt > today) continue;
      return {
        season: seasonNumber,
        episode: episode.episode,
        details: episode.details,
        isNew: airAt > watched.latest.watchedAt,
      };
    }
  }

  return null;
}

function parseTmdbDate(value: unknown) {
  if (typeof value !== "string" || !value) return 0;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveTmdbIdForEntry(entry: ContinueWatchingEntry, tmdbType: "movie" | "tv") {
  const ids = parseTraktContentIds(entry.id);
  if (ids.tmdb) return ids.tmdb;
  if (ids.imdb) {
    const data = await tmdbFetch<{ movie_results?: Array<{ id?: number }>; tv_results?: Array<{ id?: number }> }>(
      `/find/${encodeURIComponent(ids.imdb)}`,
      { params: { external_source: "imdb_id", language: "es-ES" } },
    );
    if (data) {
      const results = tmdbType === "movie" ? data.movie_results : data.tv_results;
      const id = Number(results?.[0]?.id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }

  const foundByName = await searchTmdbIdByTitle(entry.name, tmdbType);
  if (foundByName) return foundByName;

  if (tmdbType === "movie") {
    const tvFallback = await searchTmdbIdByTitle(entry.name, "tv");
    if (tvFallback) return tvFallback;
  }

  return undefined;
}

async function searchTmdbIdByTitle(title: string, tmdbType: "movie" | "tv") {
  if (!title.trim()) return undefined;
  const searchPath = tmdbType === "movie" ? "search/movie" : "search/tv";
  const queries = titleSearchVariants(title);
  for (const query of queries) {
    for (const language of ["es-ES", "en-US"]) {
      const data = await tmdbFetch<{ results?: Array<{ id?: number }> }>(`/${searchPath}`, { params: { query, language, page: "1" } });
      if (!data) continue;
      const id = Number(data.results?.[0]?.id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  for (const query of queries) {
    for (const language of ["es-ES", "en-US"]) {
      const data = await tmdbFetch<{ results?: Array<{ id?: number; media_type?: string }> }>("/search/multi", { params: { query, language, page: "1" } });
      if (!data) continue;
      const match = (data.results ?? []).find((item: any) => item?.media_type === tmdbType)
        ?? (data.results ?? []).find((item: any) => item?.media_type === "movie" || item?.media_type === "tv");
      const id = Number(match?.id);
      if (Number.isFinite(id) && id > 0) return id;
    }
  }
  return undefined;
}

function titleSearchVariants(title: string) {
  const clean = title
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [
    clean,
    clean.replace(/\s*-\s*/g, " "),
    clean.replace(/:\s*/g, " "),
    clean.replace(/\s*-\s*The Movie\s*:\s*/i, ": "),
    clean.replace(/\s*-\s*The Movie\s*:\s*/i, " "),
    clean.replace(/\s*-\s*The Movie\b/i, ""),
    clean.replace(/\bThe Movie\s*:\s*/i, ""),
    clean.replace(/\bThe Movie\b/ig, ""),
    clean.split(":")[0]?.trim(),
  ];
  return Array.from(new Set(variants.filter(Boolean)));
}

function tmdbImage(path: string | undefined | null, size: "original" | "w780" | "w500") {
  return path ? `${TMDB_IMG_URL}/${size}${path}` : undefined;
}

function pickTmdbLogoPath(logos: unknown) {
  if (!Array.isArray(logos)) return undefined;
  const logo = logos.find((item: any) => item?.iso_639_1 === "es" && typeof item?.file_path === "string")
    ?? logos.find((item: any) => item?.iso_639_1 === "en" && typeof item?.file_path === "string")
    ?? logos.find((item: any) => item?.iso_639_1 === null && typeof item?.file_path === "string")
    ?? logos.find((item: any) => typeof item?.file_path === "string");
  return logo?.file_path;
}

function sanitizeImportedLogo(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() === "live.metahub.space" && parsed.pathname.toLowerCase().startsWith("/logo/")) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return value;
}

function playbackItemMatchesEntry(item: TraktPlaybackItem, entry: ContinueWatchingEntry) {
  const remoteId = entry.type === "movie"
    ? normalizeTraktContentId(item.movie?.ids, item.movie?.title)
    : normalizeTraktContentId(item.show?.ids, item.show?.title);
  if (!idsMatch(remoteId, entry.id)) return false;
  if (entry.type === "movie") return true;
  return item.episode?.season === entry.season && item.episode?.number === entry.episode;
}

function parseTraktContentIds(contentId: string): TraktIds {
  const raw = contentId.trim();
  if (!raw) return {};
  if (raw.startsWith("tt")) return { imdb: raw.split(":")[0] };
  if (raw.toLowerCase().startsWith("tmdb:")) return { tmdb: Number(raw.split(":")[1]) || undefined };
  if (raw.toLowerCase().startsWith("trakt:")) return { trakt: Number(raw.split(":")[1]) || undefined };
  const numeric = Number(raw.split(":")[0]);
  return Number.isFinite(numeric) ? { trakt: numeric } : {};
}

function idsToBody(ids: TraktIds | undefined) {
  if (!ids) return undefined;
  const body: TraktIds = {};
  if (ids.trakt) body.trakt = ids.trakt;
  if (ids.imdb) body.imdb = ids.imdb;
  if (ids.tmdb) body.tmdb = ids.tmdb;
  if (ids.slug) body.slug = ids.slug;
  return Object.keys(body).length ? body : undefined;
}

function normalizeTraktContentId(ids?: TraktIds, fallback?: string) {
  if (ids?.imdb) return ids.imdb;
  if (ids?.tmdb) return `tmdb:${ids.tmdb}`;
  if (ids?.trakt) return `trakt:${ids.trakt}`;
  return fallback?.trim() || "";
}

function idsMatch(remoteId: string, localId: string) {
  if (!remoteId || !localId) return false;
  if (remoteId === localId) return true;
  const remote = parseTraktContentIds(remoteId);
  const local = parseTraktContentIds(localId);
  return Boolean(
    (remote.imdb && remote.imdb === local.imdb) ||
    (remote.tmdb && remote.tmdb === local.tmdb) ||
    (remote.trakt && remote.trakt === local.trakt),
  );
}

function itemKeyForEntry(entry: ContinueWatchingEntry) {
  const ids = parseTraktContentIds(entry.id);
  const identity = ids.imdb ?? ids.tmdb ?? ids.trakt ?? entry.id;
  return entry.type === "movie"
    ? `movie:${identity}`
    : `episode:${identity}:${entry.season ?? 0}:${entry.episode ?? 0}`;
}

function shouldSkipScrobble(action: string, itemKey: string, progress: number) {
  const last = lastScrobbleStamp;
  if (!last) return false;
  if (action === "stop" && last.action === "start" && last.itemKey === itemKey) return false;
  return (
    last.action === action &&
    last.itemKey === itemKey &&
    Date.now() - last.timestamp < SCROBBLE_DEDUP_MS &&
    Math.abs(last.progress - progress) <= SCROBBLE_PROGRESS_WINDOW
  );
}

function readAuthState(): TraktAuthState {
  try {
    const raw = localStorage.getItem(getAuthStorageKey());
    return raw ? JSON.parse(raw) as TraktAuthState : {};
  } catch {
    return {};
  }
}

function writeAuthState(state: TraktAuthState) {
  localStorage.setItem(getAuthStorageKey(), JSON.stringify(state));
}

function saveTokenResponse(
  token: TraktTokenResponse,
  previous: TraktAuthState = readAuthState(),
  redirectUri = previous.redirectUri || REDIRECT_URI,
) {
  writeAuthState({
    ...previous,
    redirectUri,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type,
    createdAt: Number(token.created_at || Math.floor(Date.now() / 1000)),
    expiresIn: Number(token.expires_in || 0),
  });
}

function isAuthenticatedState(state: TraktAuthState) {
  return Boolean(state.accessToken && state.refreshToken);
}

function hasPendingAuthorization(state: TraktAuthState) {
  if (!state.pendingAuthorizationState || !state.pendingAuthorizationStartedAt) return false;
  return Date.now() - state.pendingAuthorizationStartedAt <= AUTHORIZATION_PENDING_TTL_MS;
}

function clearPendingAuthorization(state: TraktAuthState): TraktAuthState {
  const {
    pendingAuthorizationState: _pendingAuthorizationState,
    pendingAuthorizationStartedAt: _pendingAuthorizationStartedAt,
    ...rest
  } = state;
  return rest;
}

function tokenExpiresAtMs(state: TraktAuthState) {
  if (!state.createdAt || !state.expiresIn) return undefined;
  return (state.createdAt + state.expiresIn) * 1000;
}

function isTokenExpiredOrExpiring(state: TraktAuthState) {
  const expiresAt = tokenExpiresAtMs(state);
  if (!expiresAt) return true;
  return Date.now() >= expiresAt - 60_000;
}

function enqueueQueueItem(kind: TraktQueueKind, payload: unknown) {
  const queue = readQueue();
  queue.unshift({
    id: createId(),
    kind,
    payload,
    attempts: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  writeQueue(queue.slice(0, MAX_QUEUE_ITEMS));
  traktLog("queued action", { kind, size: Math.min(queue.length, MAX_QUEUE_ITEMS) });
}

function readQueue(): TraktQueueItem[] {
  try {
    const raw = localStorage.getItem(getQueueStorageKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isQueueItem) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: TraktQueueItem[]) {
  localStorage.setItem(getQueueStorageKey(), JSON.stringify(queue));
}

function writeSyncSnapshot(snapshot: { lastSyncAt: number; imported: number }) {
  localStorage.setItem(getSyncStorageKey(), JSON.stringify(snapshot));
}

function normalizeProgress(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric <= 1 ? numeric * 100 : numeric));
}

function parseTraktDate(value: string | undefined | null) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function numberOrUndefined(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function isQueueItem(value: unknown): value is TraktQueueItem {
  if (!value || typeof value !== "object") return false;
  const item = value as TraktQueueItem;
  return typeof item.id === "string" && typeof item.kind === "string" && typeof item.attempts === "number";
}

function dispatchAuthChanged(detail?: TraktAuthEventDetail) {
  window.dispatchEvent(new CustomEvent<TraktAuthEventDetail | undefined>(TRAKT_AUTH_CHANGED_EVENT, { detail }));
}

function dispatchSyncChanged() {
  window.dispatchEvent(new CustomEvent(TRAKT_SYNC_CHANGED_EVENT));
}

function traktLog(event: string, extra?: Record<string, unknown>) {
  console.info("[AETHERIO:TRAKT]", event, redactForLog(extra ?? {}));
}

function redactForLog(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /token|secret|authorization|api-key/i.test(key) ? "<redacted>" : entry,
    ]),
  );
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createAuthorizationState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function getAuthStorageKey() {
  return getScopedStorageKey(AUTH_STORAGE_KEY);
}

function getQueueStorageKey() {
  return getScopedStorageKey(QUEUE_STORAGE_KEY);
}

function getSyncStorageKey() {
  return getScopedStorageKey(SYNC_STORAGE_KEY);
}

interface TraktTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  created_at: number;
}

interface TraktMedia {
  title?: string;
  ids?: TraktIds;
}

interface TraktEpisode {
  title?: string;
  season?: number;
  number?: number;
  ids?: TraktIds;
}

interface TraktPlaybackItem {
  id?: number;
  progress?: number;
  paused_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
  episode?: TraktEpisode;
}

interface TraktHistoryMovieItem {
  watched_at?: string;
  movie?: TraktMedia;
}

interface TraktHistoryEpisodeItem {
  watched_at?: string;
  show?: TraktMedia;
  episode?: TraktEpisode;
}

interface TraktWatchedShowItem {
  last_watched_at?: string;
  show?: TraktMedia;
  seasons?: Array<{
    number?: number;
    episodes?: Array<{
      number?: number;
      plays?: number;
      last_watched_at?: string;
    }>;
  }>;
}
