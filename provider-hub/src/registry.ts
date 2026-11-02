import type { DesktopMediaType, Env, ProviderRecord } from "./types.ts";
import { builtinScriptSources } from "./builtinScripts.ts";

const KV_INDEX_KEY = "providers:index";
const KV_PROVIDER_PREFIX = "providers:";
const KV_SCRIPT_PREFIX = "script:";
const REGISTRY_CACHE_TTL_MS = 15_000;
const SCRIPT_CACHE_TTL_MS = 10 * 60_000;
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SCRIPT_BYTES = 512 * 1024;
/**
 * El plan gratuito limita cada petición a ~50 subpeticiones, así que el
 * registro completo vive en UNA sola clave KV (blob) y NO en un registro por
 * clave: una lectura de índice con ~60 registros haría 61 lecturas y
 * reventaría el límite en `/manifest.json` o `/stream`.
 */
const INDEX_BLOB_VERSION = 2;
/** Coste máximo de subpeticiones al migrar el formato antiguo (id por clave). */
const MAX_LEGACY_RECORDS = 45;

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

interface KVProviderPayload {
  id?: string;
  name?: string;
  description?: string;
  logo?: string;
  enabled?: boolean;
  supportedTypes?: string[];
  contentLanguage?: string[];
  scriptUrl?: string;
  mobileHeaders?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

/** Blob KV: la lista de registros conservando el orden (prioridad de warmup/fan-out). */
interface KVIndexBlob {
  version: number;
  records: KVProviderPayload[];
}

function toRecord(id: string, payload: KVProviderPayload): ProviderRecord {
  const supportedTypes = (Array.isArray(payload.supportedTypes) ? payload.supportedTypes : [])
    .filter((value): value is DesktopMediaType => value === "movie" || value === "tv");
  return {
    id,
    name: String(payload.name ?? id).slice(0, 120),
    description: typeof payload.description === "string" ? payload.description.slice(0, 300) : undefined,
    logo: typeof payload.logo === "string" && /^https?:\/\//i.test(payload.logo) ? payload.logo.slice(0, 2048) : undefined,
    enabled: payload.enabled !== false && supportedTypes.length > 0,
    supportedTypes: supportedTypes.length ? supportedTypes : ["movie", "tv"],
    contentLanguage: Array.isArray(payload.contentLanguage)
      ? payload.contentLanguage.filter(value => typeof value === "string").slice(0, 12)
      : undefined,
    mobileHeaders: payload.mobileHeaders === "keep" ? "keep" : "drop",
    scriptUrl: typeof payload.scriptUrl === "string" ? payload.scriptUrl : undefined,
    origin: "kv",
    updatedAt: Number(payload.updatedAt) || 0,
  };
}

function recordToPayload(record: ProviderRecord): KVProviderPayload {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    logo: record.logo,
    enabled: record.enabled,
    supportedTypes: record.supportedTypes,
    contentLanguage: record.contentLanguage,
    scriptUrl: record.scriptUrl,
    mobileHeaders: record.mobileHeaders,
    updatedAt: record.updatedAt,
  };
}

/** Carga el registro: el blob KV manda. Si no hay índice, registro vacío (sin
 *  siembra en caliente: una re-siembra por lag de propagación machacaría el
 *  índice real — la población inicial es tarea de la sincronización admin). */
export async function loadRegistry(env: Env): Promise<ProviderRecord[]> {
  if (registryCache && Date.now() - registryCache.loadedAt < REGISTRY_CACHE_TTL_MS) {
    return registryCache.providers;
  }
  const providers = await readRegistryFromKv(env);
  registryCache = { providers: providers ?? [], loadedAt: Date.now() };
  return providers ?? [];
}

export function invalidateRegistryCache() {
  registryCache = null;
  scriptCache.clear();
}

