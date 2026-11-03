import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";

export const SPORTS_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Only public HTTPS destinations; player metadata cannot introduce local URLs. */
export function publicSportsHttps(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 4096 || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".")) return null;
    if (/^[\d.]+$/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export async function fetchSportsBody(url: string, headers: Record<string, string> = {}): Promise<Uint8Array | null> {
  if (!publicSportsHttps(url)) return null;
  const requestHeaders = { Accept: "*/*", ...headers };
  try {
    if (isTauriRuntime()) {
      const response = await invokeCommand<{ status: number; url?: string; bodyBase64: string }>("provider_http_request", {
        request: { url, method: "GET", headers: { ...requestHeaders, "User-Agent": SPORTS_USER_AGENT } },
      });
      if (!response || response.status < 200 || response.status >= 300 || typeof response.bodyBase64 !== "string" || response.bodyBase64.length > MAX_BODY_BYTES * 1.4) return null;
      if (response.url && new URL(response.url).origin !== new URL(url).origin) return null;
      const bytes = Uint8Array.from(atob(response.bodyBase64), character => character.charCodeAt(0));
      return bytes.length <= MAX_BODY_BYTES ? bytes : null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { headers: requestHeaders, signal: controller.signal, credentials: "omit" });
      if (!response.ok || (response.url && new URL(response.url).origin !== new URL(url).origin)) return null;
      if (Number(response.headers.get("content-length")) > MAX_BODY_BYTES) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length <= MAX_BODY_BYTES ? bytes : null;
    } finally { clearTimeout(timer); }
  } catch { return null; }
}

export async function fetchSportsText(url: string, referer?: string): Promise<string | null> {
  const bytes = await fetchSportsBody(url, referer ? { Referer: referer } : {});
  return bytes ? new TextDecoder().decode(bytes) : null;
}
