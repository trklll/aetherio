const BLOCKED_METAHUB_LOGO_HOSTS = new Set(["live.metahub.space"]);

export function sanitizeLogoUrl(url?: string | null) {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) return undefined;
  if (value.toLowerCase().startsWith("live.metahub.space/logo/")) return undefined;

  try {
    const parsed = new URL(value, "https://aetherio.local");
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (BLOCKED_METAHUB_LOGO_HOSTS.has(host) && path.startsWith("/logo/")) return undefined;
  } catch {
    return undefined;
  }

  return value;
}

export function readCachedLogo(key: string) {
  const value = sanitizeLogoUrl(sessionStorage.getItem(key));
  if (!value) sessionStorage.removeItem(key);
  return value ?? null;
}

export function writeCachedLogo(key: string, url?: string | null) {
  const value = sanitizeLogoUrl(url);
  if (!value) {
    sessionStorage.removeItem(key);
    return undefined;
  }
  sessionStorage.setItem(key, value);
  return value;
}
