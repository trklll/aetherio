import { buildManifest } from "./manifest.ts";
import { mergeProviderStreams } from "./merge.ts";
import {
  DEFAULT_PROVIDERS,
  clearProviderScript,
  deleteProvider,
  isValidProviderId,
  loadRegistry,
  loadScript,
  syncIndex,
  upsertProvider,
  type IndexSyncEntry,
} from "./registry.ts";
import { builtinScriptSources, GENERATED_PROVIDER_SCRIPTS, PROVIDER_DEPS_SOURCE } from "./builtinScripts.ts";
import { jsonError, hubJson } from "./responses.ts";
import {
  compiledProviderInfo,
  runProviderScript,
  warmupProviders,
  type WarmupEntry,
} from "./sandbox.ts";
import { resolveTmdbTitle } from "./tmdb.ts";
import type { Env, MediaStream, ProviderRecord } from "./types.ts";

const HUB_VERSION = "1.3.1";
const MAX_PROVIDERS_PER_REQUEST = 6;
/** Límite de compilación en el arranque: cabezas del registro (global y por tipo). */
const WARMUP_HEAD_PROVIDERS = 10;
const MAX_STREAMS_TOTAL = 200;
const STREAM_CACHE_TTL_MS = 90_000;

interface StreamCacheEntry {
  payload: unknown;
  loadedAt: number;
}
const streamCache = new Map<string, StreamCacheEntry>();
function pruneStreamCache() {
  if (streamCache.size > 800) streamCache.clear();
}

interface WarmupState {
  phase: "bundle";
  summary: Awaited<ReturnType<typeof warmupProviders>>;
  /** updatedAt que tenía cada proveedor cuando se compiló (para detectar obsolescencia). */
  stamps: Map<string, number>;
}

let warmupState: WarmupState | null = null;

/**
 * Fase síncrona del arranque en frío: compila lo incluido en el paquete del
 * worker (sin I/O). Funciona en producción y en `wrangler dev`, ambos con
 * codegen permitido solo durante la evaluación del módulo.
 */
const builtinWarmupEntries = buildBuiltinWarmupEntries();
try {
  const summary = await warmupProviders(builtinWarmupEntries);
  const stamps = new Map<string, number>();
  for (const entry of builtinWarmupEntries) stamps.set(entry.id, entry.updatedAt);
  warmupState = { phase: "bundle", summary, stamps };
  logWarmup("[HUB] warmup bundle:", summary);
} catch (error) {
  console.error("[HUB] warmup embebido excepcional", error);
}

function buildBuiltinWarmupEntries(): WarmupEntry[] {
  const records = new Map<string, ProviderRecord>();
  for (const provider of DEFAULT_PROVIDERS) {
    records.set(provider.id, { ...provider, origin: "default", updatedAt: 0 });
  }
  for (const provider of GENERATED_PROVIDER_SCRIPTS) {
    records.set(provider.id, {
      id: provider.id,
      name: provider.name,
      description: provider.description,
      logo: provider.logo,
      enabled: provider.enabled,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage,
      mobileHeaders: "drop",
      origin: "kv",
      updatedAt: provider.updatedAt,
    });
  }

  let depsSourceAssigned = false;
  return buildWarmupSelection([...records.values()]).map(provider => {
    const generated = GENERATED_PROVIDER_SCRIPTS.find(entry => entry.id === provider.id);
    const source = generated?.source ?? builtinScriptSources.get(provider.id) ?? null;
    const depsSource = source && !depsSourceAssigned ? PROVIDER_DEPS_SOURCE : "";
    if (source && !depsSourceAssigned) depsSourceAssigned = true;
    return {
      id: provider.id,
      updatedAt: generated?.updatedAt ?? provider.updatedAt,
      source,
      depsSource,
    };
  });
}

function logWarmup(prefix: string, summary: { compiled: string[]; failed: Array<{ id: string; error: string }> }) {
  console.log(`${prefix} compilados=${summary.compiled.join(",") || "ninguno"}; fallidos=${summary.failed.map(entry => `${entry.id}:${entry.error.slice(0, 60)}`).join(",") || "ninguno"}`);
}

/**
 * Conjunto de proveedores a compilar en el arranque: los primeros del registro
 * (prioridad global) más los primeros habilitados por tipo — el fan-out de
 * `/stream` toma los primeros N por tipo, y solo ejecuta módulos ya compilados.
 */
