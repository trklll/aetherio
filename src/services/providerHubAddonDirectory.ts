import { invokeCommand, isTauriRuntime } from "../runtime/platform.ts";
import { PROVIDER_HUB_ADDONS_URL, PROVIDER_HUB_BASE_URL } from "./providerHubConfig.ts";
import type { AddonStreamNameFilter } from "../utils/addonStreamFilter.ts";

const DIRECTORY_CACHE_KEY = "aetherio-provider-hub-addon-directory";
const AETHERIO_API_BASE = (import.meta.env.VITE_AETHERIO_API_URL as string | undefined)?.replace(/\/+$/, "")
  ?? "https://trkll.aetherio.workers.dev";
export const PENGUPLAY_MANIFEST_URL = `${AETHERIO_API_BASE}/api/penguplay/manifest.json`;

export interface ProviderHubAddonEntry {
  id: string;
  name: string;
  description: string;
  logo: string;
  manifestUrl: string;
  enabledByDefault: boolean;
  catalogPolicy: "keep" | "empty";
  hiddenInUi?: boolean;
  streamTimeoutMs?: number;
  streamAttempts?: number;
  upstreamAddonId?: string;
  streamNameFilter?: AddonStreamNameFilter;
  manifestFallback: Record<string, unknown>;
}

export interface ProviderHubAddonDirectory {
  version: number;
  addons: ProviderHubAddonEntry[];
}

interface ProviderHttpResponse {
  status: number;
  statusText?: string;
  bodyBase64: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeEntry(value: unknown): ProviderHubAddonEntry | null {
  if (!isRecord(value)) return null;
  const { id, name, description, logo, manifestUrl, catalogPolicy, manifestFallback } = value;
  if (
    typeof id !== "string" || !id.trim()
    || typeof name !== "string" || !name.trim()
    || typeof manifestUrl !== "string"
    || !manifestUrl.trim()
    || (typeof logo !== "string" || !logo.trim())
    || !isRecord(manifestFallback)
    || (catalogPolicy !== "keep" && catalogPolicy !== "empty")
  ) return null;

  const safeManifestUrl = manifestUrl.startsWith("/") && !manifestUrl.startsWith("//")
    ? manifestUrl
    : (() => {
      try {
        const url = new URL(manifestUrl);
        return url.protocol === "https:" ? url.toString() : null;
      } catch {
        return null;
      }
    })();
  if (!safeManifestUrl) return null;
  let streamNameFilter: AddonStreamNameFilter | undefined;
  if (value.streamNameFilter !== undefined) {
    const filter = value.streamNameFilter;
    if (!isRecord(filter) || (filter.mode !== "include" && filter.mode !== "exclude")
      || !Array.isArray(filter.prefixes) || !filter.prefixes.length || filter.prefixes.length > 20
      || filter.prefixes.some(prefix => typeof prefix !== "string" || !prefix.trim() || prefix.length > 80)) return null;
    streamNameFilter = { mode: filter.mode, prefixes: filter.prefixes.map(prefix => prefix.trim()) };
  }
  if (value.upstreamAddonId !== undefined && (typeof value.upstreamAddonId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.upstreamAddonId))) return null;

  let safeLogo: string;
  try {
    const url = new URL(logo, PROVIDER_HUB_BASE_URL);
    if (url.protocol !== "https:") return null;
    safeLogo = url.toString();
  } catch {
    return null;
  }

  return {
    id,
    name,
    description: typeof description === "string" ? description : "",
    logo: safeLogo,
    manifestUrl: safeManifestUrl,
    enabledByDefault: value.enabledByDefault !== false,
    catalogPolicy,
    hiddenInUi: value.hiddenInUi === true,
    streamTimeoutMs: positiveNumber(value.streamTimeoutMs),
    streamAttempts: positiveNumber(value.streamAttempts),
    upstreamAddonId: value.upstreamAddonId as string | undefined,
    streamNameFilter,
    manifestFallback,
  };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseProviderHubAddonDirectory(value: unknown): ProviderHubAddonDirectory | null {
  if (!isRecord(value) || !Array.isArray(value.addons)) return null;
  const addons = value.addons.map(normalizeEntry).filter((addon): addon is ProviderHubAddonEntry => addon !== null);
  // Empty is a valid administrative choice. Partial/malformed is not a delete.
  if (addons.length !== value.addons.length) return null;
  const unique = new Set<string>();
  for (const addon of addons) {
    if (unique.has(addon.id)) return null;
    unique.add(addon.id);
  }
  return {
    version: typeof value.version === "number" ? value.version : 1,
    addons,
  };
}

export function readCachedProviderHubAddonDirectory(): ProviderHubAddonDirectory | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(DIRECTORY_CACHE_KEY);
    return raw ? parseProviderHubAddonDirectory(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function cacheProviderHubAddonDirectory(directory: ProviderHubAddonDirectory) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DIRECTORY_CACHE_KEY, JSON.stringify(directory));
  } catch {
    // Directory cache is an offline convenience, not required for operation.
  }
}

async function requestText(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return await response.text();
  } catch (fetchError) {
    if (!isTauriRuntime()) throw fetchError;
    const response = await invokeCommand<ProviderHttpResponse>("provider_http_request", {
      request: { url, method: "GET", headers: { Accept: "application/json" } },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status} ${response.statusText ?? ""}`.trim());
    }
    return decodeBase64Text(response.bodyBase64);
  }
}

function decodeBase64Text(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

export async function fetchProviderHubAddonDirectory(): Promise<ProviderHubAddonDirectory> {
  const raw = await requestText(PROVIDER_HUB_ADDONS_URL);
  const directory = parseProviderHubAddonDirectory(JSON.parse(raw));
  if (!directory) throw new Error("El directorio de add-ons del Provider Hub no es válido.");
  cacheProviderHubAddonDirectory(directory);
  return directory;
}

export function resolveHubAddonManifestUrl(manifestUrl: string): string {
  if (manifestUrl.startsWith("/")) return `${AETHERIO_API_BASE}${manifestUrl}`;
  return manifestUrl;
}

export async function fetchHubAddonManifest(entry: ProviderHubAddonEntry): Promise<Record<string, unknown>> {
  const url = resolveHubAddonManifestUrl(entry.manifestUrl);
  const raw = await requestText(url);
  const manifest: unknown = JSON.parse(raw);
  if (!isRecord(manifest)) throw new Error(`Manifest inválido para ${entry.name}.`);
  return manifest;
}
