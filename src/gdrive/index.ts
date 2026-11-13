import { openExternalUrl } from "../runtime/platform.ts";
import { EXPERIENCE_STORAGE_CHANGED_EVENT } from "../domain/experienceStorage";
import {
  EXPERIENCE_SCOPE_CHANGED_EVENT,
  captureExperienceScope,
  getScopedStorageKey,
} from "../utils/localProfiles";
import { applyContinueWatchingTombstones, mergeRemotePlaybackState, type ContinueWatchingEntry } from "../utils/continueWatching.ts";
import { LIBRARY_CHANGED_EVENT, applyLibraryTombstones, mergeSavedLibraryItems, type SavedLibraryItem } from "../utils/library.ts";

/**
 * Respaldo de la experiencia del usuario en el Google Drive del propio usuario
 * (mismo modelo que CloudRedirect para los saves de Steam: los datos viven en
 * la cuenta del usuario, no en un servidor de Aetherio).
 *
 * - OAuth 2.0 con PKCE por deep link `aetherio://gdrive/callback`; los tokens
 *   se intercambian contra Google directamente desde el cliente (Desktop app).
 * - Los archivos viven en `appDataFolder` (carpeta privada de la app, oculta
 *   para el usuario) con un JSON por clave de experiencia y por
 *   cuenta/perfil: continuar viendo, historial visto y biblioteca guardada.
 * - Sync automático: push con debounce tras cada escritura de experiencia y
 *   pull con fusión al arrancar, al cambiar de perfil y al reconectar.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

const REDIRECT_URI = "aetherio://gdrive/callback";
const AUTH_STORAGE_KEY = "aetherio-gdrive-auth-v1";
const SYNC_META_STORAGE_KEY = "aetherio-gdrive-sync-v1";
const FILE_META_STORAGE_KEY = "aetherio-gdrive-files-v1";
const PROCESSED_CALLBACKS_KEY = "aetherio-gdrive-callbacks-v1";
const AUTHORIZATION_PENDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;
const PUSH_DEBOUNCE_MS = 4000;

// OAuth client IDs are public identifiers (PKCE uses no client secret). Keep
// the project client ID in source so signed release builds work even when
// `.env.local` is not available to the release builder; allow an env override
// for development or alternate deployments.
const GDRIVE_CLIENT_ID = (import.meta.env.VITE_GDRIVE_CLIENT_ID as string | undefined)?.trim()
  || "90295001611-mkht3fim4jvnu7npp16qjnpt5iu0r5lf.apps.googleusercontent.com";

export const GDRIVE_AUTH_CHANGED_EVENT = "aetherio-gdrive-auth-changed";
export const GDRIVE_SYNC_CHANGED_EVENT = "aetherio-gdrive-sync-changed";

/** Claves de experiencia respaldadas en Drive (MVP: continuar viendo + biblioteca). */
const SYNC_KEYS = [
  "aetherio-continue-watching-v1",
  "aetherio-watched-history-v1",
  "aetherio-continue-watching-tombstones-v1",
  "aetherio-saved-library-v1",
  "aetherio-library-tombstones-v1",
] as const;

const LIBRARY_KEY = "aetherio-saved-library-v1";
const CONTINUE_WATCHING_KEY = "aetherio-continue-watching-v1";
const WATCHED_HISTORY_KEY = "aetherio-watched-history-v1";
const LIBRARY_TOMBSTONES_KEY = "aetherio-library-tombstones-v1";
const CONTINUE_WATCHING_TOMBSTONES_KEY = "aetherio-continue-watching-tombstones-v1";
const FILE_NAME_PREFIX = "aetherio__";

interface GoogleDriveAuthState {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  createdAt?: number;
  expiresIn?: number;
  scope?: string;
  pendingAuthorizationState?: string;
  pendingAuthorizationCodeVerifier?: string;
  pendingAuthorizationStartedAt?: number;
}

interface GoogleDriveTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface SyncMeta {
  lastSyncedAt?: number;
  lastError?: string;
}

export interface GoogleDriveSyncSnapshot {
  connected: boolean;
  credentialsConfigured: boolean;
  authorizationPending: boolean;
  syncing: boolean;
  lastSyncedAt?: number;
  lastError?: string;
}

