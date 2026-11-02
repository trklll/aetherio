import type { MediaStream } from "./types.ts";

/**
 * Modelo de ejecución en Cloudflare Workers (2026+):
 * - El runtime (V8 sandbox) deshabilita `eval()`/`new Function()` dentro de los
 *   handlers de petición y lo deja habilitado SOLO durante la evaluación del
 *   módulo (arranque en frío), con la fecha de compatibilidad >= 2025-06-01.
 * - Por eso TODO el código del proveedor se compila durante el arranque
 *   (warmup) y en las peticiones solo se ejecuta lo ya compilado.
 * - Los cambios de scripts por KV/scriptUrl se aplican cuando la instancia se
 *   reinicia (inactividad ~minutos) o en el siguiente despliegue.
 */

const PROVIDER_CALL_TIMEOUT_MS = 18_000;
const MAX_STREAMS_PER_PROVIDER = 12;
const MAX_MODULE_FETCH_BYTES = 8 * 1024 * 1024;

export interface WarmupEntry {
  id: string;
  updatedAt: number;
  source: string | null;
  /** Texto de las dependencias del runtime (bundle axios/cheerio/crypto-js). */
  depsSource: string;
}

export interface WarmupSummary {
  compiled: string[];
  failed: Array<{ id: string; error: string }>;
  depsOk: boolean;
}

export interface CompiledProvider {
  id: string;
  updatedAt: number;
  getStreams: (args: unknown[]) => Promise<unknown> | unknown;
}

/** Estado: id → proveedor compilado durante el arranque. */
const providerModules = new Map<string, CompiledProvider>();
let compiledDeps: Record<string, unknown> | null = null;
interface BufferLike {
  (value?: unknown, encoding?: string): unknown;
  isBuffer(value: unknown): boolean;
  from(value: unknown, encoding?: string): unknown;
}

interface PlainBufferLike {
  readonly bytes: Uint8Array;
  toString(encoding?: string): string;
}

/**
 * Buffer compatible con el runtime de escritorio: Buffer.from(...).toString("base64"),
 * Buffer.isBuffer. Devuelve una envoltura con toString (los scripts del hub no
 * requieren aritmética binaria real).
 */
class PlainBuffer implements PlainBufferLike {
  readonly bytes: Uint8Array;

  constructor(value?: unknown, encoding?: string) {
    this.bytes = PlainBuffer.toBytes(value, encoding);
  }

  get length(): number {
    return this.bytes.length;
  }

  static toBytes(value: unknown, encoding?: string): Uint8Array {
    if (typeof value === "string") {
      const mode = String(encoding || "utf8").toLowerCase();
      if (mode === "base64" || mode === "base64url") {
        let encoded = value.replace(/-/g, "+").replace(/_/g, "/");
        encoded += "=".repeat((4 - encoded.length % 4) % 4);
        const binary = atob(encoded);
        return new Uint8Array(Array.from(binary, character => character.charCodeAt(0)));
      }
      if (mode === "hex") {
        const bytes: number[] = [];
        for (let index = 0; index + 1 < value.length; index += 2) bytes.push(parseInt(value.slice(index, index + 2), 16));
        return new Uint8Array(bytes);
      }
      return new TextEncoder().encode(value);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (Array.isArray(value)) return new Uint8Array(value);
    return new Uint8Array(0);
  }

  toString(encoding?: string): string {
    const mode = String(encoding || "utf8").toLowerCase();
    const bytes = this.bytes;
    if (mode === "hex") {
      return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    }
    if (mode === "binary" || mode === "latin1") {
      return Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    }
    if (mode === "base64" || mode === "base64url") {
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += Array.from(bytes.subarray(offset, offset + 8192), byte => String.fromCharCode(byte)).join("");
      }
      const encoded = btoa(binary);
      return mode === "base64url" ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : encoded;
    }
    return new TextDecoder().decode(bytes);
  }
}

const BufferShim = Object.assign(
  (value?: unknown, encoding?: string) => new PlainBuffer(value, encoding),
  {
    isBuffer: (value: unknown): boolean => value instanceof Uint8Array || value instanceof PlainBuffer,
    from: (value: unknown, encoding?: string): PlainBuffer => new PlainBuffer(value, encoding),
  },
) as unknown as BufferLike;

type WorkerFetch = typeof fetch;

/** fetch limitado al sandbox: solo http(s), respuesta materializada con límite de tamaño. */
function sandboxFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string"
    ? input
    : input instanceof URL ? input.href : (input as Request).url;
  if (!/^https?:\/\//i.test(url)) {
    return Promise.reject(new Error("Provider fetch solo admite http(s)"));
  }
  const initRequest = init && (init.method || init.headers || init.body !== undefined)
    ? new Request(url, init)
    : null;
  return fetch(url, initRequest ?? { ...init, redirect: "follow" }).then(async response => {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_MODULE_FETCH_BYTES) {
      throw new Error(`Respuesta demasiado grande (${buffer.byteLength} bytes)`);
    }
    const cloned = new Response(buffer.byteLength ? buffer : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    try {
      Object.defineProperty(cloned, "url", { value: response.url, configurable: true });
      Object.defineProperty(cloned, "redirected", { value: response.url !== url, configurable: true });
    } catch {
      // Sin mutable url: los proveedores solo lo usan informativamente.
    }
    return cloned;
  });
}

