import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";

export const NUVIO_SPORTS_MODE_KEY = "aetherio-nuvio-sports-mode";
export const NUVIO_SPORTS_LOCAL_ORIGIN = "http://127.0.0.1:7310";

export const DEFAULT_NUVIO_SPORTS_PROFILE = {
  timezone: "America/Lima",
  languages: "Spanish",
  sports: "football,mma",
} as const;

export type NuvioSportsMode = "local" | "remote";

export interface NuvioSportsServerStatus {
  running: boolean;
  ready: boolean;
  pid: number | null;
  port: number;
  detail?: string | null;
}

let localServerStart: Promise<void> | null = null;

export function resolveNuvioSportsMode(value: string | null | undefined, isDesktop: boolean): NuvioSportsMode {
  if (value === "local" || value === "remote") return value;
  return isDesktop ? "local" : "remote";
}

export function readNuvioSportsMode(): NuvioSportsMode {
  try {
    const stored = typeof window === "undefined" ? null : window.localStorage.getItem(NUVIO_SPORTS_MODE_KEY);
    return resolveNuvioSportsMode(stored, isTauriRuntime());
  } catch {
    return resolveNuvioSportsMode(null, isTauriRuntime());
  }
}

export function writeNuvioSportsMode(mode: NuvioSportsMode): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(NUVIO_SPORTS_MODE_KEY, mode);
  } catch {
    // A storage failure must not prevent the currently selected backend from working.
  }
}

/** Builds Nuvio's standard encoded-config path without allowing cleartext LAN URLs. */
export function buildNuvioSportsBaseUrl(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("La URL de Sports debe usar HTTP o HTTPS.");
  }

  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash
      || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("La URL de Sports debe ser un origen HTTP o HTTPS válido.");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol === "http:" && !loopback) {
    throw new Error("Sports solo puede usar HTTP en una dirección loopback.");
  }

  return `${parsed.origin}/${encodeURIComponent(JSON.stringify(DEFAULT_NUVIO_SPORTS_PROFILE))}`;
}

/** Starts the packaged local service on first entry to Sports; it stays alive until app exit. */
export async function ensureLocalNuvioSportsServer(): Promise<void> {
  if (readNuvioSportsMode() !== "local") return;
  if (!isTauriRuntime()) {
    throw new Error("La instancia local de Sports solo está disponible en Aetherio de escritorio.");
  }
  if (localServerStart) return localServerStart;

  localServerStart = invokeCommand<NuvioSportsServerStatus>("start_nuvio_sports_server")
    .then(status => {
      if (!status.ready) {
        throw new Error(status.detail || "El servidor local de Sports no quedó listo.");
      }
    })
    .catch(error => {
      // Tauri rejects Result<_, String> with a string, not an Error. Preserve
      // the native cause so the Sports page can report the actual failure.
      const original = error instanceof Error ? error.message : typeof error === "string" ? error : "No se pudo iniciar Sports local.";
      const message = original.replace(/\b(?:Nuvio(?: Live Sports)?|Live Sports)\b/g, "Sports");
      throw error instanceof Error && message === original ? error : new Error(message);
    })
    .finally(() => {
      // Only coalesce in-flight starts. A resolved promise is not proof that
      // the child is still alive when the next refresh or navigation happens.
      localServerStart = null;
    });

  return localServerStart;
}
