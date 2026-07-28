import { invokeCommand, isAndroidRuntime, isTauriRuntime } from "../runtime/platform";

export type SecureCredentialKey = "account-session" | "anilist-access-token";

function usesWindowsCredentialManager() {
  return isTauriRuntime()
    && !isAndroidRuntime()
    && typeof navigator !== "undefined"
    && /windows/i.test(navigator.userAgent);
}

export async function readSecureCredential(key: SecureCredentialKey, legacyStorageKey: string) {
  if (!usesWindowsCredentialManager()) {
    return localStorage.getItem(legacyStorageKey)?.trim() || null;
  }

  const stored = await invokeCommand<string | null>("secure_credential_get", { key });
  if (stored?.trim()) {
    localStorage.removeItem(legacyStorageKey);
    return stored.trim();
  }

  const legacy = localStorage.getItem(legacyStorageKey)?.trim();
  if (!legacy) return null;
  await invokeCommand<void>("secure_credential_set", { key, value: legacy });
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
  await invokeCommand<void>("secure_credential_set", { key, value });
  localStorage.removeItem(legacyStorageKey);
}

export async function deleteSecureCredential(key: SecureCredentialKey, legacyStorageKey: string) {
  if (usesWindowsCredentialManager()) {
    await invokeCommand<void>("secure_credential_delete", { key });
  }
  localStorage.removeItem(legacyStorageKey);
}