export type GoogleDriveAuthEventDetail =
  | { kind: "connected" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string };

export type GoogleDriveAuthorizationResult =
  | { status: "success" }
  | { status: "ignored" };

function gdriveLog(message: string, detail?: Record<string, unknown>) {
  try { console.info("[AETHERIO:GDRIVE]", message, detail ?? ""); }
  catch { /* el logging nunca rompe el sync */ }
}

// ---------------------------------------------------------------------------
// Estado de autorización (tokens globales de la instalación, no por perfil)
// ---------------------------------------------------------------------------

function readAuthState(): GoogleDriveAuthState {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as GoogleDriveAuthState;
  } catch {
    return {};
  }
}

function writeAuthState(state: GoogleDriveAuthState) {
  try { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state)); }
  catch { // Sin almacenamiento no hay sesión que conservar; la UI lo verá desconectado.
  }
}

function isAuthenticatedState(state: GoogleDriveAuthState) {
  return Boolean(state.accessToken);
}

function hasPendingAuthorization(state: GoogleDriveAuthState) {
  if (!state.pendingAuthorizationState || !state.pendingAuthorizationCodeVerifier) return false;
  const startedAt = state.pendingAuthorizationStartedAt ?? 0;
  return Date.now() - startedAt < AUTHORIZATION_PENDING_TTL_MS;
}

function tokenExpiresAtMs(state: GoogleDriveAuthState) {
  if (!state.createdAt || !state.expiresIn) return null;
  return state.createdAt + state.expiresIn * 1000;
}

function dispatchAuthChanged(detail?: GoogleDriveAuthEventDetail) {
  try {
    window.dispatchEvent(new CustomEvent<GoogleDriveAuthEventDetail | undefined>(GDRIVE_AUTH_CHANGED_EVENT, { detail }));
  } catch { // Un host sin DOM no puede bloquear la desconexión.
  }
}

function dispatchSyncChanged() {
  try {
    window.dispatchEvent(new CustomEvent(GDRIVE_SYNC_CHANGED_EVENT));
  } catch { // Igual que arriba: best-effort.
  }
}

export function getGoogleDriveAuthSnapshot(): GoogleDriveSyncSnapshot {
  const state = readAuthState();
  const meta = readSyncMeta();
  return {
    connected: isAuthenticatedState(state),
    credentialsConfigured: Boolean(GDRIVE_CLIENT_ID),
    authorizationPending: hasPendingAuthorization(state),
    syncing: pullInFlight || pushInFlight,
    lastSyncedAt: meta.lastSyncedAt,
    lastError: meta.lastError,
  };
}

// ---------------------------------------------------------------------------
// Autorización OAuth 2.0 con PKCE
// ---------------------------------------------------------------------------

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function createCodeVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function createCodeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function createAuthorizationState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function startGoogleDriveAuthorization() {
  if (!GDRIVE_CLIENT_ID) {
    throw new Error("Google Drive no esta configurado en esta version de Aetherio.");
  }
  const state = createAuthorizationState();
  const codeVerifier = createCodeVerifier();
  const startedAt = Date.now();
  writeAuthState({
    ...readAuthState(),
    pendingAuthorizationState: state,
    pendingAuthorizationCodeVerifier: codeVerifier,
    pendingAuthorizationStartedAt: startedAt,
  });
  dispatchAuthChanged();

  const authorizationUrl = new URL(AUTH_ENDPOINT);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", GDRIVE_CLIENT_ID);
  authorizationUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authorizationUrl.searchParams.set("scope", DRIVE_SCOPE);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", await createCodeChallenge(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  // `prompt=consent` garantiza recibir refresh_token aunque ya hubiera concesión previa.
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");

  gdriveLog("authorization requested");
  try {
    await openExternalUrl(authorizationUrl.toString());
  } catch (error) {
    gdriveLog("opener failed, falling back to window.open", { error: String(error) });
    window.open(authorizationUrl.toString(), "_blank", "noopener,noreferrer");
  }
  return { authorizationUrl: authorizationUrl.toString(), state, expiresAt: startedAt + AUTHORIZATION_PENDING_TTL_MS };
}

export function isGoogleDriveCallbackUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "aetherio:"
      && url.hostname === "gdrive"
      && url.pathname.replace(/\/$/, "") === "/callback"
    );
  } catch {
    return false;
  }
}