function buildWarmupSelection(providers: ProviderRecord[]): ProviderRecord[] {
  const head = (limit: number, type?: "movie" | "tv") =>
    providers
      .filter(provider => provider.enabled && (!type || provider.supportedTypes.includes(type)))
      .slice(0, limit);
  const selected = new Set<string>();
  for (const chunk of [head(WARMUP_HEAD_PROVIDERS), head(MAX_PROVIDERS_PER_REQUEST, "movie"), head(MAX_PROVIDERS_PER_REQUEST, "tv")]) {
    for (const provider of chunk) selected.add(provider.id);
  }
  return providers.filter(provider => selected.has(provider.id));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return hubJson(200, {
          ok: true,
          version: HUB_VERSION,
          warmup: warmupState ? { phase: warmupState.phase, ok: warmupState.summary.depsOk, compiled: warmupState.summary.compiled, failed: warmupState.summary.failed } : { pending: true },
        });
      }
      if (url.pathname === "/manifest.json") return await handleManifest(env);
      if (url.pathname.startsWith("/scripts/")) return await handleScript(env, url);
      if (url.pathname.startsWith("/stream/")) return await handleStreams(env, url, ctx);
      if (url.pathname.startsWith("/admin/providers") || url.pathname === "/admin/index") return await handleAdmin(request, env, url);
      return jsonError(404, "Ruta no encontrada");
    } catch (error) {
      console.error("[HUB] Error no controlado", error);
      return jsonError(500, "Error interno del hub");
    }
  },
} satisfies ExportedHandler<Env>;

/* ---------------------------------- streams ---------------------------------- */

