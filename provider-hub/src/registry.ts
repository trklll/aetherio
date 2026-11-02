import type { DesktopMediaType, Env, ProviderRecord } from "./types.ts";
import { builtinScriptSources } from "./builtinScripts.ts";

const KV_INDEX_KEY = "providers:index";
const KV_PROVIDER_PREFIX = "providers:";
const KV_SCRIPT_PREFIX = "script:";
const REGISTRY_CACHE_TTL_MS = 15_000;
const SCRIPT_CACHE_TTL_MS = 10 * 60_000;
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SCRIPT_BYTES = 512 * 1024;

/** Scripts de proveedor incluidos con el despliegue (plan de respaldo). */
export const DEFAULT_PROVIDERS: Array<Omit<ProviderRecord, "origin" | "updatedAt">> = [
  {
    id: "4khdhub",
    name: "4KHDHub",
    description: "Películas y series con enlaces directos (HTML scrape).",
    enabled: true,
    supportedTypes: ["movie", "tv"],
    contentLanguage: ["en", "es"],
    mobileHeaders: "drop",
  },
];

export interface LoadedScript {
  source: string;
  cacheKey: string;
}

interface RegistryCacheEntry {
  providers: ProviderRecord[];
  loadedAt: number;
}
let registryCache: RegistryCacheEntry | null = null;

const scriptCache = new Map<string, { value: string | null; loadedAt: number }>();

interface KVProviderPayload extends Omit<ProviderRecord, "origin"> {
  scriptUrl?: string;
}

function toRecord(id: string, payload: KVProviderPayload): ProviderRecord {
  const supportedTypes = (Array.isArray(payload.supportedTypes) ? payload.supportedTypes : [])
    .filter((value): value is DesktopMediaType => value === "movie" || value === "tv");
  return {
    id,
    name: String(payload.name ?? id).slice(0, 120),
    description: typeof payload.description === "string" ? payload.description.slice(0, 300) : undefined,
    enabled: payload.enabled !== false && supportedTypes.length > 0,
    supportedTypes: supportedTypes.length ? supportedTypes : ["movie", "tv"],
    contentLanguage: Array.isArray(payload.contentLanguage)
      ? payload.contentLanguage.filter(value => typeof value === "string").slice(0, 12)
      : undefined,
    mobileHeaders: payload.mobileHeaders === "keep" ? "keep" : "drop",
    origin: "kv",
    updatedAt: Number(payload.updatedAt) || 0,
  };
}

/** Carga el registro: KV manda; si está vacío siembra los proveedores predeterminados. */
export async function loadRegistry(env: Env): Promise<ProviderRecord[]> {
  if (registryCache && Date.now() - registryCache.loadedAt < REGISTRY_CACHE_TTL_MS) {
    return registryCache.providers;
  }
  let providers = await readRegistryFromKv(env);
  if (!providers) {
    await seedDefaults(env);
    providers = DEFAULT_PROVIDERS.map(provider => ({ ...provider, origin: "default" as const, updatedAt: Date.now() }));
  }
  registryCache = { providers, loadedAt: Date.now() };
  return providers;
}

export function invalidateRegistryCache() {
  registryCache = null;
  scriptCache.clear();
}

async function readRegistryFromKv(env: Env): Promise<ProviderRecord[] | null> {
  const indexRaw = await env.PROVIDERS.get(KV_INDEX_KEY);
  if (!indexRaw) return null;
  let ids: unknown;
  try { ids = JSON.parse(indexRaw); } catch { return null; }
  if (!Array.isArray(ids)) return null;
  const records = await Promise.allSettled(
    ids.filter(value => typeof value === "string").map(async id => {
      const payloadRaw = await env.PROVIDERS.get(`${KV_PROVIDER_PREFIX}${id}`);
      if (!payloadRaw) return null;
      const payload = JSON.parse(payloadRaw) as KVProviderPayload;
      return { id, record: toRecord(id, payload) };
    }),
  );
  return records.flatMap(result => (result.status === "fulfilled" && result.value ? [result.value.record] : []));
}