/** Deduplicación de callbacks (reenvíos del deep link al arrancar). */
function hasProcessedCallback(state: string) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROCESSED_CALLBACKS_KEY) || "[]");
    return Array.isArray(stored) && stored.includes(state);
  } catch {
    return false;
  }
}

function markCallbackProcessed(state: string) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(PROCESSED_CALLBACKS_KEY) || "[]");
    const next = Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : [];
    sessionStorage.setItem(PROCESSED_CALLBACKS_KEY, JSON.stringify([state, ...next.filter(value => value !== state)].slice(0, 12)));
  } catch {
    // Best-effort: el deep link llega una vez por autorización en la práctica.
  }
}

export async function completeGoogleDriveAuthorization(callbackUrl: string): Promise<GoogleDriveAuthorizationResult> {
  if (!isGoogleDriveCallbackUrl(callbackUrl)) return { status: "ignored" };
  const url = new URL(callbackUrl);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const error = url.searchParams.get("error");

  if (error) throw new Error(describeGoogleOAuthError(error, url.searchParams.get("error_description")));
  if (!state || !code) return { status: "ignored" };
  if (hasProcessedCallback(state)) return { status: "ignored" };

  const current = readAuthState();
  if (!current.pendingAuthorizationCodeVerifier || current.pendingAuthorizationState !== state) {
    throw new Error("La autorizacion de Google expiro. Vuelve a conectarla desde Ajustes.");
  }
  if ((current.pendingAuthorizationStartedAt ?? 0) + AUTHORIZATION_PENDING_TTL_MS < Date.now()) {
    throw new Error("La autorizacion de Google expiro. Vuelve a conectarla desde Ajustes.");
  }

  const token = await exchangeGoogleToken({
    grantType: "authorization_code",
    code,
    codeVerifier: current.pendingAuthorizationCodeVerifier,
  });
  markCallbackProcessed(state);
  writeAuthState({
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? current.refreshToken,
    tokenType: token.token_type,
    createdAt: Math.floor(Date.now() / 1000),
    expiresIn: token.expires_in,
    scope: token.scope,
  });
  dispatchAuthChanged({ kind: "connected" });
  schedulePull();
  return { status: "success" };
}

