import { buildManifest } from "./manifest.ts";
import { addonLogoResponse, buildAddonDirectory } from "./addons.ts";
import { adminAddonDirectory, customAddonLogoResponse, deleteAddon, loadAddons, upsertAddon, validateAddonManifest } from "./addonRegistry.ts";
import { AssetError } from "./remoteAssets.ts";
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
import { adminPageResponse } from "./adminPage.ts";
import {
  compiledProviderInfo,
  runProviderScript,
  warmupProviders,
  type WarmupEntry,
} from "./sandbox.ts";
import { resolveTmdbTitle } from "./tmdb.ts";
import { mapWithConcurrency, selectEnabledStreamProviders, selectProvidersToWarmup, streamDedupeKey, streamsForStremio } from "./streamExecution.ts";
import type { Env, MediaStream, ProviderRecord } from "./types.ts";

const HUB_VERSION = "1.8.0";
const STREAM_PROVIDER_CONCURRENCY = 8;
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
      contentLanguage: [...provider.contentLanguage],
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

/** Compila todos los proveedores habilitados para que /stream no dependa del orden del registro. */
function buildWarmupSelection(providers: ProviderRecord[]): ProviderRecord[] {
  // Keep imported bundles available even if an operator has paused them;
  // compilation remains at module evaluation, never inside a request handler.
  const compileAlwaysIds = GENERATED_PROVIDER_SCRIPTS
    .filter(provider => "compileAlways" in provider && provider.compileAlways)
    .map(provider => provider.id);
  return selectProvidersToWarmup(providers, compileAlwaysIds);
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
      if (url.pathname === "/addons.json") return await handleAddonDirectory(env, url);
      if (url.pathname.startsWith("/addons/logos/custom/")) {
        return await customAddonLogoResponse(env, url.pathname) ?? jsonError(404, "Logo no encontrado");
      }
      if (url.pathname.startsWith("/addons/logos/")) {
        return await addonLogoResponse(url.pathname) ?? jsonError(404, "Logo no encontrado");
      }
      if (url.pathname.startsWith("/scripts/")) return await handleScript(env, url);
      if (url.pathname.startsWith("/stream/")) return await handleStreams(env, url, ctx);
      const adminPage = adminPageResponse(url.pathname);
      if (adminPage) return adminPage;
      if (url.pathname.startsWith("/admin/")) return await handleAdmin(request, env, url);
      return jsonError(404, "Ruta no encontrada");
    } catch (error) {
      if (error instanceof AssetError) return jsonError(error.status, error.message);
      console.error("[HUB] Error no controlado", error);
      return jsonError(500, "Error interno del hub");
    }
  },
} satisfies ExportedHandler<Env>;

async function handleAddonDirectory(env: Env, url: URL): Promise<Response> {
  return hubJson(200, buildAddonDirectory(url.origin, await loadAddons(env)), 60, true);
}

/* ---------------------------------- streams ---------------------------------- */