async function seedDefaults(env: Env): Promise<void> {
  const ids: string[] = [];
  for (const provider of DEFAULT_PROVIDERS) {
    const script = builtinScriptSource(provider.id);
    const payload: KVProviderPayload = { ...provider, updatedAt: Date.now() };
    await env.PROVIDERS.put(`${KV_PROVIDER_PREFIX}${provider.id}`, JSON.stringify(payload));
    if (script) await env.PROVIDERS.put(`${KV_SCRIPT_PREFIX}${provider.id}`, script);
    ids.push(provider.id);
  }
  await env.PROVIDERS.put(KV_INDEX_KEY, JSON.stringify(ids));
}

function builtinScriptSource(id: string): string | null {
  return builtinScriptSources.get(id) ?? null;
}

export function isValidProviderId(id: string): boolean {
  return PROVIDER_ID_RE.test(id);
}

export function scriptStorageKey(id: string): string {
  return `${KV_SCRIPT_PREFIX}${id}`;
}

export function providerStorageKey(id: string): string {
  return `${KV_PROVIDER_PREFIX}${id}`;
}

export async function upsertProvider(
  env: Env,
  record: ProviderRecord & { scriptUrl?: string },
  script?: string,
): Promise<void> {
  const payload: KVProviderPayload = { ...record, origin: undefined } as KVProviderPayload;
  payload.enabled = record.enabled;
  payload.updatedAt = record.updatedAt;
  await env.PROVIDERS.put(providerStorageKey(record.id), JSON.stringify(payload));
  if (script !== undefined) {
    if (script.length > MAX_SCRIPT_BYTES) throw new Error("El script excede el límite de 512 KB.");
    await env.PROVIDERS.put(scriptStorageKey(record.id), script);
    scriptCache.delete(record.id);
  }
  await appendToIndex(env, record.id);
  invalidateRegistryCache();
}

export async function deleteProvider(env: Env, id: string): Promise<boolean> {
  const existed = await env.PROVIDERS.get(providerStorageKey(id));
  await env.PROVIDERS.delete(providerStorageKey(id));
  await env.PROVIDERS.delete(scriptStorageKey(id));
  await removeFromIndex(env, id);
  invalidateRegistryCache();
  return existed !== null;
}

async function appendToIndex(env: Env, id: string): Promise<void> {
  const ids = await readIndex(env);
  if (!ids.includes(id)) ids.push(id);
  await env.PROVIDERS.put(KV_INDEX_KEY, JSON.stringify(ids));
}

async function removeFromIndex(env: Env, id: string): Promise<void> {
  const ids = (await readIndex(env)).filter(candidate => candidate !== id);
  await env.PROVIDERS.put(KV_INDEX_KEY, JSON.stringify(ids));
}

async function readIndex(env: Env): Promise<string[]> {
  try {
    const parsed = JSON.parse(await env.PROVIDERS.get(KV_INDEX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/** Resuelve el texto del script de un proveedor: KV → asset interno → scriptUrl remoto. */
export async function loadScript(env: Env, record: ProviderRecord, remoteScriptUrl?: string): Promise<LoadedScript | null> {
  const cached = scriptCache.get(record.id);
  const now = Date.now();
  if (cached && now - cached.loadedAt < SCRIPT_CACHE_TTL_MS) {
    return cached.value ? { source: cached.value, cacheKey: record.id } : null;
  }
  scriptCache.delete(record.id);

  const kvScript = await env.PROVIDERS.get(scriptStorageKey(record.id));
  if (kvScript) {
    scriptCache.set(record.id, { value: kvScript, loadedAt: now });
    return { source: kvScript, cacheKey: `${record.id}@${record.updatedAt}` };
  }

  const builtinSource = builtinScriptSource(record.id);
  if (builtinSource) {
    scriptCache.set(record.id, { value: builtinSource, loadedAt: now });
    return { source: builtinSource, cacheKey: `${record.id}@${record.updatedAt}` };
  }

  if (remoteScriptUrl && /^https?:\/\//i.test(remoteScriptUrl)) {
    try {
      const response = await fetch(remoteScriptUrl, {
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text || text.length > MAX_SCRIPT_BYTES) throw new Error("Script remoto inválido o demasiado grande");
      scriptCache.set(record.id, { value: text, loadedAt: now });
      return { source: text, cacheKey: `${record.id}@${record.updatedAt}` };
    } catch (error) {
      console.warn("[HUB:REGISTRY] scriptUrl falló", record.id, error);
      scriptCache.set(record.id, { value: null, loadedAt: now });
      return null;
    }
  }

  scriptCache.set(record.id, { value: null, loadedAt: now });
  return null;
}