export function disconnectGoogleDrive() {
  const state = readAuthState();
  const revokeToken = state.refreshToken ?? state.accessToken;
  if (revokeToken) {
    void fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(revokeToken)}`, { method: "POST" })
      .then(response => gdriveLog("token revoke requested", { ok: response.ok }))
      .catch(error => gdriveLog("token revoke failed", { error: String(error) }));
  }
  try { localStorage.removeItem(AUTH_STORAGE_KEY); } catch { /* ya quedará desconectado */ }
  try { localStorage.removeItem(FILE_META_STORAGE_KEY); } catch { /* se reconstruye al sincronizar */ }
  lastPushedHash.clear();
  clearPushTimer();
  dispatchAuthChanged({ kind: "disconnected" });
}

function describeGoogleOAuthError(error: string, description: string | null) {
  if (error === "access_denied") return "Autorización de Google rechazada.";
  const trimmed = description?.trim();
  return trimmed ? `Google denegó la autorización: ${trimmed}.` : "No se pudo completar la autorización de Google.";
}

async function exchangeGoogleToken(input: { grantType: "authorization_code" | "refresh_token"; code?: string; codeVerifier?: string }) {
  if (!GDRIVE_CLIENT_ID) {
    throw new Error("Google Drive no esta configurado en esta version de Aetherio.");
  }
  const body = new URLSearchParams();
  body.set("client_id", GDRIVE_CLIENT_ID);
  body.set("grant_type", input.grantType);
  if (input.grantType === "authorization_code") {
    body.set("code", input.code ?? "");
    body.set("code_verifier", input.codeVerifier ?? "");
    body.set("redirect_uri", REDIRECT_URI);
  } else {
    const refreshToken = readAuthState().refreshToken ?? "";
    body.set("refresh_token", refreshToken);
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).catch(error => {
    throw new Error(`No se pudo contactar Google OAuth: ${String(error)}`);
  });
  const payload: unknown = await response.json().catch(() => null);
  const token = (payload ?? {}) as GoogleDriveTokenResponse;
  if (!response.ok || !token.access_token) {
    const description = typeof (payload as { error_description?: unknown })?.error_description === "string"
      ? (payload as { error_description: string }).error_description
      : "";
    throw new Error(describeGoogleOAuthError(String((payload as { error?: unknown })?.error ?? response.status), description));
  }
  return token;
}

async function refreshAccessToken() {
  const state = readAuthState();
  if (!state.refreshToken) return false;
  try {
    const token = await exchangeGoogleToken({ grantType: "refresh_token" });
    writeAuthState({
      ...readAuthState(),
      accessToken: token.access_token,
      tokenType: token.token_type,
      createdAt: Math.floor(Date.now() / 1000),
      expiresIn: token.expires_in,
      scope: token.scope ?? state.scope,
    });
    return true;
  } catch (error) {
    gdriveLog("token refresh failed", { error: String(error) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Cliente Drive (appDataFolder)
// ---------------------------------------------------------------------------

async function authorizedDriveFetch(url: string, init?: RequestInit): Promise<Response> {
  const attempt = async () => {
    const state = readAuthState();
    const expiresAt = tokenExpiresAtMs(state);
    if (!state.accessToken) throw new Error("Google Drive no esta conectado.");
    if (expiresAt !== null && expiresAt - Date.now() < TOKEN_EXPIRY_MARGIN_MS) {
      await refreshAccessToken();
    }
    const fresh = readAuthState();
    return fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        authorization: `Bearer ${fresh.accessToken ?? ""}`,
      },
    });
  };

  let response = await attempt();
  if (response.status === 401) {
    if (!await refreshAccessToken()) return response;
    response = await attempt();
  }
  return response;
}

async function requireDriveOk(response: Response, action: string): Promise<Response> {
  if (response.ok) return response;
  const bodyText = await response.text().catch(() => "");
  throw new Error(`Google Drive fallo en ${action} (HTTP ${response.status}). ${bodyText.slice(0, 200)}`);
}

async function listDriveFiles(): Promise<DriveFileMeta[]> {
  const response = await requireDriveOk(
    await authorizedDriveFetch(`${DRIVE_API_BASE}/files?spaces=appDataFolder&pageSize=200&fields=files(id,name,modifiedTime)`),
    "listar archivos",
  );
  const payload: unknown = await response.json().catch(() => null);
  const files = (payload as { files?: unknown })?.files;
  if (!Array.isArray(files)) return [];
  return files
    .filter((file): file is DriveFileMeta => {
      const candidate = file as DriveFileMeta;
      return typeof candidate?.id === "string" && typeof candidate?.name === "string";
    });
}

async function downloadDriveFile(fileId: string): Promise<string> {
  const response = await requireDriveOk(
    await authorizedDriveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`),
    "descargar archivo",
  );
  return response.text();
}

async function createDriveFile(name: string, body: string): Promise<string> {
  const boundary = `aetherio-gdrive-${Date.now().toString(16)}`;
  const multipart = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, parents: ["appDataFolder"] }),
    `--${boundary}`,
    "Content-Type: application/json",
    "",
    body,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  const response = await requireDriveOk(
    await authorizedDriveFetch(`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body: multipart,
    }),
    "crear archivo",
  );
  const payload: unknown = await response.json().catch(() => null);
  const fileId = (payload as { id?: unknown })?.id;
  return typeof fileId === "string" ? fileId : "";
}

async function updateDriveFile(fileId: string, body: string): Promise<boolean> {
  const response = await authorizedDriveFetch(`${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  });
  if (response.status === 404) return false; // El archivo desapareció en Drive: se recreará.
  await requireDriveOk(response, "actualizar archivo");
  return true;
}

// ---------------------------------------------------------------------------
// Nombres de archivo por cuenta/perfil y caché de ids
// ---------------------------------------------------------------------------

function sanitizeSegment(value: string | null) {
  return (value || "nop").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 48) || "nop";
}

function driveFileName(accountScope: string, profileId: string | null, key: string) {
  return `${FILE_NAME_PREFIX}${sanitizeSegment(accountScope)}__${sanitizeSegment(profileId)}__${key}.json`;
}

function isManagedFileName(name: string) {
  return name.startsWith(FILE_NAME_PREFIX) && name.endsWith(".json");
}

