import type { NextRequest } from "next/server"
import { cacheGet, cacheGetStale, cacheSet } from "@/lib/cache"
import { createLogger } from "@/lib/logger"
import { envWithFallback } from "@/lib/env-compat"
import { isR2Configured, getR2Poster, putR2Poster, deleteR2Poster } from "@/lib/r2-storage"
import { isImgBBConfigured, uploadToImgBB, getImgBBCachedUrl, getImgBBCachedUrlAsync, setImgBBCachedUrlAsync } from "@/lib/imgbb-storage"
import { isCloudinaryConfigured, uploadToCloudinary, buildCloudinaryPublicId, getCloudinaryCachedUrl, getCloudinaryCachedUrlAsync, setCloudinaryCachedUrlAsync } from "@/lib/cloudinary-storage"
import { hashKey } from "@/lib/poster-render-helpers"

const log = createLogger("poster-cache")

export const POSTER_REFRESH_PARAM = "__poster_refresh"

const POSTER_CACHE_CONTROL = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800"
const POSTER_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable"
const PREVIEW_CACHE_CONTROL = "no-cache, no-store, must-revalidate, max-age=0"

export interface PosterCachePayload {
  readonly buffer: Buffer
  readonly etag: string
}

// TTL dei poster dinamici (non-mappati, composti al volo): default 6h.
// Sovrascrivibile via env a module level (un cambio richiede restart).
// Gli header Cache-Control/Surrogate derivano dallo STESSO valore del TTL di
// storage: l'header HTTP non può mentire rispetto a quanto resta in cache
// (coerente con fix M3).
const DYNAMIC_POSTER_TTL_SEC = (() => {
  const raw = envWithFallback("DYNAMIC_POSTER_TTL_MS")
  const n = raw ? parseInt(raw, 10) : 6 * 60 * 60 * 1000
  // Clamp 5min–24h: sotto i 5 minuti la CDN martellerebbe il render pipeline,
  // sopra le 24h i dati dinamici (rank, IMDb Top 250) diventano troppo stantii.
  return Number.isFinite(n) && n >= 5 * 60 * 1000 && n <= 24 * 60 * 60 * 1000
    ? Math.round(n / 1000)
    : 6 * 60 * 60
})()
const DYNAMIC_POSTER_TTL_MS = DYNAMIC_POSTER_TTL_SEC * 1000

const POSTER_DYNAMIC_CACHE_CONTROL = `public, max-age=${DYNAMIC_POSTER_TTL_SEC}, s-maxage=${DYNAMIC_POSTER_TTL_SEC}, stale-while-revalidate=86400`
const POSTER_CDN_CACHE_CONTROL = POSTER_CACHE_CONTROL
const POSTER_DYNAMIC_CDN_CACHE_CONTROL = POSTER_DYNAMIC_CACHE_CONTROL
const DYNAMIC_SURROGATE = `max-age=${DYNAMIC_POSTER_TTL_SEC}, stale-while-revalidate=86400`


export type PosterHeaders = Readonly<Record<string, string>>

export interface ImmutablePosterRequestState {
  readonly hasMapping?: boolean
  readonly isRotating?: boolean
  readonly mappingVersionMatches?: boolean
}

const inflight = new Map<string, Promise<PosterCachePayload | null>>()

const refreshInFlight = new Set<string>()
const lastRefreshAt = new Map<string, number>()
const MIN_REFRESH_INTERVAL_MS = 60_000
const MAX_REFRESH_TRACKED = 500

// Se un render in flight muore (crash/timeout serverless) senza chiamare la
// funzione di completamento, la promise resterebbe appesa nella map per sempre
// bloccando ogni richiesta successiva con la stessa cache key su await.
// Timeout difensivo: dopo N secondi risolve con null e libera la map.
const INFLIGHT_TIMEOUT_MS = 60_000

export function normalizePosterCacheParams(searchParams: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(searchParams)
  params.delete("rv")
  params.delete("v")
  params.delete(POSTER_REFRESH_PARAM)
  return params
}

