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
  ?? "https://aetherio.aetherio.workers.dev";
const TOKEN_KEY = "aetherio-account-token-v1";
const USER_KEY = "aetherio-account-user-v1";

export const AETHERIO_AUTH_CHANGED_EVENT = "aetherio-auth-changed";

export async function registerAccount(input: {
  displayName: string;
  email: string;
  password: string;
}) {
  const response = await authRequest<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  persistAuth(response);
  return response.user;
}

export async function loginAccount(email: string, password: string) {
  const response = await authRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  persistAuth(response);
  return response.user;
}

export async function restoreAccountSession(): Promise<AetherioUser | null> {
  const token = getAccountToken();
  if (!token) return null;

  try {
    const response = await authRequest<{ user: AetherioUser }>("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    localStorage.setItem(USER_KEY, JSON.stringify(response.user));
    return response.user;
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      clearStoredAuth();
      return null;
    }
    return getStoredAccount();
  }
}

export async function logoutAccount() {
  const token = getAccountToken();
  clearStoredAuth();
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

function getAccountToken() {
  return localStorage.getItem(TOKEN_KEY)?.trim() || null;
}

function persistAuth(response: AuthResponse) {
  localStorage.setItem(TOKEN_KEY, response.token);
  localStorage.setItem(USER_KEY, JSON.stringify(response.user));
  window.dispatchEvent(new CustomEvent(AETHERIO_AUTH_CHANGED_EVENT, {
    detail: response.user,
  }));
}

function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
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