function readFileMeta(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILE_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [name, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === "string" && id) result[name] = id;
    }
    return result;
  } catch {
    return {};
  }
}

function writeFileMeta(map: Record<string, string>) {
  try { localStorage.setItem(FILE_META_STORAGE_KEY, JSON.stringify(map)); }
  catch { // Sin caché de ids, el push crea archivos nuevos; el pull los re-deduplica.
  }
}

function rememberFileId(name: string, fileId: string) {
  if (!fileId) return;
  const meta = readFileMeta();
  if (meta[name] === fileId) return;
  meta[name] = fileId;
  writeFileMeta(meta);
}

function forgetFileId(name: string) {
  const meta = readFileMeta();
  if (!(name in meta)) return;
  delete meta[name];
  writeFileMeta(meta);
}

// ---------------------------------------------------------------------------
// Motor de sincronización
// ---------------------------------------------------------------------------

let initialized = false;
let pullInFlight = false;
let pushInFlight = false;
let pushPending = false;
let pushTimer: number | null = null;
let pushConsecutiveFailures = 0;
const PUSH_MAX_AUTO_RETRIES = 5;
const PUSH_RETRY_BACKOFF_MS = 60 * 1000;
const lastPushedHash = new Map<string, string>();

function readSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SyncMeta;
  } catch {
    return {};
  }
}

function writeSyncMeta(meta: SyncMeta) {
  try { localStorage.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(meta)); } catch { /* best-effort */ }
  dispatchSyncChanged();
}

function setSyncMeta(patch: SyncMeta) {
  writeSyncMeta({ ...readSyncMeta(), ...patch });
}

function clearPushTimer() {
  if (pushTimer !== null && typeof window !== "undefined") {
    window.clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/** Registra los listeners del motor (idempotente). Seguro llamarlo al arrancar. */
export function initGoogleDriveSync() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener(EXPERIENCE_STORAGE_CHANGED_EVENT, handleStorageChanged);
  window.addEventListener(EXPERIENCE_SCOPE_CHANGED_EVENT, handleScopeChanged);
  window.addEventListener(LIBRARY_CHANGED_EVENT, handleStorageChanged);
  window.addEventListener(GDRIVE_AUTH_CHANGED_EVENT, handleAuthChanged);
  if (getGoogleDriveAuthSnapshot().connected) schedulePull();
  gdriveLog("sync engine initialized");
}

function handleStorageChanged() {
  if (!isAuthenticatedState(readAuthState())) return;
  schedulePush();
}

function handleScopeChanged() {
  // Otro perfil: el conjunto de archivos remotos es distinto y el push debe
  // recomputar hashes para no saltarse subidas del perfil nuevo.
  lastPushedHash.clear();
  schedulePull();
}

function handleAuthChanged(event: Event) {
  const detail = (event as CustomEvent<GoogleDriveAuthEventDetail | undefined>).detail;
  if (detail?.kind === "connected") {
    pushConsecutiveFailures = 0;
    schedulePull();
  }
  if (detail?.kind === "disconnected") {
    clearPushTimer();
    pushPending = false;
    pushConsecutiveFailures = 0;
    lastPushedHash.clear();
  }
}

function schedulePush(delayMs = PUSH_DEBOUNCE_MS) {
  if (typeof window === "undefined") return;
  clearPushTimer();
  pushTimer = window.setTimeout(() => {
    pushTimer = null;
    void pushGoogleDriveNow();
  }, delayMs);
}

function schedulePull() {
  void pullGoogleDriveNow();
}

/** Manual ("Sincronizar ahora") y arranque: baja el remoto, fusiona y empuja. */
export async function syncGoogleDriveNow() {
  await pullGoogleDriveNow();
  await pushGoogleDriveNow();
}

export async function pullGoogleDriveNow() {
  if (!isAuthenticatedState(readAuthState())) return;
  if (pullInFlight) return;
  pullInFlight = true;
  try {
    const scope = captureExperienceScope();
    const files = (await listDriveFiles()).filter(file => isManagedFileName(file.name));

    const meta = readFileMeta();
    for (const [name, id] of Object.entries(meta)) {
      if (!files.some(file => file.name === name && file.id === id)) delete meta[name];
    }
    for (const file of files) meta[file.name] = file.id;
    writeFileMeta(meta);

    for (const key of SYNC_KEYS) {
      const candidates = files
        .filter(file => file.name === driveFileName(scope.accountScope, scope.profileId, key))
        .sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""));
      const newest = candidates[0];
      if (!newest) continue;
      try {
        applyRemoteKey(key, await downloadDriveFile(newest.id));
      } catch (error) {
        gdriveLog("download failed", { key, error: String(error) });
      }
    }
    setSyncMeta({ lastSyncedAt: Date.now(), lastError: undefined });
    // Converge: el estado fusionado local vuelve a Drive (no crea bucle, el
    // push no escribe en el almacenamiento de experiencia).
    schedulePush();
  } catch (error) {
    const message = describeUnknownDriveError(error, "No se pudo descargar el respaldo de Google Drive.");
    gdriveLog("pull failed", { error: message });
    setSyncMeta({ lastError: message });
  } finally {
    pullInFlight = false;
  }
}

