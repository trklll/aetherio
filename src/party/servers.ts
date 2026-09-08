// Anti-DoS: la sala vive en UN servidor, y un operador malicioso puede
// tirarlo o degradarlo. Estrategia: lista de servidores (el tuyo + los de la
// comunidad), health-check antes de crear/unirse, y migración de sala con el
// mismo contenido y contraseña. El video nunca depende del servidor: si cae,
// cada uno sigue viendo en local y solo se pierde el sync.

const DEFAULT_SERVER = "https://party.aetherio.workers.dev";
const LAST_GOOD_KEY = "aetherio-party-server";

export function getPartyServers(): string[] {
  const list: string[] = [];
  const push = (raw: unknown) => {
    const clean = String(raw ?? "").trim().replace(/\/$/, "");
    if (clean && !list.includes(clean)) list.push(clean);
  };
  const env = import.meta.env as Record<string, unknown>;
  // Compat: URL única primero (prioridad), luego lista separada por comas.
  push(env.VITE_PARTY_SERVER_URL);
  String(env.VITE_PARTY_SERVER_URLS ?? "")
    .split(",")
    .forEach(push);
  if (list.length === 0) list.push(DEFAULT_SERVER);
  return list;
}

/** Base efectiva: la indicada o la primera configurada. */
export function getPartyHttpBase(override?: string): string {
  const clean = (override ?? "").trim().replace(/\/$/, "");
  return clean || getPartyServers()[0];
}

export function readLastGoodServer(): string {
  try {
    return localStorage.getItem(LAST_GOOD_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeLastGoodServer(base: string): void {
  try {
    localStorage.setItem(LAST_GOOD_KEY, base);
  } catch {
    // Solo memoria.
  }
}

/** GET /health con timeout. Devuelve RTT en ms o null si no responde. */
export async function probePartyServer(base: string, timeoutMs = 6000): Promise<number | null> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    if (!response.ok) return null;
    await response.json().catch(() => null);
    return Date.now() - started;
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export interface HealthyServer {
  base: string;
  rttMs: number;
}

/**
 * Primer servidor sano (en orden de lista, con el último que funcionó
 * primero). Lanza si ninguno responde.
 */
export async function pickHealthyServer(prefer?: string, timeoutMs = 6000): Promise<HealthyServer> {
  const servers = getPartyServers();
  const lastGood = readLastGoodServer();
  const ordered = [...servers].sort((a, b) => {
    const rank = (server: string) => (server === prefer ? 0 : server === lastGood ? 1 : 2);
    return rank(a) - rank(b);
  });
  for (const base of ordered) {
    const rttMs = await probePartyServer(base, timeoutMs);
    if (rttMs !== null) {
      writeLastGoodServer(base);
      return { base, rttMs };
    }
  }
  throw new Error(`Ningún servidor Party responde (${ordered.join(", ")}). Revisa tu conexión o despliega uno (party-server/README.md).`);
}

/** Host legible para la UI. */
export function serverHost(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}