export function isPosterRefreshRequest(searchParams: URLSearchParams): boolean {
  return searchParams.get(POSTER_REFRESH_PARAM) === "1"
}

export function isImmutablePosterRequest(searchParams: URLSearchParams, state: ImmutablePosterRequestState = {}): boolean {
  if (!searchParams.has("rv") || state.isRotating) return false
  // Senza mapping il poster NON può essere immutable per un anno: viene composto
  // al volo con dati dinamici (rank JustWatch, premi, IMDb Top 250) che cambiano
  // di settimana in settimana — un header immutable li congelerebbe alla CDN.
  // Con mapping, l'immutable richiede anche che il versionamento del mapping
  // (mv) corrisponda, altrimenti la cache edge può servire un poster stantio.
  return state.hasMapping === true && state.mappingVersionMatches === true
}

export type PosterImageFormat = "jpeg" | "webp" | "avif"

const FORMAT_MIME_TYPES: Record<PosterImageFormat, string> = {
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
}

export function resolveImageFormat(acceptHeader?: string | null, queryFmt?: string | null): PosterImageFormat {
  if (queryFmt) {
    const q = queryFmt.toLowerCase()
    if (q === "webp") return "webp"
    if (q === "avif") return "avif"
    if (q === "jpeg" || q === "jpg") return "jpeg"
  }
  if (!acceptHeader) return "jpeg"
  const accept = acceptHeader.toLowerCase()
  if (accept.includes("image/avif")) return "avif"
  if (accept.includes("image/webp")) return "webp"
  return "jpeg"
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "ETag, Cache-Control",
  "Vary": "Accept",
}

export function posterHeaders(etag: string, immutable: boolean, isPreview: boolean = false, dynamic: boolean = false, format: PosterImageFormat = "jpeg"): PosterHeaders {
  const contentType = FORMAT_MIME_TYPES[format] || "image/jpeg"
  if (isPreview) {
    return {
      ...CORS_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": PREVIEW_CACHE_CONTROL,
      "Pragma": "no-cache",
      "Expires": "0",
      "ETag": etag,
    }
  }
  const cacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? POSTER_DYNAMIC_CACHE_CONTROL : POSTER_CACHE_CONTROL
  const cdnCacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? POSTER_DYNAMIC_CDN_CACHE_CONTROL : POSTER_CDN_CACHE_CONTROL
  const surrogate = immutable ? "max-age=31536000" : dynamic ? DYNAMIC_SURROGATE : "max-age=86400, stale-while-revalidate=604800"
  return {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cdnCacheControl,
    "Surrogate-Control": surrogate,
    "ETag": etag,
  }
}

export function posterNotModifiedHeaders(etag: string, immutable: boolean, dynamic: boolean = false): PosterHeaders {
  const cacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? POSTER_DYNAMIC_CACHE_CONTROL : POSTER_CACHE_CONTROL
  const cdnCacheControl = immutable ? POSTER_IMMUTABLE_CACHE_CONTROL : dynamic ? POSTER_DYNAMIC_CDN_CACHE_CONTROL : POSTER_CDN_CACHE_CONTROL
  const surrogate = immutable ? "max-age=31536000" : dynamic ? DYNAMIC_SURROGATE : "max-age=86400, stale-while-revalidate=604800"
  return {
    ...CORS_HEADERS,
    "Cache-Control": cacheControl,
    "CDN-Cache-Control": cdnCacheControl,
    "Surrogate-Control": surrogate,
    "ETag": etag,
  }
}

export function posterResponse(payload: PosterCachePayload, immutable: boolean, isPreview: boolean = false, dynamic: boolean = false, format: PosterImageFormat = "jpeg"): Response {
  return new Response(new Uint8Array(payload.buffer), { headers: posterHeaders(payload.etag, immutable, isPreview, dynamic, format) })
}

export function makeR2ObjectKey(cacheKey: string, format: PosterImageFormat = "jpeg"): string {
  return `posters/${hashKey(cacheKey)}.${format}`
}

