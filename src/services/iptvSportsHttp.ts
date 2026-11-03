import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import type { LiveSource } from "../types/liveSports.ts";

const MAX_DOWNLOAD = 8 * 1024 * 1024;
export const MAX_IPTV_TEXT = 16 * 1024 * 1024;
export const IPTV_SOURCE_VERIFICATION_TTL_MS = 55_000;
const TIMEOUT_MS = 12_000;

/** No files, credentials, private networks, numeric host tricks or executable URLs. */
export function publicIptvUrl(value: unknown, base?: string): URL | null {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || host.includes(":")) return null;
    if (!host.includes(".") || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host)) return null;
    if (/^[\d.]+$/.test(host)) {
      const octets = host.split(".").map(Number);
      if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      const [a, b] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
        || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19)) return null;
    }
    url.hash = "";
    return url;
  } catch { return null; }
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("La lista o guía supera el tamaño permitido."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function fetchIptvBytes(value: string, headers: Record<string, string> = {}, limit = MAX_DOWNLOAD): Promise<Uint8Array> {
  const url = publicIptvUrl(value);
  if (!url) throw new Error("Usa una URL HTTP o HTTPS pública, sin usuario ni contraseña.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("La fuente IPTV ha tardado demasiado en responder.")); }, TIMEOUT_MS);
  });
  const request = async () => {
    // Never accept arbitrary M3U-provided Authorization, Cookie, Host, etc.
    const safeHeaders: Record<string, string> = { Accept: "*/*" };
    for (const key of ["Referer", "User-Agent", "Range"]) {
      const value = headers[key];
      if (value && value.length <= 1024 && !/[\r\n\u0000]/.test(value)) safeHeaders[key] = value;
    }
    if (isTauriRuntime()) {
      const response = await invokeCommand<{ status: number; url?: string; bodyBase64: string }>("provider_http_request", {
        request: { url: url.href, method: "GET", headers: safeHeaders },
      });
      if (!response || response.status < 200 || response.status >= 300 || response.url && !publicIptvUrl(response.url)) throw new Error("No se pudo descargar la fuente IPTV.");
      if (typeof response.bodyBase64 !== "string" || response.bodyBase64.length > Math.ceil(limit / 3) * 4 + 4) throw new Error("La respuesta IPTV no es válida o es demasiado grande.");
      const binary = atob(response.bodyBase64);
      if (binary.length > limit) throw new Error("La respuesta IPTV es demasiado grande.");
      return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    const response = await fetch(url.href, { headers: safeHeaders, credentials: "omit", signal: controller.signal });
    if (!response.ok || response.url && !publicIptvUrl(response.url)) throw new Error("No se pudo descargar la fuente IPTV.");
    if (Number(response.headers.get("content-length")) > limit || !response.body) throw new Error("La respuesta IPTV no es válida o es demasiado grande.");
    return readBounded(response.body, limit);
  };
  try { return await Promise.race([request(), timeout]); }
  finally { clearTimeout(timer); }
}

export async function fetchIptvText(url: string): Promise<string> {
  let bytes = await fetchIptvBytes(url);
  // Some guides are gzip files even when their path ends in .xml.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([new Uint8Array(bytes).buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    bytes = await readBounded(stream, MAX_IPTV_TEXT);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** A valid manifest alone does not prove that its live media is accessible. */
export async function probeIptvSource(source: LiveSource): Promise<boolean> {
  try {
    const initial = publicIptvUrl(source.url);
    if (!initial) return false;
    let url: URL = initial;
    for (let hop = 0; hop < 3; hop++) {
      const body: string = new TextDecoder().decode(await fetchIptvBytes(url.href, source.headers, 512 * 1024)).trimStart();
      if (!body.startsWith("#EXTM3U") || /#EXT-X-ENDLIST|skd:\/\/|widevine|SAMPLE-AES|KEYFORMAT=/i.test(body)) return false;
      const uri = body.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith("#"));
      const next: URL | null = uri ? publicIptvUrl(uri, url.href) : null;
      if (!next) return false;
      if (body.includes("#EXT-X-STREAM-INF")) { url = next; continue; }
      if (!body.includes("#EXTINF")) return false;
      const bytes = await fetchIptvBytes(next.href, { ...source.headers, Range: "bytes=0-1023" }, 2 * 1024 * 1024);
      if ([0, 4].some(offset => bytes[offset] === 0x47 && bytes[offset + (offset ? 192 : 188)] === 0x47 && bytes[offset + (offset ? 384 : 376)] === 0x47)) return true;
      return bytes.length >= 8 && ["ftyp", "styp", "moof", "sidx"].includes(new TextDecoder().decode(bytes.slice(4, 8)));
    }
  } catch { /* A failed channel never hides an addon's working sources. */ }
  return false;
}
