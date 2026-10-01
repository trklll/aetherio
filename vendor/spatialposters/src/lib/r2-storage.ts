import crypto from "node:crypto"
import { envWithFallback } from "@/lib/env-compat"
import { createLogger } from "@/lib/logger"

const log = createLogger("r2-storage")

function getEnv(key: string): string | undefined {
  return process.env[key] || envWithFallback(key)
}

export function getR2Config() {
  const accountId = getEnv("R2_ACCOUNT_ID")
  const accessKeyId = getEnv("R2_ACCESS_KEY_ID")
  const secretAccessKey = getEnv("R2_SECRET_ACCESS_KEY")
  const bucket = getEnv("R2_BUCKET_NAME") || "spatialposters"
  const publicDomain = getEnv("R2_PUBLIC_DOMAIN")

  if (!accountId || !accessKeyId || !secretAccessKey) {
    return null
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint, publicDomain }
}

export function isR2Configured(): boolean {
  return getR2Config() !== null
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest()
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex")
}

function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Buffer {
  const kDate = hmacSha256("AWS4" + key, dateStamp)
  const kRegion = hmacSha256(kDate, regionName)
  const kService = hmacSha256(kRegion, serviceName)
  return hmacSha256(kService, "aws4_request")
}

function signRequest({
  method,
  path,
  queryParams = "",
  headers,
  payloadHash,
  accessKeyId,
  secretAccessKey,
  region = "auto",
  service = "s3",
}: {
  method: string
  path: string
  queryParams?: string
  headers: Record<string, string>
  payloadHash: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  service?: string
}): Record<string, string> {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "")
  const dateStamp = amzDate.slice(0, 8)

  const signedHeadersMap: Record<string, string> = {
    ...headers,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  }

  // Canonical headers
  const sortedHeaderKeys = Object.keys(signedHeadersMap)
    .map((k) => k.toLowerCase())
    .sort()

  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${signedHeadersMap[Object.keys(signedHeadersMap).find((orig) => orig.toLowerCase() === k)!].trim()}\n`)
    .join("")

  const signedHeadersStr = sortedHeaderKeys.join(";")

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    queryParams,
    canonicalHeaders,
    signedHeadersStr,
    payloadHash,
  ].join("\n")

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n")

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service)
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex")

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`

  return {
    ...signedHeadersMap,
    Authorization: authorizationHeader,
  }
}

export interface R2ObjectPayload {
  readonly buffer: Buffer
  readonly contentType: string
  readonly etag: string
}

export async function getR2Poster(key: string): Promise<R2ObjectPayload | null> {
  const config = getR2Config()
  if (!config) return null

  // If public domain is configured, we can do a fast unauthenticated fetch
  if (config.publicDomain) {
    try {
      const publicUrl = config.publicDomain.startsWith("http")
        ? `${config.publicDomain.replace(/\/$/, "")}/${key}`
        : `https://${config.publicDomain.replace(/\/$/, "")}/${key}`

      const res = await fetch(publicUrl, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer()
        const buffer = Buffer.from(arrayBuf)
        const contentType = res.headers.get("content-type") || "image/jpeg"
        const etag = res.headers.get("etag") || `"${sha256Hex(buffer).slice(0, 16)}"`
        return { buffer, contentType, etag }
      }
    } catch (err) {
      log.warn("Public R2 domain fetch failed, falling back to S3 API", { key, err })
    }
  }

  // Fallback to authenticated S3 API GET
  try {
    const host = `${config.accountId}.r2.cloudflarestorage.com`
    const path = `/${config.bucket}/${key}`
    const payloadHash = sha256Hex("")

    const signedHeaders = signRequest({
      method: "GET",
      path,
      headers: { host },
      payloadHash,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })

    const res = await fetch(`https://${host}${path}`, {
      method: "GET",
      headers: signedHeaders,
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) {
      if (res.status !== 404) {
        log.warn("R2 GET returned non-200 status", { status: res.status, key })
      }
      return null
    }

    const arrayBuf = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const contentType = res.headers.get("content-type") || "image/jpeg"
    const etag = res.headers.get("etag") || `"${sha256Hex(buffer).slice(0, 16)}"`
    return { buffer, contentType, etag }
  } catch (err) {
    log.error("Failed to read from Cloudflare R2", { key, err })
    return null
  }
}

export async function putR2Poster(
  key: string,
  buffer: Buffer,
  contentType: string = "image/jpeg",
  metadata: Record<string, string> = {}
): Promise<boolean> {
  const config = getR2Config()
  if (!config) return false

  try {
    const host = `${config.accountId}.r2.cloudflarestorage.com`
    const path = `/${config.bucket}/${key}`
    const payloadHash = sha256Hex(buffer)

    const baseHeaders: Record<string, string> = {
      host,
      "content-type": contentType,
      "content-length": buffer.length.toString(),
    }

    for (const [mKey, mVal] of Object.entries(metadata)) {
      baseHeaders[`x-amz-meta-${mKey.toLowerCase()}`] = mVal
    }

    const signedHeaders = signRequest({
      method: "PUT",
      path,
      headers: baseHeaders,
      payloadHash,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })

    const res = await fetch(`https://${host}${path}`, {
      method: "PUT",
      headers: signedHeaders,
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      log.error("Failed to upload poster to R2", { status: res.status, key })
      return false
    }

    log.info("Poster cached successfully in R2", { key, sizeBytes: buffer.length })
    return true
  } catch (err) {
    log.error("Error writing to R2", { key, err })
    return false
  }
}

export async function deleteR2Poster(key: string): Promise<boolean> {
  const config = getR2Config()
  if (!config) return false

  try {
    const host = `${config.accountId}.r2.cloudflarestorage.com`
    const path = `/${config.bucket}/${key}`
    const payloadHash = sha256Hex("")

    const signedHeaders = signRequest({
      method: "DELETE",
      path,
      headers: { host },
      payloadHash,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })

    const res = await fetch(`https://${host}${path}`, {
      method: "DELETE",
      headers: signedHeaders,
      signal: AbortSignal.timeout(6000),
    })

    return res.ok || res.status === 404
  } catch (err) {
    log.error("Error deleting from R2", { key, err })
    return false
  }
}
