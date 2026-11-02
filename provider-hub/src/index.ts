import { buildManifest } from "./manifest.ts";
import { mergeProviderStreams } from "./merge.ts";
import {
  DEFAULT_PROVIDERS,
  deleteProvider,
  isValidProviderId,
  loadRegistry,
  loadScript,
  upsertProvider,
} from "./registry.ts";
import { builtinScriptSources, PROVIDER_DEPS_SOURCE } from "./builtinScripts.ts";
import { jsonError, hubJson } from "./responses.ts";
import {
  compiledProviderInfo,
  runProviderScript,
  warmupProviders,
  type WarmupEntry,
} from "./sandbox.ts";
import { resolveTmdbTitle } from "./tmdb.ts";
import type { Env, MediaStream, ProviderRecord } from "./types.ts";

const HUB_VERSION = "1.1.0";
const MAX_PROVIDERS_PER_REQUEST = 6;
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

interface ProviderRecordWithScriptUrl extends ProviderRecord {
  scriptUrl?: string;
}

interface WarmupState {
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
warmupProviders(buildBuiltinWarmupEntries()).then(summary => {
  const stamps = new Map<string, number>();
  for (const entry of buildBuiltinWarmupEntries()) stamps.set(entry.id, entry.updatedAt);
  warmupState = { summary, stamps };
  logWarmup("[HUB] warmup embebido:", summary);
}).catch(error => {
  console.error("[HUB] warmup embebido excepcional", error);
});

function buildBuiltinWarmupEntries(): WarmupEntry[] {
  return DEFAULT_PROVIDERS.map(provider => {
    const source = builtinScriptSources.get(provider.id) ?? null;
    return {
      id: provider.id,
      // 0 = compilado desde el paquete embebido; no representa una versión KV.
      updatedAt: 0,
      source,
      depsSource: source ? PROVIDER_DEPS_SOURCE : "",
    };
  });
}

/**
 * Fase KV del arranque (solo disponible en producción): lee el registro y los
 * scripts desde KV y los compila. En `wrangler dev` el runtime local prohíbe
 * I/O asíncrono en el scope global, así que aquí mantiene la fase embebida.
 */
async function runtimeWarmupKv(): Promise<void> {
  try {
    const envModule = (await import("cloudflare:workers")) as unknown as { env?: unknown };
    const env = envModule.env as Env | undefined;
    if (!env) throw new Error("env indisponible en el arranque");
    const state = await buildWarmupState(env);
    warmupState = state;
    logWarmup("[HUB] warmup KV:", state.summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Disallowed operation/i.test(message)) {
      console.warn("[HUB] warmup KV omitido (I/O en scope global, esperado en wrangler dev):", message);
    } else {
      console.error("[HUB] warmup KV excepcional", error);
    }
  }
}

function logWarmup(prefix: string, summary: { compiled: string[]; failed: Array<{ id: string; error: string }> }) {
  console.log(`${prefix} compilados=${summary.compiled.join(",") || "ninguno"}; fallidos=${summary.failed.map(entry => `${entry.id}:${entry.error.slice(0, 60)}`).join(",") || "ninguno"}`);
}

void runtimeWarmupKv();

async function buildWarmupState(env: Env): Promise<WarmupState> {
  const providers = await loadRegistry(env);
  const entries: WarmupEntry[] = [];
  let depsSourceAssigned = false;

  for (const provider of providers.slice(0, MAX_PROVIDERS_PER_REQUEST)) {
    let source: string | null = null;
    try {
      const script = await loadScript(env, provider, (provider as ProviderRecordWithScriptUrl).scriptUrl);
      source = script?.source ?? null;
    } catch (error) {
      console.error(`[HUB] fuente de ${provider.id} falló en warmup`, error);
    }
    entries.push({
      id: provider.id,
      updatedAt: provider.updatedAt,
      source,
      depsSource: depsSourceAssigned ? "" : (source ? PROVIDER_DEPS_SOURCE : ""),
    });
    if (source && !depsSourceAssigned) depsSourceAssigned = true;
  }

  const summary = await warmupProviders(entries);
  const stamps = new Map<string, number>();
  for (const entry of entries) stamps.set(entry.id, entry.updatedAt);
  return { summary, stamps };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") {
        return hubJson(200, {
          ok: true,
          version: HUB_VERSION,
          warmup: warmupState ? { ok: warmupState.summary.depsOk, compiled: warmupState.summary.compiled, failed: warmupState.summary.failed } : { pending: true },
        });
      }
      if (url.pathname === "/manifest.json") return await handleManifest(env);
      if (url.pathname.startsWith("/scripts/")) return await handleScript(env, url);
      if (url.pathname.startsWith("/stream/")) return await handleStreams(env, url, ctx);
      if (url.pathname.startsWith("/admin/providers")) return await handleAdmin(request, env, url);
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
    ? (await loadScript(env, provider, (provider as ProviderRecordWithScriptUrl).scriptUrl))?.source ?? null
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

  if (request.method === "GET" && !id) {
    const providers = await loadRegistry(env);
    return hubJson(200, providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description ?? "",
      enabled: provider.enabled,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage ?? [],
      mobileHeaders: provider.mobileHeaders,
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
      : (existing as ProviderRecordWithScriptUrl | undefined)?.scriptUrl;

    const record: ProviderRecord = {
      id,
      name,
      description,
      enabled: typeof body.enabled === "boolean" ? body.enabled : existing?.enabled ?? true,
      supportedTypes,
      contentLanguage,
      mobileHeaders,
      origin: "kv",
      updatedAt: Date.now(),
    };
    const script = typeof body.script === "string" ? body.script : undefined;
    await upsertProvider(env, { ...record, scriptUrl }, script);
    return hubJson(200, {
      ok: true,
      id,
      note: "El script se compila al reiniciar la instancia del worker (inactividad aproximada: minutos) o en el próximo despliegue.",
    });
  }

  if (request.method === "DELETE" && id) {
    if (!isValidProviderId(id)) return jsonError(400, "id inválido");
    const removed = await deleteProvider(env, id);
    return hubJson(200, { ok: true, id, removed });
  }

  return jsonError(405, "Método no permitido en admin");
}
