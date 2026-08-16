import { invokeCommand, isAndroidRuntime, isTauriRuntime } from "../runtime/platform";

export type SecureCredentialKey = "account-session" | "anilist-access-token";

const CREDENTIAL_STORE_ERROR_MESSAGE =
  "No se pudo acceder al almacén seguro de Windows. Abre Aetherio desde tu sesión normal de usuario e inténtalo de nuevo.";

function usesWindowsCredentialManager() {
  return isTauriRuntime()
    && !isAndroidRuntime()
    && typeof navigator !== "undefined"
    && /windows/i.test(navigator.userAgent);
}

async function invokeCredential<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invokeCommand<T>(command, args);
  } catch {
    throw new Error(CREDENTIAL_STORE_ERROR_MESSAGE);
  }
}

export async function readSecureCredential(key: SecureCredentialKey, legacyStorageKey: string) {
  if (!usesWindowsCredentialManager()) {
    return localStorage.getItem(legacyStorageKey)?.trim() || null;
  }

  const stored = await invokeCredential<string | null>("secure_credential_get", { key });
  if (stored?.trim()) {
    localStorage.removeItem(legacyStorageKey);
    return stored.trim();
  }

  const legacy = localStorage.getItem(legacyStorageKey)?.trim();
  if (!legacy) return null;
  await invokeCredential<void>("secure_credential_set", { key, value: legacy });
  localStorage.removeItem(legacyStorageKey);
  return legacy;
}

export async function writeSecureCredential(
  key: SecureCredentialKey,
  legacyStorageKey: string,
  value: string,
) {
  if (!usesWindowsCredentialManager()) {
    localStorage.setItem(legacyStorageKey, value);
    return;
  }
  await invokeCredential<void>("secure_credential_set", { key, value });
  localStorage.removeItem(legacyStorageKey);
}

export async function deleteSecureCredential(key: SecureCredentialKey, legacyStorageKey: string) {
  if (usesWindowsCredentialManager()) {
    await invokeCredential<void>("secure_credential_delete", { key });
  }
  localStorage.removeItem(legacyStorageKey);
}