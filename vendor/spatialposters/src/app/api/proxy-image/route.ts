import { NextRequest } from "next/server"
import { fetchImg } from "@/lib/poster-render-helpers"

export const maxDuration = 30

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") || h.endsWith(".internal")) {
    return true
  }
  // Check private IP ranges
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) {
    return true
  }
  const match172 = /^172\.(\d+)\./.exec(h)
  if (match172) {
    const octet = parseInt(match172[1], 10)
    if (octet >= 16 && octet <= 31) return true
  }
  return false
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")
  if (!rawUrl) {
    return new Response("Missing url parameter", { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return new Response("Invalid url format", { status: 400 })
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("Only HTTP/HTTPS URLs supported", { status: 400 })
  }

  if (isPrivateHostname(parsed.hostname)) {
    return new Response("Access to private/internal hosts forbidden", { status: 403 })
  }

  try {
    let targetUrl = parsed.toString()
    const isWebpage =
      targetUrl.includes("pin.it") ||
      (targetUrl.includes("pinterest.com") && !targetUrl.includes("i.pinimg.com")) ||
      (targetUrl.includes("reddit.com") && !targetUrl.includes("i.redd.it") && !targetUrl.includes("preview.redd.it")) ||
      (!targetUrl.match(/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/i) &&
        !targetUrl.includes("i.pinimg.com") &&
        !targetUrl.includes("i.redd.it") &&
        !targetUrl.includes("i.imgur.com"))

    if (isWebpage) {
      try {
        const { resolveToImageUrl } = await import("@/app/api/resolve-image/route")
        const resolved = await resolveToImageUrl(targetUrl)
        if (resolved?.imageUrl) {
          targetUrl = resolved.imageUrl
        }
      } catch {
        // Fallback to original URL
      }
    }

    const buffer = await fetchImg(targetUrl)
    
    // Guess content-type based on buffer header magic bytes or default to image/jpeg
    let contentType = "image/jpeg"
    if (buffer.length >= 4) {
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        contentType = "image/png"
      } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        contentType = "image/gif"
      } else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        contentType = "image/webp"
      }
    }

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    })
  } catch (err) {
    console.error("[proxy-image] Failed to fetch external image:", err)
    return new Response("Failed to fetch image", { status: 502 })
  }
}