export function readCachedPoster(cacheKey: string): { readonly payload: PosterCachePayload | null; readonly stale: boolean } {
  const cached = cacheGetStale<Buffer>(cacheKey)
  const cachedHeaders = cacheGetStale<{ etag: string }>(`${cacheKey}:headers`)
  if (!cached.data || !cachedHeaders.data) return { payload: null, stale: false }
  return {
    payload: { buffer: cached.data, etag: cachedHeaders.data.etag },
    stale: cached.stale || cachedHeaders.stale,
  }
}

export async function readCachedPosterAsync(
  cacheKey: string,
  format: PosterImageFormat = "jpeg"
): Promise<{ readonly payload: PosterCachePayload | null; readonly imgbbUrl?: string | null; readonly stale: boolean }> {
  // 1. Check L1 in-memory cache
  const local = readCachedPoster(cacheKey)
  if (local.payload) {
    const memoryImgbbUrl = getCloudinaryCachedUrl(cacheKey) || getImgBBCachedUrl(cacheKey)
    return { ...local, imgbbUrl: memoryImgbbUrl }
  }

  // 2. Check Cloudinary storage cache (persistent URL)
  if (isCloudinaryConfigured()) {
    const cUrl = await getCloudinaryCachedUrlAsync(cacheKey)
    if (cUrl) {
      log.debug("Cloudinary poster cache hit (URL ready)", { cacheKey, cloudinaryUrl: cUrl })
      return { payload: null, imgbbUrl: cUrl, stale: false }
    }
  }

  // 3. Check ImgBB free image storage cache (persistent URL from KV / RAM)
  if (isImgBBConfigured()) {
    const imgbbUrl = await getImgBBCachedUrlAsync(cacheKey)
    if (imgbbUrl) {
      log.debug("ImgBB poster cache hit (URL ready)", { cacheKey, imgbbUrl })
      return { payload: null, imgbbUrl, stale: false }
    }
  }

  // 3. Check Cloudflare R2 storage cache
  if (isR2Configured()) {
    const r2Key = makeR2ObjectKey(cacheKey, format)
    const r2Result = await getR2Poster(r2Key)
    if (r2Result) {
      const payload: PosterCachePayload = {
        buffer: r2Result.buffer,
        etag: r2Result.etag,
      }
      // Populate L1 memory cache (skipping re-upload to R2)
      writeCachedPoster(cacheKey, payload, undefined, format, true)
      log.debug("R2 poster cache hit", { cacheKey, r2Key })
      return { payload, imgbbUrl: null, stale: false }
    }
  }

  return { payload: null, imgbbUrl: null, stale: false }
}

// Poster non-mappati (composti al volo con dati dinamici): TTL esplicito
// (fix M3). Prima writeCachedPoster non passava alcun TTL → il tag "poster"
// finiva nel refresh schedulato giornaliero alle 3 UTC (cache.ts) e l'header
// HTTP dynamic (6h) mentiva: in memoria il payload restava fino al refresh
// delle 3, con rank/IMDb Top 250 potenzialmente stantii per un giorno intero.
// DYNAMIC_POSTER_TTL_MS è definito in testa al modulo (env-parametrizzato) e
// genera anche gli header dynamic, così header e storage restano sincronizzati.