async function handleStreams(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const parsed = parseStreamRoute(url.pathname);
  if (!parsed) {
    return jsonError(400, "Ruta de fuente no válida: usa /stream/movie/ttNNNNN.json o /stream/series/ttNNNNN:ssss:eeee.json");
  }
  const { type, videoId } = parsed;

  const providers = await loadRegistry(env);
  const typeTarget = type === "movie" ? "movie" : "tv";
  const enabled = providers
    .filter(provider => provider.enabled && provider.supportedTypes.includes(typeTarget))
    .slice(0, MAX_PROVIDERS_PER_REQUEST);

  const executable = enabled.filter(provider => {
    const compiledInfo = compiledProviderInfo(provider.id);
    if (!compiledInfo) {
      console.warn(`[HUB:STREAM] ${provider.id} sin módulo compilado en esta instancia`);
      return false;
    }
    if (compiledInfo.updatedAt > 0 && compiledInfo.updatedAt !== provider.updatedAt) {
      console.warn(`[HUB:STREAM] ${provider.id} ejecutando script obsoleto (se renovará al reiniciar la instancia)`);
    }
    return true;
  });

  if (!executable.length) {
    return emitResponse({ streams: [] }, { "x-aetherio-hub": "no-compiled-providers" });
  }

  const cacheKey = `${type}:${videoId}|${executable.map(provider => `${provider.id}@${provider.updatedAt}`).join(",")}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < STREAM_CACHE_TTL_MS) {
    const stale = staleOf(executable);
    const headers: Record<string, string> = {};
    if (stale) headers["x-aetherio-hub"] = stale;
    return emitResponse(cached.payload, headers);
  }
  streamCache.delete(cacheKey);

  const imdbId = videoId.split(":")[0];
  const season = videoId.includes(":") ? Number(videoId.split(":")[1]) : null;
  const episode = videoId.includes(":") ? Number(videoId.split(":")[2]) : null;
  const seasonArg = season !== null && Number.isFinite(season) ? season : null;
  const episodeArg = episode !== null && Number.isFinite(episode) ? episode : null;

  const title = await resolveTmdbTitle(env, type, imdbId);
  const numericImdb = Number(imdbId.slice(2));
  const tmdbId = Number.isFinite(numericImdb) && numericImdb > 0 ? numericImdb : 0;

  const results = await Promise.allSettled(executable.map(async provider => {
    const args = [tmdbId, typeTarget, seasonArg, episodeArg, title, null];
    const rawStreams = await runProviderScript(provider.id, args);
    return mergeProviderStreams(provider, rawStreams).mobile;
  }));
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`[HUB:STREAM] ejecución fallida (${type}:${videoId})`, result.reason);
    }
  }

  const streams: MediaStream[] = [];
  const seenUrls = new Set<string>();
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    for (const stream of result.value) {
      const key = String(stream.url ?? "");
      if (!key || seenUrls.has(key)) continue;
      seenUrls.add(key);
      streams.push(stream);
      if (streams.length >= MAX_STREAMS_TOTAL) break;
    }
    if (streams.length >= MAX_STREAMS_TOTAL) break;
  }

  const payload = { streams };
  streamCache.set(cacheKey, { payload, loadedAt: Date.now() });
  pruneStreamCache();

  const headers: Record<string, string> = {};
  const stale = staleOf(executable);
  if (stale) headers["x-aetherio-hub"] = stale;
  void ctx; // (se guarda para futuras invalidaciones vía waitUntil)
  return emitResponse(payload, headers);
}

function emitResponse(payload: unknown, extraHeaders: Record<string, string>): Response {
  const response = hubJson(200, payload);
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value) response.headers.set(key, value);
  }
  return response;
}

function staleOf(executable: ProviderRecord[]): string {
  const staleIds = executable.filter(provider => {
    const compiledInfo = compiledProviderInfo(provider.id);
    return compiledInfo !== null && compiledInfo.updatedAt > 0 && compiledInfo.updatedAt !== provider.updatedAt;
  }).map(provider => provider.id);
  return staleIds.length ? `stale=${staleIds.join(",")}` : "";
}

function parseStreamRoute(pathname: string): { type: "movie" | "series"; videoId: string } | null {
  const match = pathname.match(/^\/stream\/(movie|series)\/(tt\d{5,12}(?::\d+:\d+)?)\.json$/i);
  if (!match) return null;
  const videoId = match[2].toLowerCase();
  const type = match[1].toLowerCase() === "movie" ? "movie" : "series";
  if (videoId.includes(":")) {
    const parts = videoId.split(":");
    const season = Number(parts[1]);
    const episode = Number(parts[2]);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0) {
      return null;
    }
  }
  return { type, videoId };
}

/* ---------------------------------- manifest --------------------------------- */

async function handleManifest(env: Env): Promise<Response> {
  const providers = await loadRegistry(env);
  const enabled = providers
    .filter(provider => provider.enabled)
    .map(provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      logo: provider.logo ?? GENERATED_PROVIDER_SCRIPTS.find(entry => entry.id === provider.id)?.logo,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage,
    }));
  return hubJson(200, buildManifest(HUB_VERSION, enabled), 60);
}

/* ----------------------------------- scripts --------------------------------- */

async function handleScript(env: Env, url: URL): Promise<Response> {
  const idMatch = url.pathname.match(/^\/scripts\/([a-z0-9][a-z0-9-]{0,63})(?:\.js)?$/i);
  if (!idMatch) return jsonError(404, "Script no encontrado");
  const id = idMatch[1];
  const providers = await loadRegistry(env);
  const provider = providers.find(candidate => candidate.id === id);
  // Aun si el registro no lo conoce (fallback), el script de fábrica es servible.
  const source = provider
    ? (await loadScript(env, provider, provider.scriptUrl))?.source ?? null
    : builtinScriptSources.get(id) ?? null;
  if (!source) return jsonError(404, "Script no disponible");
  return new Response(source, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

/* ------------------------------------ admin ---------------------------------- */

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.ADMIN_TOKEN) {
    return jsonError(503, "ADMIN_TOKEN no está configurado; usa `npx wrangler secret put ADMIN_TOKEN`.");
  }
  const token = request.headers.get("x-admin-token");
  if (!token || token !== env.ADMIN_TOKEN) return jsonError(401, "Token de administración inválido");

  const id = url.pathname.split("/").filter(Boolean)[2];

  if (request.method === "PUT" && url.pathname === "/admin/index") {
    // Sincronización completa del índice en una escritura: orden exacto,
    // altas de metadata y limpiezas de los ids que ya no están en la lista.
    const bodyRaw = await request.text();
    if (bodyRaw.length > 600_000) return jsonError(413, "Cuerpo demasiado grande");
    let body: unknown;
    try { body = JSON.parse(bodyRaw); } catch { return jsonError(400, "JSON inválido"); }
    const rawEntries = (body as { providers?: unknown })?.providers;
    if (!Array.isArray(rawEntries)) return jsonError(400, "Se espera { providers: [...] }");
    if (rawEntries.length > 200) return jsonError(400, "Máximo 200 proveedores");
    const entries: IndexSyncEntry[] = rawEntries
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map(entry => ({
        id: typeof entry.id === "string" ? entry.id : "",
        name: typeof entry.name === "string" ? entry.name : undefined,
        description: typeof entry.description === "string" ? entry.description : undefined,
        logo: typeof entry.logo === "string" ? entry.logo : undefined,
        enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
        supportedTypes: Array.isArray(entry.supportedTypes)
          ? entry.supportedTypes.filter((value): value is string => typeof value === "string")
          : undefined,
        contentLanguage: Array.isArray(entry.contentLanguage)
          ? entry.contentLanguage.filter((value): value is string => typeof value === "string")
          : undefined,
        mobileHeaders: entry.mobileHeaders === "keep" ? "keep" as const : "drop" as const,
        scriptUrl: typeof entry.scriptUrl === "string" ? entry.scriptUrl : undefined,
        updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : undefined,
      }));
    const result = await syncIndex(env, entries);
    return hubJson(200, {
      ok: true,
      count: result.records.length,
      removed: result.removed,
      order: result.records.map(record => record.id),
    });
  }

  if (request.method === "GET" && !id) {
    const providers = await loadRegistry(env);
    return hubJson(200, providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description ?? "",
      logo: provider.logo ?? GENERATED_PROVIDER_SCRIPTS.find(entry => entry.id === provider.id)?.logo,
      enabled: provider.enabled,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage ?? [],
      mobileHeaders: provider.mobileHeaders,
      scriptUrl: provider.scriptUrl,
      origin: provider.origin,
      updatedAt: provider.updatedAt,
    })));
  }

  if (request.method === "PUT" && id) {
    if (!isValidProviderId(id)) return jsonError(400, "id inválido: minúsculas, números o guiones (1-64).");
    const bodyRaw = await request.text();
    if (bodyRaw.length > 600_000) return jsonError(413, "Cuerpo demasiado grande");
    let body: Record<string, unknown>;
    try { body = JSON.parse(bodyRaw) as Record<string, unknown>; } catch { return jsonError(400, "JSON inválido"); }

    const providers = await loadRegistry(env);
    const existing = providers.find(candidate => candidate.id === id);

    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : existing?.name ?? id;
    const description = typeof body.description === "string" ? body.description.slice(0, 300) : existing?.description;
    const logo = typeof body.logo === "string" && /^https?:\/\//i.test(body.logo.trim())
      ? body.logo.trim().slice(0, 2048)
      : existing?.logo ?? GENERATED_PROVIDER_SCRIPTS.find(entry => entry.id === id)?.logo;
    const supportedTypesRaw = Array.isArray(body.supportedTypes) ? body.supportedTypes : existing?.supportedTypes ?? ["movie", "tv"];
    const supportedTypes = supportedTypesRaw.filter((value): value is "movie" | "tv" => value === "movie" || value === "tv");
    if (!supportedTypes.length) return jsonError(400, "supportedTypes debe incluir movie y/o tv.");
    const contentLanguage = Array.isArray(body.contentLanguage)
      ? body.contentLanguage.filter((value): value is string => typeof value === "string").slice(0, 12)
      : existing?.contentLanguage;
    const mobileHeaders = body.mobileHeaders === "keep" ? "keep" as const
      : body.mobileHeaders === "drop" ? "drop" as const
      : existing?.mobileHeaders ?? "drop";
    const scriptUrl = typeof body.scriptUrl === "string" && /^https?:\/\//i.test(body.scriptUrl)
      ? body.scriptUrl
      : existing?.scriptUrl;

    const record: ProviderRecord = {
      id,
      name,
      description,
      logo,
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing?.enabled ?? true,
      supportedTypes,
      contentLanguage,
      scriptUrl,
      mobileHeaders,
      origin: "kv",
      updatedAt: Date.now(),
    };
    const script = typeof body.script === "string" ? body.script : undefined;
    const scriptUrlChanged = script !== undefined
      ? false
      : scriptUrl !== undefined && scriptUrl !== existing?.scriptUrl;
    if (scriptUrlChanged && existing) {
      // Actualización por scriptUrl: descarta el script anterior para que se
      // vuelva a descargar desde la nueva URL (warmup o primera petición).
      await clearProviderScript(env, id);
    }
    await upsertProvider(env, record, script);
    return hubJson(200, {
      ok: true,
      id,
      note: "Guardado en KV. PC consume el script desde el hub; para activar cambios en /stream móvil, ejecuta `node scripts/deploy-current-providers.mjs` desde provider-hub (solo despliega el Worker, no Aetherio).",
    });
  }

  if (request.method === "DELETE" && id) {
    if (!isValidProviderId(id)) return jsonError(400, "id inválido");
    const removed = await deleteProvider(env, id);
    return hubJson(200, { ok: true, id, removed });
  }

  return jsonError(405, "Método no permitido en admin");
}