async function readRegistryFromKv(env: Env): Promise<ProviderRecord[] | null> {
  const indexRaw = await env.PROVIDERS.get(KV_INDEX_KEY);
  if (typeof indexRaw !== "string" || indexRaw === "") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(indexRaw); } catch { return null; }
  const items = indexItems(parsed);
  if (!items) return null;

  // Formato antiguo: ["id1","id2",...] con un registro en su propia clave.
  if (items.length > 0 && typeof items[0] === "string") {
    return readLegacyRecords(env, items.filter((value): value is string => typeof value === "string"));
  }

  const records: ProviderRecord[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const payload = item as KVProviderPayload;
    const id = typeof payload.id === "string" ? payload.id : "";
    if (!id) continue;
    records.push(toRecord(id, payload));
  }
  return records;
}

/** Lee el formato antiguo (una clave por registro) respetando el orden del índice. */
async function readLegacyRecords(env: Env, ids: string[]): Promise<ProviderRecord[] | null> {
  if (ids.length > MAX_LEGACY_RECORDS) return null;
  const settled = await Promise.allSettled(ids.map(async id => {
    const payloadRaw = await env.PROVIDERS.get(`${KV_PROVIDER_PREFIX}${id}`);
    if (!payloadRaw) return null;
    const payload = JSON.parse(payloadRaw) as KVProviderPayload;
    return toRecord(id, payload);
  }));
  return settled.flatMap(result => (result.status === "fulfilled" && result.value ? [result.value] : []));
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

/** Lee la lista de registros del blob del índice (con fallback al formato antiguo). */
async function readIndexPayloads(env: Env): Promise<KVProviderPayload[] | null> {
  const indexRaw = await env.PROVIDERS.get(KV_INDEX_KEY);
  if (typeof indexRaw !== "string" || indexRaw === "") return null;
  let parsed: unknown;
  try { parsed = JSON.parse(indexRaw); } catch { return null; }
  const items = indexItems(parsed);
  if (!items) return null;

  if (items.length === 0) return [];
  if (typeof items[0] === "string") {
    // Índice antiguo: reconstruye la lista desde las claves de registro.
    const legacy = await readLegacyRecords(env, items.filter((value): value is string => typeof value === "string"));
    if (!legacy) return null;
    return legacy.map(recordToPayload);
  }

  const payloads: KVProviderPayload[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const payload = item as KVProviderPayload;
    if (typeof payload.id !== "string" || !payload.id) continue;
    payloads.push(payload);
  }
  return payloads;
}

/** Acepta el formato anterior (array raíz) y el blob versionado actual. */
function indexItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const blob = value as Partial<KVIndexBlob>;
  return blob.version === INDEX_BLOB_VERSION && Array.isArray(blob.records) ? blob.records : null;
}

async function persistIndexBlob(env: Env, payloads: KVProviderPayload[]): Promise<void> {
  const blob: KVIndexBlob = { version: INDEX_BLOB_VERSION, records: payloads };
  await env.PROVIDERS.put(KV_INDEX_KEY, JSON.stringify(blob));
}

export async function upsertProvider(
  env: Env,
  record: ProviderRecord & { scriptUrl?: string },
  script?: string,
): Promise<void> {
  const payload = recordToPayload({ ...record, origin: "kv" });
  if (script !== undefined) {
    if (script.length > MAX_SCRIPT_BYTES) throw new Error("El script excede el límite de 512 KB.");
    await env.PROVIDERS.put(scriptStorageKey(record.id), script);
    scriptCache.delete(record.id);
  }
  const payloads = (await readIndexPayloads(env)) ?? [];
  const index = payloads.findIndex(candidate => candidate.id === record.id);
  // upsert: reemplaza en su posición (orden del índice = prioridad) o añade al final.
  if (index >= 0) payloads[index] = payload;
  else payloads.push(payload);
  await persistIndexBlob(env, payloads);
  invalidateRegistryCache();
}