export function writeCachedPoster(
  cacheKey: string,
  payload: PosterCachePayload,
  mappingTag?: string,
  format: PosterImageFormat = "jpeg",
  skipExternal: boolean = false,
  topLight?: boolean
): void {
  const tags = mappingTag ? ["poster", mappingTag] : ["poster"]
  // TTL esplicito solo per i non-mappati: per i mappati resta il refresh
  // schedulato giornaliero (immutable per un anno alla CDN, invalido per tag).
  const ttl = mappingTag ? undefined : DYNAMIC_POSTER_TTL_MS
  cacheSet(cacheKey, payload.buffer, tags, ttl)
  cacheSet(`${cacheKey}:headers`, { etag: payload.etag }, tags, ttl)

  if (!skipExternal && isCloudinaryConfigured()) {
    let publicId: string | undefined
    let mediaType: "movie" | "tv" | undefined
    let tmdbId: number | undefined

    if (mappingTag?.startsWith("poster:")) {
      const parts = mappingTag.split(":")
      if (parts.length === 3) {
        mediaType = parts[1] as "movie" | "tv"
        tmdbId = parseInt(parts[2], 10)
        if (Number.isFinite(tmdbId)) {
          publicId = buildCloudinaryPublicId(mediaType, tmdbId)
        }
      }
    }
    if (!publicId) {
      publicId = `spatialposters/dynamic/${hashKey(cacheKey)}`
    }

    const task = uploadToCloudinary(payload.buffer, publicId, { overwrite: true, invalidate: true }).then(async (res) => {
      if (res?.secure_url) {
        await setCloudinaryCachedUrlAsync(cacheKey, res.secure_url, ttl)
        await setImgBBCachedUrlAsync(cacheKey, res.secure_url, ttl)
        if (mediaType && tmdbId) {
          try {
            const { getById, upsert } = await import("@/lib/store")
            const existing = await getById(mediaType, tmdbId)
            if (existing) {
              const needsUpdate = existing.imgbbUrl !== res.secure_url || (topLight !== undefined && existing.topLight !== topLight)
              if (needsUpdate) {
                const updated = { ...existing, imgbbUrl: res.secure_url }
                if (topLight !== undefined) updated.topLight = topLight
                await upsert(updated)
                log.info("Attached Cloudinary URL to mapping in store", { mediaType, tmdbId, cloudinaryUrl: res.secure_url, topLight })
              }
            }
          } catch (err) {
            log.warn("Failed to update mapping imgbbUrl with Cloudinary URL in store", { err })
          }
        }
      }
    }).catch((err) => {
      log.warn("Async Cloudinary poster upload failed", { cacheKey, err })
    })

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { after } = require("next/server")
      if (typeof after === "function") {
        after(() => task)
      }
    } catch {
      // Background execution
    }
  } else if (!skipExternal && isImgBBConfigured()) {
    const task = uploadToImgBB(payload.buffer, hashKey(cacheKey)).then(async (res) => {
      if (res?.displayUrl) {
        await setImgBBCachedUrlAsync(cacheKey, res.displayUrl, ttl)
        if (mappingTag?.startsWith("poster:")) {
          const parts = mappingTag.split(":")
          if (parts.length === 3) {
            const mediaType = parts[1] as "movie" | "tv"
            const tmdbId = parseInt(parts[2], 10)
            if (Number.isFinite(tmdbId)) {
              try {
                const { getById, upsert } = await import("@/lib/store")
                const existing = await getById(mediaType, tmdbId)
                if (existing) {
                  const needsUpdate = existing.imgbbUrl !== res.displayUrl || (topLight !== undefined && existing.topLight !== topLight)
                  if (needsUpdate) {
                    const updated = { ...existing, imgbbUrl: res.displayUrl }
                    if (topLight !== undefined) updated.topLight = topLight
                    await upsert(updated)
                    log.info("Attached ImgBB URL to mapping in store", { mediaType, tmdbId, imgbbUrl: res.displayUrl, topLight })
                  }
                }
              } catch (err) {
                log.warn("Failed to update mapping imgbbUrl in store", { err })
              }
            }
          }
        }
      }
    }).catch((err) => {
      log.warn("Async ImgBB poster upload failed", { cacheKey, err })
    })

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { after } = require("next/server")
      if (typeof after === "function") {
        after(() => task)
      }
    } catch {
      void task
    }
  }

  if (!skipExternal && isR2Configured()) {
    const r2Key = makeR2ObjectKey(cacheKey, format)
    const contentType = FORMAT_MIME_TYPES[format] || "image/jpeg"
    const task = putR2Poster(r2Key, payload.buffer, contentType, { etag: payload.etag }).catch((err) => {
      log.warn("Async R2 poster cache write failed", { r2Key, err })
    })

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { after } = require("next/server")
      if (typeof after === "function") {
        after(() => task)
      }
    } catch {
      // Ignore
    }
  }
}

