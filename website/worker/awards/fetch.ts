// Capa de obtención de HTML de fuentes oficiales: respeta robots.txt,
// limita frecuencia por dominio y aplica backoff ante 429/5xx.

// Avoid the `(+url)` token here: several official archives (notably Oscars)
// reject that User-Agent shape at their edge even though a plain product UA
// is accepted. Keep the crawler identifiable without triggering that block.
const USER_AGENT = "Aetherio-Awards/1.0";
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const DEFAULT_MIN_INTERVAL_MS = 2000;

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

interface DomainState {
  lastFetchAt: number;
  minIntervalMs: number;
  robots: boolean | null;
  robotsCheckedAt: number;
}

const domainStates = new Map<string, DomainState>();

function domainOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function robotsAllow(rawUrl: string): Promise<boolean> {
  const url = new URL(rawUrl);
  const domain = url.hostname;
  const state = domainStates.get(domain);
  const cacheWindowMs = 10 * 60 * 1000;
  if (state && state.robots !== null && Date.now() - state.robotsCheckedAt < cacheWindowMs) {
    return state.robots;
  }

  let allowed = true;
  try {
    const robotsUrl = `${url.protocol}//${domain}/robots.txt`;
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      const text = (await response.text()).slice(0, 256 * 1024);
      allowed = evaluateRobotsTxt(text, url.pathname, domain);
    }
  } catch {
    // robots.txt inaccesible: permitir con cautela (la frecuencia sigue limitada).
    allowed = true;
  }

  domainStates.set(domain, {
    lastFetchAt: 0,
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    robots: allowed,
    robotsCheckedAt: Date.now(),
  });
  return allowed;
}

/** Implementación mínima de robots.txt: grupos con nuestro UA o "User-agent: *". */
export function evaluateRobotsTxt(robotsTxt: string, pathname: string, userAgent: string): boolean {
  const lines = robotsTxt.split(/\r?\n/);
  let apply = false;
  const disallows: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("User-agent")) {
      const agent = line.split(":", 2)[1]?.trim().toLowerCase() ?? "";
      apply = agent === "*" || agent === userAgent.toLowerCase();
      continue;
    }
    if (!apply) continue;
    if (line.startsWith("Disallow")) {
      const rule = line.split(":", 2)[1]?.trim() ?? "";
      disallows.push(rule);
    }
  }
  const path = pathname.split("?")[0];
  for (const rule of disallows) {
    if (!rule) continue;
    if (rule === "/") return false;
    if (path.startsWith(rule)) return false;
  }
  return true;
}

export async function sha256Checksum(input: string): Promise<string> {
  return sha256Hex(input);
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchRaw(rawUrl: string, attempt: number): Promise<Response> {
  const url = new URL(rawUrl);
  const domain = url.hostname;
  const state = domainStates.get(domain) ?? {
    lastFetchAt: 0,
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    robots: null,
    robotsCheckedAt: 0,
  };
  domainStates.set(domain, state);

  const waitMs = Math.max(0, state.lastFetchAt + state.minIntervalMs - Date.now());
  if (waitMs > 0) await delay(waitMs);
  state.lastFetchAt = Date.now();

  const response = await fetch(rawUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "es,en;q=0.8",
    },
    signal: AbortSignal.timeout(20000),
  });

  if (response.status === 429 || response.status >= 500) {
    const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
    const backoffMs = Math.min(30_000, Math.max(retryAfter * 1000, 1000 * 2 ** attempt));
    await delay(backoffMs);
    throw new FetchError(`HTTP ${response.status}`, response.status, rawUrl);
  }
  if (!response.ok) {
    throw new FetchError(`HTTP ${response.status}`, response.status, rawUrl);
  }
  return response;
}

export interface FetchedHtml {
  html: string;
  checksum: string;
  url: string;
}

/**
 * Obtiene una página de archivo oficial. Lanza FetchError ante fallos reales;
 * la importación decide conservar el último dataset válido y marcar `stale`.
 */
export async function fetchHtml(rawUrl: string, maxAttempts = 3): Promise<FetchedHtml> {
  const allowed = await robotsAllow(rawUrl);
  if (!allowed) {
    throw new FetchError("robots.txt prohíbe la ruta", 403, rawUrl);
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchRaw(rawUrl, attempt);
      const html = await response.text();
      if (html.length > MAX_HTML_BYTES) {
        throw new FetchError("HTML excede el tamaño máximo", 413, rawUrl);
      }
      return { html, checksum: await sha256Checksum(html), url: response.url || rawUrl };
    } catch (error) {
      if (error instanceof FetchError && (error.status === 429 || (error.status ?? 0) >= 500)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new FetchError("Fallo al obtener la página", undefined, rawUrl);
}

/** Para pruebas y determinismo local: permite inyectar estado de dominio. */
export function resetDomainStates(): void {
  domainStates.clear();
}
