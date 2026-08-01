import { openExternalUrl } from "../runtime/platform";
import {
  deleteSecureCredential,
  readSecureCredential,
  writeSecureCredential,
} from "./secureCredentialStore";

export interface AetherioUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
}

interface AuthResponse {
  token: string;
  user: AetherioUser;
}

const API_BASE = import.meta.env.VITE_AETHERIO_API_URL?.replace(/\/$/, "")
  ?? "https://trkll.aetherio.workers.dev";
const TOKEN_KEY = "aetherio-account-token-v1";
const USER_KEY = "aetherio-account-user-v1";
const LOCAL_MODE_KEY = "aetherio-local-mode-v1";
const ANILIST_TOKEN_KEY = "aetherio-anilist-access-token-v1";
const ANILIST_TOKEN_EXPIRES_KEY = "aetherio-anilist-token-expires-v1";
const PASSWORD_ITERATIONS = 600_000;

export const AETHERIO_AUTH_CHANGED_EVENT = "aetherio-auth-changed";
export type OAuthProvider = "google" | "anilist";

export async function registerAccount(input: {
  displayName: string;
  email: string;
  password: string;
}) {
  const passwordSalt = randomBase64(16);
  const passwordProof = await derivePasswordProof(input.password, passwordSalt, PASSWORD_ITERATIONS);
  const response = await authRequest<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      displayName: input.displayName,
      email: input.email,
      passwordProof,
      passwordSalt,
      passwordIterations: PASSWORD_ITERATIONS,
    }),
  });
  await persistAuth(response);
  return response.user;
}

export async function loginAccount(email: string, password: string) {
  const parameters = await authRequest<{ passwordSalt: string; passwordIterations: number }>(
    "/api/auth/password-parameters",
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
  const passwordProof = await derivePasswordProof(
    password,
    parameters.passwordSalt,
    parameters.passwordIterations,
  );
  const response = await authRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, passwordProof }),
  });
  await persistAuth(response);
  return response.user;
}

export async function restoreAccountSession(): Promise<AetherioUser | null> {
  const token = await getAccountToken();
  if (!token) return null;

  try {
    const response = await authRequest<{ user: AetherioUser }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
    return response.user;
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      await clearStoredAuth();
      return null;
    }
    return getStoredAccount();
  }
}

export async function logoutAccount() {
  const token = await getAccountToken();
  await clearStoredAuth();
  window.dispatchEvent(new CustomEvent(AETHERIO_AUTH_CHANGED_EVENT));
  if (!token) return;
  try {
    await authRequest<void>("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Local logout remains authoritative when the network is unavailable.
  }
}

export async function getOAuthProviders() {
  return authRequest<Record<OAuthProvider, boolean>>("/api/auth/providers");
}

export async function startSocialLogin(provider: OAuthProvider) {
  const startUrl = new URL(`${API_BASE}/api/auth/oauth/${provider}/start`);
  startUrl.searchParams.set("return_to", "aetherio://auth/callback");
  startUrl.searchParams.set("request_id", crypto.randomUUID());
  await openExternalUrl(startUrl.toString());
}

export async function connectAniListAccount() {
  await startSocialLogin("anilist");
}

export function isOAuthCallbackUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "aetherio:"
      && url.hostname === "auth"
      && url.pathname.replace(/\/$/, "") === "/callback";
  } catch {
    return false;
  }
}