export function invalidateCachedPoster(cacheKey: string, format: PosterImageFormat = "jpeg"): void {
  if (isR2Configured()) {
    const r2Key = makeR2ObjectKey(cacheKey, format)
    deleteR2Poster(r2Key).catch((err) => {
      log.warn("Async R2 poster deletion failed", { r2Key, err })
    })
  }
}

// ---------------------------------------------------------------------------
// Negative cache (F3): un errore 500/503 recente evita di ri-rendere la stessa
// cache key per il TTL, altrimenti ogni retry ricolpisce upstream e slot con la
// pipeline completa. TTL breve: si svuota da sola, senza invalidation esplicita.
// ---------------------------------------------------------------------------

export type PosterErrorStatus = 500 | 503 | 404

export interface PosterErrorRecord {
  readonly status: PosterErrorStatus
}

const NEGATIVE_TTL_MS = (() => {
  const raw = envWithFallback("NEGATIVE_CACHE_TTL_MS")
  const n = raw ? parseInt(raw, 10) : 5000
  return Number.isFinite(n) && n >= 1000 && n <= 60000 ? n : 5000
})()

let negativeWrites = 0
let negativeHits = 0

export function writePosterError(cacheKey: string, status: PosterErrorStatus): void {
  negativeWrites++
  cacheSet(`${cacheKey}:err`, { status } satisfies PosterErrorRecord, ["poster-error"], NEGATIVE_TTL_MS)
}

export function readPosterError(cacheKey: string): PosterErrorRecord | null {
  const rec = cacheGet<PosterErrorRecord>(`${cacheKey}:err`)
  if (rec) negativeHits++
  return rec
}

/** Contatori della negative cache per /status. */
export function posterErrorStats(): { readonly writes: number; readonly hits: number } {
  return { writes: negativeWrites, hits: negativeHits }
}

export function getPendingPoster(cacheKey: string): Promise<PosterCachePayload | null> | null {
  return inflight.get(cacheKey) ?? null
}

export function beginPosterRender(cacheKey: string): (payload: PosterCachePayload | null) => void {
  // Race guard: non sovrascrivere un render già in corso. Chi arriva dopo
  // con la stessa cache key ha già atteso getPendingPoster(); se la promise
  // esiste ancora qui, il complete no-op evita di toccare la map dell'altro.
  if (inflight.has(cacheKey)) return () => {}

  let resolveRender: (payload: PosterCachePayload | null) => void = () => {}
  const promise = new Promise<PosterCachePayload | null>((resolve) => {
    resolveRender = resolve
  })
  const timer = setTimeout(() => {
    resolveRender(null)
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
  }, INFLIGHT_TIMEOUT_MS)
  if (typeof timer.unref === "function") timer.unref()
  inflight.set(cacheKey, promise)
  return (payload) => {
    clearTimeout(timer)
    resolveRender(payload)
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey)
  }
}