function providerRequire(name: string): unknown {
  const normalized = String(name);
  if (!compiledDeps) throw new Error("Dependencias del runtime no cargadas");
  if (normalized === "axios") return compiledDeps.axios;
  if (normalized === "crypto-js") return compiledDeps.CryptoJS;
  if (normalized === "cheerio" || normalized === "cheerio-without-node-native") return compiledDeps.cheerio;
  throw new Error("Provider module is not allowed: " + normalized);
}

/**
 * Momento del arranque: compila el bundle de dependencias y cada script de
 * proveedor. Debe llamarse una única vez desde la evaluación del módulo.
 */
export async function warmupProviders(entries: WarmupEntry[]): Promise<WarmupSummary> {
  providerModules.clear();
  compiledDeps = null;

  const summary: WarmupSummary = { compiled: [], failed: [], depsOk: false };
  const firstEntry = entries.find(entry => entry.depsSource);
  if (firstEntry) {
    try {
      compiledDeps = compileDepsBundle(firstEntry.depsSource);
      summary.depsOk = compiledDeps !== null;
    } catch (error) {
      console.error("[HUB:SANDBOX] No se pudo compilar provider-deps", error);
      summary.failed.push({ id: "(deps)", error: describe(error) });
    }
  }

  for (const entry of entries) {
    if (!entry.source) continue;
    if (!summary.depsOk) {
      summary.failed.push({ id: entry.id, error: "deps no disponibles" });
      continue;
    }
    try {
      const module = compileProviderModule(entry.source);
      if (!module) throw new Error("compilación sin resultado");
      providerModules.set(entry.id, {
        id: entry.id,
        updatedAt: entry.updatedAt,
        getStreams: module,
      });
      summary.compiled.push(entry.id);
    } catch (error) {
      console.error(`[HUB:SANDBOX] Script inválido para ${entry.id}`, error);
      summary.failed.push({ id: entry.id, error: describe(error) });
    }
  }
  return summary;
}

function compileDepsBundle(bundleText: string): Record<string, unknown> | null {
  const sandboxGlobals = {} as Record<string, unknown>;
  const factory = new Function(
    "self",
    "globalThis",
    "Buffer",
    `${bundleText}\nreturn self.__PROVIDER_RUNTIME_DEPS__ ?? null;`,
  );
  const deps = factory(sandboxGlobals, sandboxGlobals, undefined) as Record<string, unknown> | null;
  return deps && typeof deps === "object" ? deps : null;
}

type ModuleFactory = (
  process: { env: Record<string, string> },
  module: { exports: Record<string, unknown> },
  exports: unknown,
  require: (name: string) => unknown,
  fetch: WorkerFetch,
  buffer: BufferLike,
  window?: unknown,
  global?: unknown,
) => unknown;

function compileProviderModule(source: string): CompiledProvider["getStreams"] | null {
  const factory = new Function(
    "process",
    "module",
    "exports",
    "require",
    "fetch",
    "Buffer",
    "window",
    "global",
    `"use strict";\n${source}\n;return module.exports;`,
  ) as unknown as ModuleFactory;

  // La evaluación del módulo (top-level del script) corre una sola vez, aquí,
  // dentro del arranque. `require`/`fetch`/`Buffer` quedan fijos para siempre.
  const moduleObject: { exports: Record<string, unknown> } = { exports: {} };
  const moduleExports = factory(
    { env: {} },
    moduleObject,
    moduleObject.exports,
    name => providerRequire(name),
    sandboxFetch as unknown as WorkerFetch,
    BufferShim,
    undefined,
    undefined,
  );

  const pool: Array<Record<string, unknown>> = [moduleObject.exports];
  if (moduleExports !== undefined && moduleExports !== null && typeof moduleExports === "object") pool.push(moduleExports as Record<string, unknown>);
  for (const candidate of pool) {
    if (typeof candidate.getStreams === "function") return (candidate.getStreams as CompiledProvider["getStreams"]).bind(candidate);
    const nested = candidate.default as Record<string, unknown> | undefined;
    if (nested && typeof nested.getStreams === "function") return (nested.getStreams as CompiledProvider["getStreams"]).bind(nested);
  }
  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Información del proveedor compilado (para detectar scripts obsoletos). */
export function compiledProviderInfo(id: string): { updatedAt: number } | null {
  const entry = providerModules.get(id);
  return entry ? { updatedAt: entry.updatedAt } : null;
}

/**
 * Ejecuta `getStreams` ya compilado. No hace codegen: todo lo compilable se
 * compiló en warmupProviders().
 */
export async function runProviderScript(id: string, args: unknown[]): Promise<MediaStream[]> {
  const entry = providerModules.get(id);
  if (!entry) throw new Error(`Proveedor ${id} sin módulo compilado (arranque)`);
  const result = await raceTimeout(entry.getStreams(args), PROVIDER_CALL_TIMEOUT_MS);
  return Array.isArray(result)
    ? (result as MediaStream[]).slice(0, MAX_STREAMS_PER_PROVIDER)
    : [];
}

function raceTimeout(promise: Promise<unknown> | unknown, timeoutMs: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<MediaStream[]>(resolve => {
    timer = setTimeout(() => resolve([]), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
