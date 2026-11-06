import { invokeCommand, isTauriRuntime } from "../runtime/platform";

interface RequestOptions { refresh?: boolean; ttlMs?: number }
interface CachedRequest { promise: Promise<unknown>; expires: number; pending: boolean }
const cache = new Map<string, CachedRequest>();
const MAX_ENTRIES = 80;
const MAX_JSON_LENGTH = 8 * 1024 * 1024;

/** Fixed read-only upstreams, shared by native transport and the local Vite proxy. */
export function sportsDataProxyPath(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Origen de datos deportivos no permitido");
  if (url.hostname === "www.fotmob.com" && /^\/api\/data\/(teams|search\/suggest|matchDetails)$/.test(url.pathname)) {
    return `/api/sports-data/fotmob${url.pathname.slice("/api/data".length)}${url.search}`;
  }
  if (url.hostname === "data.fotmob.com" && /^\/stats\/\d+\/season\/\d+\/(goals|goal_assist)\.json$/.test(url.pathname)) {
    return `/api/sports-data/fotmob-stats${url.pathname}${url.search}`;
  }
  if (url.hostname === "www.wikidata.org" && (/^\/wiki\/Special:EntityData\/Q\d+\.json$/.test(url.pathname)
    || (url.pathname === "/w/api.php" && url.searchParams.get("action") === "wbgetentities"))) {
    return `/api/sports-data/wikidata${url.pathname}${url.search}`;
  }
  throw new Error("Origen de datos deportivos no permitido");
}

async function requestJson(url: string): Promise<unknown> {
  const proxyPath = sportsDataProxyPath(url);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("Tiempo de espera agotado al consultar datos deportivos")); }, 18_000);
  });
  try {
    return await Promise.race([(async () => {
      let text: string;
      if (isTauriRuntime()) {
        // Reuse the desktop HTTP bridge: browser CORS must not decide whether
        // the installed MVP works. No paid service, credentials or bot bypass.
        // FotMob rejects the anonymous native client (403); identify our app honestly.
        const response = await invokeCommand<{ status: number; bodyBase64: string; url?: string }>("provider_http_request", {
          request: { url, method: "GET", headers: { Accept: "application/json", "User-Agent": "Aetherio/0.9.4 (local sports MVP)" } },
        });
        if (!response || response.status < 200 || response.status >= 300) throw new Error(`Datos deportivos HTTP ${response?.status ?? "sin respuesta"}`);
        if (response.url) sportsDataProxyPath(response.url);
        const bytes = Uint8Array.from(atob(response.bodyBase64), character => character.charCodeAt(0));
        text = new TextDecoder().decode(bytes);
      } else {
        const target = import.meta.env.DEV && typeof window !== "undefined" ? proxyPath : url;
        const response = await fetch(target, { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Datos deportivos HTTP ${response.status}`);
        text = await response.text();
      }
      if (text.length > MAX_JSON_LENGTH) throw new Error("Respuesta deportiva demasiado grande");
      return JSON.parse(text) as unknown;
    })(), expired]);
  } finally { if (timer) clearTimeout(timer); }
}

/** In-flight deduplication, bounded memory and no cached errors or hidden retries. */
export function sportsDataJson(url: string, options: RequestOptions = {}): Promise<unknown> {
  sportsDataProxyPath(url);
  const cached = cache.get(url);
  if (cached && (cached.pending || (!options.refresh && cached.expires > Date.now()))) return cached.promise;
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache].find(([, entry]) => !entry.pending)?.[0];
    if (oldest) cache.delete(oldest);
    else return Promise.reject(new Error("Hay demasiadas consultas deportivas en curso"));
  }
  const entry: CachedRequest = { promise: requestJson(url), expires: 0, pending: true };
  cache.set(url, entry);
  void entry.promise.then(() => { entry.pending = false; entry.expires = Date.now() + (options.ttlMs ?? 300_000); }, () => { if (cache.get(url) === entry) cache.delete(url); });
  return entry.promise;
}