export function schedulePosterRefresh(req: NextRequest, isPreview: boolean = false): void {
  // Le preview (`preview=1`) non vengono servite alle CDN: rigenerarle in
  // background è inutile. Il refresh serve solo per riscaldare la cache edge.
  if (isPreview) return
  if (process.env.VERCEL) return // Serverless: nessun self-fetch in background
  const internalOrigin = `http://127.0.0.1:${process.env.PORT || "3000"}`
  const searchParams = new URLSearchParams(req.nextUrl.searchParams)
  // Fix M1: non inoltrare api_key in chiaro nell'URL di loopback — la chiave
  // viene passata via header x-api-key (come già fa il warmup dei cataloghi).
  // route.ts:167 rimuove già api_key dal cacheKey per non tenerla in memoria.
  const apiKeyForRefresh = searchParams.get("api_key") || req.headers.get("x-api-key") || undefined
  searchParams.delete("api_key")
  searchParams.delete("x-api-key")
  searchParams.set(POSTER_REFRESH_PARAM, "1")
  const refreshUrl = `${internalOrigin}${req.nextUrl.pathname}?${searchParams.toString()}`
  const key = `${req.nextUrl.pathname}?${searchParams.toString()}`
  // Dedup: non avviare due refresh concorrenti per la stessa URL.
  if (refreshInFlight.has(key)) return
  // Min-interval: evita che un titolo sotto attacco (o una catena di stale hit)
  // generi un self-fetch a ogni richiesta — la cache locale viene comunque
  // rigenerata dalla prima richiesta che arriva con il param di refresh.
  const now = Date.now()
  const last = lastRefreshAt.get(key)
  if (last !== undefined && now - last < MIN_REFRESH_INTERVAL_MS) return
  if (lastRefreshAt.size >= MAX_REFRESH_TRACKED) lastRefreshAt.delete(lastRefreshAt.keys().next().value!)
  lastRefreshAt.set(key, now)
  refreshInFlight.add(key)
  const refreshHeaders: Record<string, string> = {}
  if (apiKeyForRefresh) refreshHeaders["x-api-key"] = apiKeyForRefresh
  void fetch(refreshUrl, {
    headers: Object.keys(refreshHeaders).length > 0 ? refreshHeaders : undefined,
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (res) => {
      // Consuma/cancella il body per evitare memory leak senza allocare buffer enormi
      await res.body?.cancel().catch(() => {})
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn("Background refresh failed", { error: msg })
    })
    .finally(() => { refreshInFlight.delete(key) })
}

// ---------------------------------------------------------------------------
// Render concurrency limiter (anti-OOM)
// ---------------------------------------------------------------------------
// Un cache-miss tiene in memoria poster originali + logo + backdrop + buffer
// RGBA e i risultati delle composizioni sharp (decine di MB per richiesta).
// Su istanze con heap limitato (Docker: --max-old-space-size=384) un burst di
// miss su titoli diversi può portare a OOM senza backpressure. Questo limiter
// serializza i render costosi: le richieste in eccesso attendono un posto per
// un tempo limitato, poi ricevono 503 invece di accodarsi all'infinito.

export const MAX_CONCURRENT_RENDERS = (() => {
  const raw = envWithFallback("MAX_CONCURRENT_RENDERS")
  // Subido de 4 a 8 a proposito. Aetherio precarga todos los posters de Home en
  // la pantalla de carga y espera a que esten TODOS antes de entrar: con 4
  // slots, ~260 posters a ~2 s de render cada uno son del orden de 130 s, y
  // el cuello se nota como "las ultimas filas demoran". Con 8 se reduce a la
  // mitad. El render es sharp (CPU-bound) asi que subirlo de mas no ayuda y
  // sube el pico de memoria; 8 es el punto donde el pool de sockets del
  // navegador (6 por host) deja de ser el limite.
  const n = raw ? parseInt(raw, 10) : 8
  return Number.isFinite(n) && n > 0 && n <= 32 ? n : 8
})()
// Attesa massima di un posto di render prima del 503 (F5). Lettura a module
// level: un cambio env richiede restart, non hot-reload.
// Default 15000: le griglie catalogo (Stremio/AIOMetadata) richiedono ~20 poster
// in parallelo su cache fredda; con 4 slot e 5s molti ricevevano 503 (poster
// mancanti). I waiter non tengono buffer immagini (i fetch avvengono dentro lo
// slot), quindi allungare l'attesa è memory-neutral.
export const RENDER_SLOT_WAIT_MS = (() => {
  const raw = envWithFallback("RENDER_SLOT_WAIT_MS")
  // Subido de 15 s a 60 s (el tope del rango). Aetherio manda ~260 posteres en
  // paralelo al arrancar, y con 8 slots la cola de espera de los ultimos llega
  // a decenas de segundos. Con 15 s el que no cabia recibia 503 y se quedaba
  // sin poster; con 60 s la cola entera se drena dentro de la misma carga. Los
  // waiter no tienen buffer de imagenes (el fetch ocurre dentro del slot), asi
  // que alargar la espera no consume memoria extra.
  const n = raw ? parseInt(raw, 10) : 60000
  return Number.isFinite(n) && n >= 500 && n <= 60000 ? n : 60000
})()
// Coda bounded (opzionale): con 0 il comportamento è attuale (i waiter oltre i
// posti attendono fino a RENDER_SLOT_WAIT_MS). Con N>0 i waiter oltre N
// ricevono 503 immediato invece di accodarsi: backpressure senza code infinite.
const RENDER_QUEUE_LIMIT = (() => {
  const raw = envWithFallback("RENDER_QUEUE")
  const n = raw ? parseInt(raw, 10) : 0
  return Number.isFinite(n) && n >= 0 && n <= 128 ? n : 0
})()

let activeRenders = 0
let zombieRenders = 0
const renderWaiters: Array<() => void> = []

function pumpWaiters(): void {
  while (renderWaiters.length > 0 && activeRenders + zombieRenders < MAX_CONCURRENT_RENDERS) {
    const next = renderWaiters.shift()
    if (next) next()
  }
}

function releaseRenderSlot(): void {
  activeRenders = Math.max(0, activeRenders - 1)
  pumpWaiters()
}

/** Notifica al limiter che un render è stato abbandonato dalla deadline ma continua in background */
export function recordZombieRenderStart(): () => void {
  zombieRenders++
  return () => {
    zombieRenders = Math.max(0, zombieRenders - 1)
    pumpWaiters()
  }
}

/** Acquisisce un posto di render. Risolve con la release function, o null se il timeout scade. */
export async function acquirePosterRenderSlot(): Promise<(() => void) | null> {
  if (activeRenders + zombieRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++
    return releaseRenderSlot
  }
  if (RENDER_QUEUE_LIMIT > 0 && renderWaiters.length >= RENDER_QUEUE_LIMIT) {
    return null
  }
  return new Promise<(() => void) | null>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      const i = renderWaiters.indexOf(handoff)
      if (i >= 0) renderWaiters.splice(i, 1)
      resolve(null)
    }, RENDER_SLOT_WAIT_MS)
    const handoff = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeRenders++
      resolve(releaseRenderSlot)
    }
    renderWaiters.push(handoff)
  })
}

