import crypto from "node:crypto"
import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"
import { cacheGet, cacheSet } from "@/lib/cache"
import { hashKey } from "@/lib/poster-render-helpers"

const log = createLogger("cloudinary-storage")

export interface CloudinaryConfig {
  cloudName: string
  apiKey: string
  apiSecret: string
}

function getEnv(key: string): string | undefined {
  return process.env[key] || envWithFallback(key)
}

/**
 * Parses Cloudinary configuration from individual env vars or CLOUDINARY_URL string.
 */
export function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = getEnv("CLOUDINARY_CLOUD_NAME")
  const apiKey = getEnv("CLOUDINARY_API_KEY")
  const apiSecret = getEnv("CLOUDINARY_API_SECRET")

  if (cloudName && apiKey && apiSecret) {
    return { cloudName: cloudName.trim(), apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }
  }

  const urlStr = getEnv("CLOUDINARY_URL")
  if (urlStr) {
    try {
      // Format: cloudinary://<api_key>:<api_secret>@<cloud_name>
      const parsed = new URL(urlStr)
      if (parsed.protocol === "cloudinary:") {
        const cName = parsed.hostname
        const key = parsed.username
        const secret = parsed.password
        if (cName && key && secret) {
          return { cloudName: cName, apiKey: key, apiSecret: secret }
        }
      }
    } catch {
      // Ignore parse error
    }
  }

  return null
}

export function isCloudinaryConfigured(): boolean {
  return getCloudinaryConfig() !== null
}

const useKv = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
const urlRegistryMap = new Map<string, string>()

export function getCloudinaryCachedUrl(cacheKey: string): string | null {
  const storeKey = `cloudinary:url:${hashKey(cacheKey)}`
  const memoryUrl = urlRegistryMap.get(storeKey)
  if (memoryUrl) return memoryUrl

  const cached = cacheGet<string>(storeKey)
  if (cached) {
    urlRegistryMap.set(storeKey, cached)
    return cached
  }
  return null
}

export async function getCloudinaryCachedUrlAsync(cacheKey: string): Promise<string | null> {
  const memoryUrl = getCloudinaryCachedUrl(cacheKey)
  if (memoryUrl) return memoryUrl

  if (useKv) {
    try {
      const storeKey = `cloudinary:url:${hashKey(cacheKey)}`
      const { kv } = await import("@vercel/kv")
      const raw = await kv.get<string>(storeKey)
      if (typeof raw === "string" && raw) {
        urlRegistryMap.set(storeKey, raw)
        cacheSet(storeKey, raw, ["cloudinary"], 30 * 24 * 60 * 60 * 1000)
        return raw
      }
    } catch (e) {
      log.warn("KV cloudinaryUrl read failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }

  return null
}

export async function setCloudinaryCachedUrlAsync(cacheKey: string, url: string, ttlMs?: number): Promise<void> {
  const storeKey = `cloudinary:url:${hashKey(cacheKey)}`
  urlRegistryMap.set(storeKey, url)
  const defaultTtlMs = 30 * 24 * 60 * 60 * 1000 // 30 days
  const effectiveTtlMs = ttlMs ?? defaultTtlMs
  cacheSet(storeKey, url, ["cloudinary"], effectiveTtlMs)

  if (useKv) {
    try {
      const { kv } = await import("@vercel/kv")
      const ttlSec = Math.max(60, Math.round(effectiveTtlMs / 1000))
      await kv.set(storeKey, url, { ex: ttlSec })
    } catch (e) {
      log.warn("KV cloudinaryUrl write failed", { error: e instanceof Error ? e.message : String(e) })
    }
  }
}

export interface CloudinaryUploadResult {
  readonly secure_url: string
  readonly public_id: string
  readonly format?: string
  readonly bytes?: number
}

/**
 * Builds a structured, predictable Cloudinary public ID.
 * Examples:
 *   - "spatialposters/movie/550"
 *   - "spatialposters/tv/13916"
 *   - "spatialposters/tv/13916/clean-1"
 */
export function buildCloudinaryPublicId(mediaType: string, tmdbId: number | string, subType?: string): string {
  const type = mediaType === "tv" ? "tv" : "movie"
  const base = `spatialposters/${type}/${tmdbId}`
  if (subType) {
    const cleanSub = subType.replace(/^\/+|\/+$/g, "")
    return `${base}/${cleanSub}`
  }
  return base
}

/**
 * Generates SHA1 signature for Cloudinary upload API.
 * Parameters must be sorted alphabetically by key.
 */
export function generateCloudinarySignature(params: Record<string, string | number | boolean>, apiSecret: string): string {
  const sortedKeys = Object.keys(params).sort()
  const toSign = sortedKeys.map((k) => `${k}=${params[k]}`).join("&")
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex")
}

export function optimizeCloudinaryUrl(url: string): string {
  if (url.includes("/image/upload/") && !url.includes("/f_auto")) {
    return url.replace("/image/upload/", "/image/upload/f_auto,q_auto/")
  }
  return url
}

export async function uploadToCloudinary(
  buffer: Buffer,
  publicId?: string,
  options: { overwrite?: boolean; invalidate?: boolean } = {}
): Promise<CloudinaryUploadResult | null> {
  const config = getCloudinaryConfig()
  if (!config) return null

  try {
    const timestamp = Math.floor(Date.now() / 1000)
    const overwrite = options.overwrite ?? true
    const invalidate = options.invalidate ?? true

    const paramsToSign: Record<string, string | number | boolean> = {
      invalidate,
      overwrite,
      timestamp,
    }

    if (publicId) {
      paramsToSign.public_id = publicId
    }

    const signature = generateCloudinarySignature(paramsToSign, config.apiSecret)

    const base64Data = `data:image/jpeg;base64,${buffer.toString("base64")}`
    const formData = new URLSearchParams()
    formData.append("file", base64Data)
    formData.append("api_key", config.apiKey)
    formData.append("timestamp", String(timestamp))
    formData.append("overwrite", String(overwrite))
    formData.append("invalidate", String(invalidate))
    if (publicId) {
      formData.append("public_id", publicId)
    }
    formData.append("signature", signature)

    const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    })

    if (!res.ok) {
      const errText = await res.text()
      log.error("Cloudinary upload API returned error", { status: res.status, body: errText })
      return null
    }

    const data = (await res.json()) as { secure_url?: string; public_id?: string; format?: string; bytes?: number }
    if (typeof data.secure_url === "string" && data.secure_url.length > 0) {
      const optimizedUrl = optimizeCloudinaryUrl(data.secure_url)
      log.info("Poster successfully uploaded to Cloudinary", {
        url: optimizedUrl,
        publicId: data.public_id,
        bytes: data.bytes,
      })
      return {
        secure_url: optimizedUrl,
        public_id: data.public_id || publicId || "",
        format: data.format,
        bytes: data.bytes,
      }
    }

    log.warn("Cloudinary upload succeeded but no secure_url returned", { data })
    return null
  } catch (err) {
    log.error("Failed to upload image to Cloudinary", { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}