/** Elimina la copia local del script para forzar su re-descarga desde scriptUrl. */
export async function clearProviderScript(env: Env, id: string): Promise<void> {
  await env.PROVIDERS.delete(scriptStorageKey(id));
  scriptCache.delete(id);
}

/** Entrada de metadata para una sincronización completa del índice. */
export interface IndexSyncEntry {
  id: string;
  name?: string;
  description?: string;
  logo?: string;
  enabled?: boolean;
  supportedTypes?: string[];
  contentLanguage?: string[];
  mobileHeaders?: "drop" | "keep";
  scriptUrl?: string;
  updatedAt?: number;
}

/**
 * Sincroniza el índice completo en UNA escritura: fija el orden (prioridad de
 * warmup y fan-out móvil), crea registros que falten y elimina los que sobran.
 * Los scripts en KV no se tocan salvo para limpiar los ids eliminados.
 */
export async function syncIndex(
  env: Env,
  entries: IndexSyncEntry[],
): Promise<{ records: ProviderRecord[]; removed: string[] }> {
  const payloads = (await readIndexPayloads(env)) ?? [];
  const previous = new Map<string, KVProviderPayload>();
  for (const payload of payloads) {
    if (typeof payload.id === "string" && payload.id) previous.set(payload.id, payload);
  }

  const kept: KVProviderPayload[] = [];
  const records: ProviderRecord[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.id !== "string" || !PROVIDER_ID_RE.test(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const existing = previous.get(entry.id);
    const supportedTypes = (Array.isArray(entry.supportedTypes) ? entry.supportedTypes : existing?.supportedTypes ?? [])
      .filter((value): value is DesktopMediaType => value === "movie" || value === "tv");
    const payload: KVProviderPayload = {
      id: entry.id,
      name: String(entry.name ?? existing?.name ?? entry.id).slice(0, 120),
      description: typeof entry.description === "string" ? entry.description.slice(0, 300) : existing?.description,
      logo: typeof entry.logo === "string" && /^https?:\/\//i.test(entry.logo)
        ? entry.logo.slice(0, 2048)
        : existing?.logo,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : existing?.enabled !== false,
      supportedTypes: supportedTypes.length ? supportedTypes : ["movie", "tv"],
      contentLanguage: Array.isArray(entry.contentLanguage)
        ? entry.contentLanguage.filter(value => typeof value === "string").slice(0, 12)
        : existing?.contentLanguage,
      scriptUrl: typeof entry.scriptUrl === "string" && /^https?:\/\//i.test(entry.scriptUrl)
        ? entry.scriptUrl
        : existing?.scriptUrl,
      mobileHeaders: entry.mobileHeaders ?? (existing?.mobileHeaders === "keep" ? "keep" : "drop"),
      updatedAt: Number.isFinite(entry.updatedAt as number) ? Number(entry.updatedAt) : existing?.updatedAt ?? Date.now(),
    };
    kept.push(payload);
    records.push(toRecord(entry.id, payload));
  }

  const removed: string[] = [];
  for (const [id] of previous) {
    if (seen.has(id)) continue;
    removed.push(id);
    await clearProviderScript(env, id);
    await env.PROVIDERS.delete(providerStorageKey(id));
  }

  await persistIndexBlob(env, kept);
  invalidateRegistryCache();
  return { records, removed };
}

export async function deleteProvider(env: Env, id: string): Promise<boolean> {
  const payloads = await readIndexPayloads(env);
  const inIndex = payloads ? payloads.some(candidate => candidate.id === id) : false;
  if (payloads) {
    await persistIndexBlob(env, payloads.filter(candidate => candidate.id !== id));
  }
  const legacyRaw = await env.PROVIDERS.get(providerStorageKey(id));
  await env.PROVIDERS.delete(providerStorageKey(id));
  await env.PROVIDERS.delete(scriptStorageKey(id));
  scriptCache.delete(id);
  invalidateRegistryCache();
  return inIndex || legacyRaw !== null;
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