/** Solo per i test: svuota lo stato del limiter. */
export function __resetPosterRenderLimiter(): void {
  activeRenders = 0
  zombieRenders = 0
  renderWaiters.length = 0
}

// ---------------------------------------------------------------------------
// Poster metrics & telemetry
// ---------------------------------------------------------------------------

interface PosterStats {
  requests: number
  hits: number
  renders: number
  errors: number
  formats: {
    jpeg: number
    webp: number
    avif: number
  }
}

const posterMetrics: PosterStats = {
  requests: 0,
  hits: 0,
  renders: 0,
  errors: 0,
  formats: {
    jpeg: 0,
    webp: 0,
    avif: 0,
  },
}

export function recordPosterRequest(hit: boolean, format: PosterImageFormat = "jpeg"): void {
  posterMetrics.requests++
  if (hit) {
    posterMetrics.hits++
  } else {
    posterMetrics.renders++
  }
  posterMetrics.formats[format] = (posterMetrics.formats[format] || 0) + 1
}

export function recordPosterError(): void {
  posterMetrics.requests++
  posterMetrics.errors++
}

export function getPosterStats() {
  const hitRate = posterMetrics.requests > 0
    ? Math.round((posterMetrics.hits / posterMetrics.requests) * 1000) / 10
    : 0
  return {
    requests: posterMetrics.requests,
    hits: posterMetrics.hits,
    renders: posterMetrics.renders,
    errors: posterMetrics.errors,
    hitRate: `${hitRate}%`,
    hitRateNum: hitRate,
    formats: { ...posterMetrics.formats },
    activeRenders,
    queuedRenders: renderWaiters.length,
    maxConcurrent: MAX_CONCURRENT_RENDERS,
  }
}
