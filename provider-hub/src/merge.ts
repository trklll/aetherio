import type { MediaStream, ProviderRecord } from "./types.ts";

const MOBILE_STREAMS_LIMIT = 200;
const MOBILE_NAME_LIMIT = 120;
const MOBILE_DESCRIPTION_LIMIT = 600;

function stripControls(value: string): string {
  let output = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || code === 0xfeff) continue;
    output += character;
  }
  return output;
}

function sanitize(value: unknown, limit: number): string {
  return stripControls(String(value ?? "")).trim().slice(0, limit);
}

function inferMime(raw: MediaStream): string | undefined {
  const declared = String((raw as { mimeType?: unknown }).mimeType ?? "").toLowerCase();
  if (declared.includes("mpegurl") && !declared.includes("audio")) return "application/vnd.apple.mpegurl";
  if (declared === "application/dash+xml") return "application/dash+xml";
  try {
    const path = (new URL(raw.url ?? "").pathname || "").toLowerCase();
    if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
    if (path.endsWith(".mpd")) return "application/dash+xml";
  } catch {
    // url ya validada fuera de esta función
  }
  return undefined;
}

function requiresHeaders(raw: MediaStream): boolean {
  const hints = (raw.behaviorHints ?? {}) as Record<string, unknown>;
  if (raw.headers && Object.keys(raw.headers).length > 0) return true;
  if (hints.headers && Object.keys(hints.headers as object).length > 0) return true;
  if (hints.requestHeaders && Object.keys(hints.requestHeaders as object).length > 0) return true;
  const proxy = hints.proxyHeaders as { request?: Record<string, string> } | undefined;
  return Boolean(proxy?.request && Object.keys(proxy.request).length > 0);
}

function hasDisallowed(raw: MediaStream): boolean {
  return raw.externalUrl !== undefined || raw.ytId !== undefined || raw.infoHash !== undefined;
}

function isDirectHttps(raw: MediaStream): boolean {
  if (typeof raw.url !== "string" || raw.url.length === 0) return false;
  try {
    const url = new URL(raw.url);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export interface MergedStreams {
  desktop: MediaStream[];
  mobile: MediaStream[];
}

/**
 * Filtra y adapta los streams crudos de un proveedor:
 * - desktop: passthrough (el escritorio normaliza por su cuenta), solo objetos http(s).
 * - mobile: exige URL https directa y sin cabeceras privadas (protocolo del móvil).
 */
export function mergeProviderStreams(record: ProviderRecord, raws: MediaStream[]): MergedStreams {
  const desktop: MediaStream[] = [];
  const mobile: MediaStream[] = [];
  const seenMobileUrls = new Set<string>();

  for (const raw of Array.isArray(raws) ? raws.slice(0, 24) : []) {
    if (!raw || typeof raw !== "object") continue;
    desktop.push(raw);

    if (!isDirectHttps(raw) || hasDisallowed(raw)) continue;
    if (requiresHeaders(raw) && record.mobileHeaders === "drop") continue;

    const url = raw.url!.slice(0, 2048);
    if (seenMobileUrls.has(url)) continue;
    seenMobileUrls.add(url);

    const mobileStream: MediaStream = {
      name: sanitize(raw.name || record.name, MOBILE_NAME_LIMIT) || sanitize(record.name, MOBILE_NAME_LIMIT),
      description: sanitize(raw.description || raw.title, MOBILE_DESCRIPTION_LIMIT),
      url,
    };
    const mime = inferMime(raw);
    if (mime) (mobileStream as { mimeType?: string }).mimeType = mime;
    mobile.push(mobileStream);
    if (mobile.length >= MOBILE_STREAMS_LIMIT) break;
  }

  return { desktop, mobile };
}
