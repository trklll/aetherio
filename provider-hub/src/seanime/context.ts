import type { CompatContext, CompatResponse, SeanimeMetadata } from "./adapter.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REQUESTS = 24;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Literal/local hosts and credentials must never come from scraped embed URLs. */
export function publicUrl(value: unknown): URL {
  const url = new URL(String(value));
  if (!/^https?:$/.test(url.protocol) || url.username || url.password
    || !url.hostname.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
    || /[\[\]:]/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|invalid|test|home|lan)$/.test(url.hostname)
    || /(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me)$/.test(url.hostname)) {
    throw new Error("URL pública http(s) requerida");
  }
  return url;
}

async function readBytes(response: Response, account: (size: number) => void): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > MAX_BODY_BYTES) throw new Error("Respuesta Seanime demasiado grande");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error("Respuesta Seanime demasiado grande");
      account(chunk.value.byteLength);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function cookieValues(headers: Headers): string[] {
  const compatible = headers as Headers & { getSetCookie?: () => string[]; getAll?: (name: string) => string[] };
  if (compatible.getSetCookie) return compatible.getSetCookie();
  if (compatible.getAll) return compatible.getAll("Set-Cookie");
  return (headers.get("set-cookie") ?? "").split(/,\s*(?=[^=;,\s]+=)/).filter(Boolean);
}

export function createContext(meta: SeanimeMetadata, dependencies: Record<string, any>, signal: AbortSignal): CompatContext {
  // Nothing here survives the invocation: no cookies, pending I/O or mutable
  // provider state is shared between requests in a Cloudflare isolate.
  const store = new Map<string, unknown>();
  const jar = new Map<string, Map<string, { value: string; path: string; secure: boolean }>>();
  const requests = new Map<string, Promise<CompatResponse>>();
  let count = 0;
  let totalBytes = 0;
  const config = meta.config ?? {};
  const networkFetch = fetch;

  async function request(input: string, options: Record<string, any> = {}, hops = 0): Promise<CompatResponse> {
    if (signal.aborted) throw new Error("Seanime: tiempo agotado");
    const url = publicUrl(input);
    const headers = new Headers(options.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    const cookies = jar.get(url.hostname);
    const headerCookies = [...(cookies ?? [])].filter(([, cookie]) =>
      url.pathname.startsWith(cookie.path) && (!cookie.secure || url.protocol === "https:"))
      .map(([name, cookie]) => `${name}=${cookie.value}`).join("; ");
    if (headerCookies && !headers.has("cookie")) headers.set("cookie", headerCookies);
    if (++count > MAX_REQUESTS) throw new Error("Seanime: presupuesto de peticiones agotado");
    const response = await networkFetch(url.href, { ...options, headers, redirect: "manual", signal });
    for (const raw of cookieValues(response.headers)) {
      const [pair, ...attributes] = raw.split(";");
      const equals = pair.indexOf("=");
      if (equals < 1) continue;
      const name = pair.slice(0, equals).trim();
      const domain = attributes.find(value => /^\s*domain=/i.test(value))?.split("=")[1]?.trim().replace(/^\./, "");
      if (domain && domain.toLowerCase() !== url.hostname) continue;
      const path = attributes.find(value => /^\s*path=/i.test(value))?.trim().slice(5) || "/";
      const hostCookies = cookies ?? jar.get(url.hostname) ?? new Map();
      hostCookies.set(name, { value: pair.slice(equals + 1).trim(), path, secure: attributes.some(value => /^\s*secure\s*$/i.test(value)) });
      jar.set(url.hostname, hostCookies);
    }
    const location = response.headers.get("location");
    if (location && [301, 302, 303, 307, 308].includes(response.status) && options.redirect !== "manual") {
      await response.body?.cancel();
      if (hops >= 4) throw new Error("Seanime: demasiadas redirecciones");
      const next = publicUrl(new URL(location, url));
      if (next.origin !== url.origin) { headers.delete("cookie"); headers.delete("authorization"); }
      const get = response.status === 303 || [301, 302].includes(response.status) && options.method === "POST";
      return request(next.href, { ...options, headers, ...(get ? { method: "GET", body: undefined } : {}) }, hops + 1);
    }
    const bytes = await readBytes(response, size => {
      totalBytes += size;
      if (totalBytes > 16 * 1024 * 1024) throw new Error("Seanime: presupuesto de datos agotado");
    });
    const torrentData = /application\/x-bittorrent/i.test(response.headers.get("content-type") ?? "") || /\.torrent(?:$|\?)/i.test(url.href);
    let text = "";
    if (torrentData) {
      for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    } else text = new TextDecoder().decode(bytes);
    return {
      ok: response.ok, status: response.status, statusText: response.statusText,
      url: response.url || url.href, redirected: hops > 0, headers: response.headers,
      cookies: Object.fromEntries([...(jar.get(url.hostname) ?? [])].map(([name, cookie]) => [name, cookie.value])),
      contentType: response.headers.get("content-type") ?? "", contentLength: bytes.length,
      text: () => text, json: () => JSON.parse(text), arrayBuffer: () => bytes.slice().buffer,
    };
  }

  const compatFetch: CompatContext["fetch"] = (input, options = {}) => {
    const url = publicUrl(input).href;
    // Cookie-dependent POSTs are scoped to the same call; response bodies can
    // be read synchronously and repeatedly, just like Seanime's FetchResponse.
    const key = JSON.stringify([url, options.method ?? "GET", options.body ?? null, [...new Headers(options.headers)].sort()]);
    let pending = requests.get(key);
    if (!pending) { pending = request(url, options); requests.set(key, pending); }
    return pending;
  };
  return {
    fetch: compatFetch,
    CryptoJS: dependencies.CryptoJS,
    $store: { get: (key: string) => store.get(key), set: (key: string, value: unknown) => store.set(key, value), has: (key: string) => store.has(key), remove: (key: string) => store.delete(key) },
    $getUserPreference: (key: string) => config[key],
    $toString: (value: unknown) => typeof value === "string" ? value : value instanceof Uint8Array || value instanceof ArrayBuffer ? new TextDecoder().decode(value) : JSON.stringify(value),
    $toBytes: (value: unknown) => value instanceof Uint8Array ? value : new TextEncoder().encode(String(value)),
    $isOffline: () => false,
    $sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, Math.min(Number(ms) || 0, 100))),
    ...dependencies.compat,
  };
}