async function handleStreams(env: Env, url: URL, ctx: ExecutionContext): Promise<Response> {
  const parsed = parseStreamRoute(url.pathname);
  if (!parsed) {
    return jsonError(400, "Ruta de fuente no válida: usa /stream/movie/ttNNNNN.json o /stream/series/ttNNNNN:ssss:eeee.json");
  }
  const { type, videoId } = parsed;

  const providers = await loadRegistry(env);
  const typeTarget = type === "movie" ? "movie" : "tv";
  const enabled = selectEnabledStreamProviders(providers, typeTarget);

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

  const results = await mapWithConcurrency(executable, STREAM_PROVIDER_CONCURRENCY, async provider => {
    try {
      const args = [tmdbId, typeTarget, seasonArg, episodeArg, title, null];
      const rawStreams = await runProviderScript(provider.id, args);
      // `/stream` is the Stremio-compatible endpoint: preserve Torrentio's
      // infoHash/magnet streams as well as direct HTTPS URLs. The mobile-only
      // projection intentionally drops torrents and therefore made Torrentio
      // appear to return no sources.
      return { status: "fulfilled" as const, value: streamsForStremio(provider, rawStreams) };
    } catch (reason) {
      return { status: "rejected" as const, reason };
    }
  });
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
      const key = streamDedupeKey(stream);
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
    .map(provider => ({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      logo: provider.logo ?? GENERATED_PROVIDER_SCRIPTS.find(entry => entry.id === provider.id)?.logo,
      supportedTypes: provider.supportedTypes,
      contentLanguage: provider.contentLanguage,
      enabled: provider.enabled,
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

  if (url.pathname === "/admin/addons" && request.method === "GET") {
    return hubJson(200, adminAddonDirectory(await loadAddons(env), url.origin));
  }
  if (url.pathname === "/admin/validate-addon" && request.method === "POST") {
    const body = await readAdminJson(request, 8_000);
    if (body instanceof Response) return body;
    return hubJson(200, { ok: true, manifest: await validateAddonManifest(body.manifestUrl) });
  }
  const addonRoute = url.pathname.match(/^\/admin\/addons\/([^/]+)$/);
  if (addonRoute && request.method === "PUT") {
    const body = await readAdminJson(request, 300_000);
    if (body instanceof Response) return body;
    const addon = await upsertAddon(env, addonRoute[1], body);
    return hubJson(200, { ok: true, id: addon.id, note: "Add-on guardado en el Hub. El directorio se actualiza sin redesplegar el Worker; Aetherio lo aplicará al sincronizar." });
  }
  if (addonRoute && request.method === "DELETE") {
    return hubJson(200, { ok: true, id: addonRoute[1], removed: await deleteAddon(env, addonRoute[1]) });
  }

  if (request.method === "POST" && url.pathname === "/admin/validate-script") {
    const body = await readAdminJson(request, 8_000);
    if (body instanceof Response) return body;
    if (typeof body.scriptUrl !== "string") return jsonError(400, "Se espera { scriptUrl: \"https://…\" }");
    const initialUrl = parseRemoteScriptUrl(body.scriptUrl);
    if (!initialUrl) return jsonError(400, "La URL del script debe ser HTTPS y no usar una IP literal ni un host local.");

    try {
      const response = await fetchRemoteScript(initialUrl);
      return hubJson(200, {
        ok: true,
        bytes: new TextEncoder().encode(response.source).byteLength,
        contentType: response.contentType,
      });
    } catch (error) {
      const status = error instanceof RemoteScriptError ? error.status : 502;
      return jsonError(status, error instanceof Error ? error.message : "No se pudo comprobar el script remoto.");
    }
  }

  if (request.method === "POST" && url.pathname === "/admin/test") {
    const body = await readAdminJson(request, 8_000);
    if (body instanceof Response) return body;
    const providerId = typeof body.id === "string" ? body.id : "";
    if (!isValidProviderId(providerId)) return jsonError(400, "id inválido");
    const type = body.type === "movie" || body.type === "tv" ? body.type : null;
    if (!type) return jsonError(400, "type debe ser movie o tv");
    const tmdbId = body.tmdbId;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const season = body.season;
    const episode = body.episode;
    if (typeof tmdbId !== "number" || !Number.isSafeInteger(tmdbId) || tmdbId <= 0 || !title) {
      return jsonError(400, "tmdbId positivo y title son obligatorios");
    }
    if (type === "tv" && (
      typeof season !== "number" || !Number.isSafeInteger(season) || season < 0 ||
      typeof episode !== "number" || !Number.isSafeInteger(episode) || episode <= 0
    )) {
      return jsonError(400, "season y episode deben ser enteros válidos para una serie");
    }

    const provider = (await loadRegistry(env)).find(candidate => candidate.id === providerId);
    if (!provider) return jsonError(404, "Proveedor no encontrado en el directorio");
    if (!provider.supportedTypes.includes(type)) return jsonError(400, "El proveedor no declara este tipo de contenido");
    if (!provider.enabled) return jsonError(400, "El proveedor está desactivado");
    const compiled = compiledProviderInfo(providerId);
    if (!compiled) {
      return hubJson(409, {
        error: "Este proveedor no está compilado en el Worker activo. Despliega el bundle del Provider Hub y vuelve a intentarlo.",
      });
    }

    try {
      const rawStreams = await runProviderScript(providerId, [
        Number(tmdbId), type, type === "tv" ? Number(season) : null,
        type === "tv" ? Number(episode) : null, title, null,
      ]);
      const merged = mergeProviderStreams(provider, rawStreams);
      const playable = merged.desktop.filter(stream => /^[a-f0-9]{40}$/i.test(String(stream.infoHash ?? "")) || /^https?:\/\//i.test(String(stream.url ?? "")));
      const streams = playable.slice(0, 8).map(stream => {
        const kind = stream.infoHash ? "torrent" : "direct";
        let host = "";
        if (kind === "torrent") host = "BitTorrent";
        else try { host = new URL(stream.url ?? "").hostname; } catch { /* sin URL en el resumen */ }
        return {
          name: typeof stream.name === "string" ? stream.name.slice(0, 120) : provider.name,
          title: typeof (stream.title ?? stream.description) === "string" ? String(stream.title ?? stream.description).slice(0, 200) : undefined,
          host, kind,
        };
      });
      return hubJson(200, {
        ok: true,
        streamCount: playable.length,
        mobileStreamCount: merged.mobile.length,
        compiledAt: compiled.updatedAt > 0 ? new Date(compiled.updatedAt).toISOString() : "bundle integrado",
        streams,
      });
    } catch (error) {
      console.warn(`[HUB:ADMIN] prueba fallida (${providerId})`, error);
      return jsonError(502, "Falló la ejecución de prueba del proveedor compilado");
    }
  }

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

  if (request.method === "GET" && url.pathname === "/admin/providers") {
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

  const providerRoute = /^\/admin\/providers\/[^/]+$/.test(url.pathname);
  if (request.method === "PUT" && id && providerRoute) {
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
    let logo = existing?.logo ?? GENERATED_PROVIDER_SCRIPTS.find(entry => entry.id === id)?.logo;
    if (typeof body.logo === "string") {
      const candidate = body.logo.trim();
      if (!candidate) logo = undefined;
      else if (isSafeAdminHttpsUrl(candidate)) logo = candidate.slice(0, 2048);
      else return jsonError(400, "logo debe ser una URL HTTPS válida");
    }
    const supportedTypesRaw = Array.isArray(body.supportedTypes) ? body.supportedTypes : existing?.supportedTypes ?? ["movie", "tv"];
    const supportedTypes = supportedTypesRaw.filter((value): value is "movie" | "tv" => value === "movie" || value === "tv");
    if (!supportedTypes.length) return jsonError(400, "supportedTypes debe incluir movie y/o tv.");
    const contentLanguage = Array.isArray(body.contentLanguage)
      ? body.contentLanguage.filter((value): value is string => typeof value === "string").slice(0, 12)
      : existing?.contentLanguage;
    const mobileHeaders = body.mobileHeaders === "keep" ? "keep" as const
      : body.mobileHeaders === "drop" ? "drop" as const
      : existing?.mobileHeaders ?? "drop";
    let scriptUrl = existing?.scriptUrl;
    if (body.clearScriptUrl === true || body.scriptUrl === null) scriptUrl = undefined;
    else if (typeof body.scriptUrl === "string") {
      const candidate = parseRemoteScriptUrl(body.scriptUrl);
      if (!candidate) return jsonError(400, "scriptUrl debe ser HTTPS y no usar una IP literal ni un host local");
      scriptUrl = candidate.href;
    }

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
    if (Object.hasOwn(body, "script") && typeof body.script !== "string") {
      return jsonError(400, "script debe ser texto");
    }
    const script = typeof body.script === "string" ? body.script : undefined;
    if (script !== undefined && new TextEncoder().encode(script).byteLength > 512 * 1024) {
      return jsonError(413, "El script excede el límite de 512 KB.");
    }
    const scriptUrlChanged = scriptUrl !== existing?.scriptUrl;
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

  if (request.method === "DELETE" && id && providerRoute) {
    if (!isValidProviderId(id)) return jsonError(400, "id inválido");
    const removed = await deleteProvider(env, id);
    return hubJson(200, { ok: true, id, removed });
  }

  return jsonError(405, "Método no permitido en admin");
}

async function readAdminJson(request: Request, maxBytes: number): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return jsonError(413, "Cuerpo demasiado grande");
  }

  let raw = "";
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > maxBytes) {
          await reader.cancel();
          return jsonError(413, "Cuerpo demasiado grande");
        }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return jsonError(400, "JSON inválido"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonError(400, "El cuerpo debe ser un objeto JSON");
  }
  return parsed as Record<string, unknown>;
}

function isSafeAdminHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}

function parseRemoteScriptUrl(value: string): URL | null {
  if (value.length > 2048 || !isSafeAdminHttpsUrl(value)) return null;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !hostname.includes(".") || hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.startsWith("[") ||
    /^\d+(?:\.\d+){0,3}$/.test(hostname) || hostname === "metadata.google.internal"
  ) return null;
  return url;
}

class RemoteScriptError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RemoteScriptError";
  }
}