export async function completeOAuthAuthorization(rawUrl: string) {
  const url = new URL(rawUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const aniListToken = fragment.get("access_token")?.trim();
  if (aniListToken) {
    const viewerResponse = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aniListToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: "query { Viewer { id name } }" }),
    });
    const viewerPayload = await viewerResponse.json() as {
      data?: { Viewer?: { id?: number; name?: string } };
      errors?: Array<{ message?: string }>;
    };
    const viewer = viewerPayload.data?.Viewer;
    if (!viewerResponse.ok || viewerPayload.errors?.length || !viewer?.id || !viewer.name) {
      throw new Error(viewerPayload.errors?.[0]?.message || "AniList no devolvió una identidad válida.");
    }
    const existingToken = await getAccountToken();
    const response = await authRequest<AuthResponse>("/api/auth/oauth/anilist/session", {
      method: "POST",
      headers: existingToken ? { Authorization: `Bearer ${existingToken}` } : undefined,
      body: JSON.stringify({ accessToken: aniListToken, viewer }),
    });
    await writeSecureCredential("anilist-access-token", ANILIST_TOKEN_KEY, aniListToken);
    const expiresIn = Number(fragment.get("expires_in"));
    const expiresAt = Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 365 * 24 * 60 * 60) * 1000;
    localStorage.setItem(ANILIST_TOKEN_EXPIRES_KEY, String(expiresAt));
    await persistAuth(response);
    return response.user;
  }

  const providerError = url.searchParams.get("error");
  if (providerError) {
    const messages: Record<string, string> = {
      access_denied: "Cancelaste el inicio de sesión.",
      email_not_verified: "El proveedor no confirmó tu correo electrónico.",
      provider_failed: "El proveedor no pudo completar el inicio de sesión.",
      missing_code: "El proveedor no devolvió un código de acceso.",
    };
    throw new Error(messages[providerError] ?? "No se pudo completar el inicio de sesión social.");
  }
  const code = url.searchParams.get("code")?.trim();
  if (!code) throw new Error("El acceso social no devolvió un código válido.");
  const response = await authRequest<AuthResponse>("/api/auth/oauth/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  await persistAuth(response);
  return response.user;
}

export async function continueLocally() {
  localStorage.setItem(LOCAL_MODE_KEY, "1");
  await clearStoredAuth();
  window.dispatchEvent(new CustomEvent(AETHERIO_AUTH_CHANGED_EVENT));
}

export function leaveLocalMode() {
  localStorage.removeItem(LOCAL_MODE_KEY);
  window.dispatchEvent(new CustomEvent(AETHERIO_AUTH_CHANGED_EVENT));
}

export function isLocalModeEnabled() {
  return localStorage.getItem(LOCAL_MODE_KEY) === "1";
}

export function getStoredAccount(): AetherioUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as Partial<AetherioUser>;
    if (!user.id || !user.email || !user.displayName) return null;
    return user as AetherioUser;
  } catch {
    return null;
  }
}

export async function getAccountToken() {
  return readSecureCredential("account-session", TOKEN_KEY);
}

export async function getAniListAccessToken() {
  const token = await readSecureCredential("anilist-access-token", ANILIST_TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(ANILIST_TOKEN_EXPIRES_KEY));
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    if (token) await deleteSecureCredential("anilist-access-token", ANILIST_TOKEN_KEY);
    return null;
  }
  return token;
}

export async function authenticatedRequest<T>(path: string, init: RequestInit = {}) {
  const token = await getAccountToken();
  if (!token) throw new Error("Inicia sesión en Aetherio para sincronizar tu cuenta.");
  return authRequest<T>(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
}

async function persistAuth(response: AuthResponse) {
  localStorage.removeItem(LOCAL_MODE_KEY);
  await writeSecureCredential("account-session", TOKEN_KEY, response.token);
  localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  window.dispatchEvent(new CustomEvent(AETHERIO_AUTH_CHANGED_EVENT, {
    detail: response.user,
  }));
}

async function clearStoredAuth() {
  await Promise.all([
    deleteSecureCredential("account-session", TOKEN_KEY),
    deleteSecureCredential("anilist-access-token", ANILIST_TOKEN_KEY),
  ]);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ANILIST_TOKEN_EXPIRES_KEY);
}

async function derivePasswordProof(password: string, saltBase64: string, iterations: number) {
  if (
    password.length < 10
    || password.length > 128
    || !Number.isSafeInteger(iterations)
    || iterations !== PASSWORD_ITERATIONS
  ) {
    throw new Error("Los parámetros de seguridad de la contraseña no son válidos.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64ToBytes(saltBase64),
      iterations,
    },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function randomBase64(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  } catch {
    throw new Error("Los parámetros de seguridad de la contraseña no son válidos.");
  }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new Error("No se pudo conectar con Aetherio. Revisa tu conexión.");
  }

  if (!response.ok) {
    let message = "No se pudo completar la solicitud.";
    try {
      const payload = await response.json() as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // Preserve the generic message for non-JSON responses.
    }
    throw new AuthRequestError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

class AuthRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
