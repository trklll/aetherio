import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"
import { cacheGet, cacheSet } from "@/lib/cache"
import { hashKey } from "@/lib/poster-render-helpers"

const log = createLogger("imgbb-storage")

function getImgBBApiKey(): string | undefined {
  return process.env.IMGBB_API_KEY || envWithFallback("IMGBB_API_KEY")
}

export function isImgBBConfigured(): boolean {
  const key = getImgBBApiKey()
  return typeof key === "string" && key.trim().length > 0
}

const useKv = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const urlRegistryMap = new Map<string, string>()

export function getImgBBCachedUrl(cacheKey: string): string | null {
  const storeKey = `imgbb:url:${hashKey(cacheKey)}`
  const memoryUrl = urlRegistryMap.get(storeKey)
  if (memoryUrl) return memoryUrl

  const cached = cacheGet<string>(storeKey)
  if (cached) {
    urlRegistryMap.set(storeKey, cached)
    return cached
  }
  return null
}

export async function getImgBBCachedUrlAsync(cacheKey: string): Promise<string | null> {
  const memoryUrl = getImgBBCachedUrl(cacheKey)
  if (memoryUrl) return memoryUrl

  if (useKv) {
    try {
      const storeKey = `imgbb:url:${hashKey(cacheKey)}`
      const { kv } = await import("@vercel/kv")
      const raw = await kv.get<string>(storeKey)
      if (typeof raw === "string" && raw) {
        urlRegistryMap.set(storeKey, raw)
        cacheSet(storeKey, raw, ["imgbb"], 30 * 24 * 60 * 60 * 1000)
        return raw
      }
    } catch (e) {
      log.warn("KV imgbbUrl read failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }

  return null
}

export function setImgBBCachedUrl(cacheKey: string, url: string, ttlMs?: number): void {
  void setImgBBCachedUrlAsync(cacheKey, url, ttlMs)
}

export async function setImgBBCachedUrlAsync(cacheKey: string, url: string, ttlMs?: number): Promise<void> {
  const storeKey = `imgbb:url:${hashKey(cacheKey)}`
  urlRegistryMap.set(storeKey, url)
  const defaultTtlMs = 30 * 24 * 60 * 60 * 1000 // 30 days
  const effectiveTtlMs = ttlMs ?? defaultTtlMs
  cacheSet(storeKey, url, ["imgbb"], effectiveTtlMs)

  if (useKv) {
    try {
      const { kv } = await import("@vercel/kv")
      const ttlSec = Math.max(60, Math.round(effectiveTtlMs / 1000))
      await kv.set(storeKey, url, { ex: ttlSec })
    } catch (e) {
      log.warn("KV imgbbUrl write failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }
}

export interface ImgBBUploadResult {
  readonly url: string
  readonly displayUrl: string
  readonly deleteUrl?: string
}

export async function uploadToImgBB(
  buffer: Buffer,
  name?: string
): Promise<ImgBBUploadResult | null> {
  const apiKey = getImgBBApiKey()
  if (!apiKey) return null

  try {
    const base64Data = buffer.toString("base64")
    const formData = new URLSearchParams()
    formData.append("image", base64Data)
    if (name) {
      formData.append("name", name)
    }

    const endpoint = `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      log.error("ImgBB upload failed with non-200 status", { status: res.status, error: errText })
      return null
    }

    const json = await res.json()
    if (!json?.success || !json?.data?.url) {
      log.error("ImgBB response missing success/url field", { json })
      return null
    }

    const result: ImgBBUploadResult = {
      url: json.data.url,
      displayUrl: json.data.display_url || json.data.url,
      deleteUrl: json.data.delete_url,
    }

    log.info("Poster successfully uploaded to ImgBB", { url: result.displayUrl, sizeBytes: buffer.length })
    return result
  } catch (err) {
    log.error("Error uploading image to ImgBB", { err: err instanceof Error ? err.message : String(err) })
    return null
  }
}