export async function pushGoogleDriveNow() {
  if (!isAuthenticatedState(readAuthState())) return;
  if (pushInFlight) {
    pushPending = true;
    return;
  }
  pushInFlight = true;
  try {
    const scope = captureExperienceScope();
    for (const key of SYNC_KEYS) {
      const raw = localStorage.getItem(getScopedStorageKey(key));
      // Sin datos locales no se borra Drive: un cliente recién instalado no
      // debe vaciar el respaldo hasta que el pull haya fusionado y escrito.
      if (raw === null) continue;
      const name = driveFileName(scope.accountScope, scope.profileId, key);
      const hash = fnv1a(raw);
      if (lastPushedHash.get(name) === hash) continue;

      const cachedId = readFileMeta()[name];
      let fileId = "";
      if (cachedId) {
        if (await updateDriveFile(cachedId, raw)) fileId = cachedId;
        else forgetFileId(name); // El archivo desapareció en Drive: se recrea abajo.
      }
      if (!fileId) {
        fileId = await createDriveFile(name, raw);
        rememberFileId(name, fileId);
      }
      lastPushedHash.set(name, hash);
    }
    setSyncMeta({ lastSyncedAt: Date.now(), lastError: undefined });
    pushConsecutiveFailures = 0;
  } catch (error) {
    const message = describeUnknownDriveError(error, "No se pudo subir el respaldo a Google Drive.");
    gdriveLog("push failed", { error: message });
    setSyncMeta({ lastError: message });
    // Reintento automático con tope; tras varios fallos seguidos solo el push
    // manual ("Sincronizar ahora") o una nueva escritura local reintentan.
    pushConsecutiveFailures += 1;
    if (pushConsecutiveFailures < PUSH_MAX_AUTO_RETRIES) {
      schedulePush(pushConsecutiveFailures >= 2 ? PUSH_RETRY_BACKOFF_MS : PUSH_DEBOUNCE_MS);
    }
  } finally {
    pushInFlight = false;
    if (pushPending) {
      pushPending = false;
      schedulePush();
    }
  }
}

function applyRemoteKey(key: string, raw: string) {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(parsed) && typeof parsed !== "object") return;
  // El orden importa: primero los datos, después sus lápidas (que recortan lo
  // fusionado). Los tombstones llegan como { version, tombstones: [...] }.
  if (key === LIBRARY_KEY) {
    if (Array.isArray(parsed)) mergeSavedLibraryItems(parsed as SavedLibraryItem[]);
    return;
  }
  if (key === LIBRARY_TOMBSTONES_KEY) {
    applyLibraryTombstones((parsed as { tombstones?: unknown })?.tombstones);
    return;
  }
  if (key === CONTINUE_WATCHING_KEY || key === WATCHED_HISTORY_KEY) {
    if (!Array.isArray(parsed)) return;
    const entries = parsed as ContinueWatchingEntry[];
    mergeRemotePlaybackState(key === CONTINUE_WATCHING_KEY ? { progress: entries } : { history: entries });
    return;
  }
  if (key === CONTINUE_WATCHING_TOMBSTONES_KEY) {
    applyContinueWatchingTombstones((parsed as { tombstones?: unknown })?.tombstones);
  }
}

function describeUnknownDriveError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