async function fetchRemoteScript(initialUrl: URL): Promise<{ source: string; contentType: string }> {
  let currentUrl: URL | null = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!currentUrl) throw new RemoteScriptError("Redirección remota no válida", 502);
    let response: Response;
    try {
      response = await fetch(currentUrl.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RemoteScriptError("No se pudo conectar con la URL del script", 502);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === 3) throw new RemoteScriptError("Demasiadas redirecciones o destino ausente", 502);
      try { currentUrl = parseRemoteScriptUrl(new URL(location, currentUrl).href); }
      catch { currentUrl = null; }
      if (!currentUrl) throw new RemoteScriptError("La redirección debe ser HTTPS y no usar una IP literal ni un host local", 400);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new RemoteScriptError(`El servidor del script respondió HTTP ${response.status}`, 502);
    }

    const contentType = response.headers.get("content-type")?.slice(0, 160) || "";
    const { source, bytes } = await readLimitedResponse(response, 512 * 1024);
    if (!source.trim()) throw new RemoteScriptError("El servidor devolvió un script vacío", 422);
    if (/text\/html/i.test(contentType) || /^\s*<!doctype\s+html|^\s*<html\b/i.test(source)) {
      throw new RemoteScriptError("La URL devolvió una página HTML, no un script", 422);
    }
    if (bytes > 512 * 1024) throw new RemoteScriptError("El script remoto supera el límite de 512 KB", 413);
    return { source, contentType };
  }
  throw new RemoteScriptError("Demasiadas redirecciones", 502);
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<{ source: string; bytes: number }> {
  if (!response.body) return { source: "", bytes: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new RemoteScriptError("El script remoto supera el límite de 512 KB", 413);
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return { source, bytes };
}
