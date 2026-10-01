import { NextRequest } from "next/server"

export const maxDuration = 30

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

// Social bot UA to scrape og:image from pages that serve it to bots
const BOT_UA = "Twitterbot/1.0"

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true
  }
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  const match172 = /^172\.(\d+)\./.exec(h)
  if (match172) {
    const octet = parseInt(match172[1], 10)
    if (octet >= 16 && octet <= 31) return true
  }
  return false
}

/**
 * Guess if a URL is already a direct image URL (not a web page).
 */
function looksLikeDirectImage(url: string): boolean {
  try {
    const u = new URL(url)
    const p = u.pathname.toLowerCase()
    // Common image hosts with direct paths
    if (u.hostname === "i.pinimg.com") return true
    if (u.hostname === "i.redd.it") return true
    if (u.hostname === "i.imgur.com") return true
    if (u.hostname === "share.redd.it") return true
    if (u.hostname === "preview.redd.it") return true
    // Extension check
    if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/.test(p)) return true
  } catch {
    // ignore
  }
  return false
}

/**
 * For Pinterest: upgrade thumbnail sizes to /originals/ for best quality.
 * Handles paths like /736x/, /564x/, /474x/, /236x/, /75x75_RS/, etc.
 */
function upgradePinterestImageQuality(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname !== "i.pinimg.com") return url
    // Replace any size prefix like /736x/ /564x/ /474x/ /236x/ /75x75_RS/ with /originals/
    u.pathname = u.pathname.replace(/^\/(\d+x[\w]*)\//i, "/originals/")
    return u.toString()
  } catch {
    return url
  }
}

/**
 * For Reddit: handle media wrappers.
 * reddit.com/media?url=https://i.redd.it/... → extract i.redd.it URL
 * i.redd.it/... or preview.redd.it/... or share.redd.it/... → return as-is
 */
function tryResolveRedditDirectUrl(url: string): string | null {
  try {
    const u = new URL(url)
    // Direct image hosts
    if (u.hostname === "i.redd.it" || u.hostname === "i.imgur.com") return url
    // Pinterest direct images
    if (u.hostname === "i.pinimg.com") return upgradePinterestImageQuality(url)
    // share.redd.it preview — already an image endpoint
    if (u.hostname === "share.redd.it") return url
    // reddit.com/media?url=...
    if ((u.hostname === "www.reddit.com" || u.hostname === "reddit.com") && u.pathname === "/media") {
      const inner = u.searchParams.get("url")
      if (inner) return inner
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Extract the best og:image or twitter:image from HTML.
 */
function extractOgImage(html: string): string | null {
  // og:image
  let m = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  if (!m) m = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)
  if (!m) m = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
  if (!m) m = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i)
  // <link rel="image_src">
  if (!m) m = html.match(/<link[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)
  if (!m) {
    // Regex fallback for Pinterest images in script tags / HTML
    const pinMatch = html.match(/https:\/\/i\.pinimg\.com\/(?:originals|\d+x[\w]*)\/[a-f0-9\/]+\.(?:jpg|jpeg|png|webp)/i)
    if (pinMatch) return pinMatch[0]
    // Regex fallback for Reddit images
    const redditMatch = html.match(/https:\/\/(?:i|preview)\.redd\.it\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)/i)
    if (redditMatch) return redditMatch[0]
  }
  return m ? m[1] : null
}

/**
 * Resolve a URL to a direct image URL.
 * Steps:
 * 1. If it looks like a direct image, return immediately.
 * 2. If it's a Pinterest short link (pin.it), follow redirect → extract og:image → upgrade to /originals/.
 * 3. If it's a Reddit link, use bot UA / browser UA to extract og:image.
 * 4. For any other webpage, try fetching og:image with bot UA, then browser UA.
 */
export async function resolveToImageUrl(rawUrl: string): Promise<{ imageUrl: string; source: string }> {
  // 1. Direct reddit wrapper
  const directReddit = tryResolveRedditDirectUrl(rawUrl)
  if (directReddit) {
    return { imageUrl: directReddit, source: "direct" }
  }

  // 2. Already looks like a direct image
  if (looksLikeDirectImage(rawUrl)) {
    return { imageUrl: rawUrl, source: "direct" }
  }

  // 3. Fetch page HTML and extract og:image
  const parsed = new URL(rawUrl)
  const isPinterest = parsed.hostname === "pin.it" || parsed.hostname.endsWith("pinterest.com")
  const isReddit =
    parsed.hostname === "www.reddit.com" ||
    parsed.hostname === "reddit.com" ||
    parsed.hostname === "old.reddit.com" ||
    parsed.hostname === "redd.it"

  // Choose UA based on host
  let ua = isPinterest || isReddit ? BOT_UA : BROWSER_UA

  const res = await fetch(rawUrl, {
    headers: {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  })

  if (!res.ok) {
    throw new Error(`Page fetch failed: ${res.status}`)
  }

  const contentType = res.headers.get("content-type") || ""

  // If the response itself is already an image (share.redd.it, etc.)
  if (contentType.startsWith("image/")) {
    return { imageUrl: rawUrl, source: "direct" }
  }

  const html = await res.text()

  // Try og:image
  let ogImage = extractOgImage(html)
  if (!ogImage) {
    // Re-try with browser UA for Pinterest / Reddit / any page if bot UA failed
    const res2 = await fetch(rawUrl, {
      headers: { "User-Agent": BROWSER_UA },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    })
    if (res2.ok) {
      const html2 = await res2.text()
      ogImage = extractOgImage(html2)
    }
  }

  if (!ogImage) {
    throw new Error("Could not extract image from page")
  }

  // Upgrade Pinterest image quality
  if (ogImage.includes("pinimg.com")) {
    ogImage = upgradePinterestImageQuality(ogImage)
  }

  return { imageUrl: ogImage, source: "og:image" }
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")
  if (!rawUrl) {
    return Response.json({ error: "Missing url parameter" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return Response.json({ error: "Invalid url format" }, { status: 400 })
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return Response.json({ error: "Only HTTP/HTTPS URLs supported" }, { status: 400 })
  }

  if (isPrivateHostname(parsed.hostname)) {
    return Response.json({ error: "Access to private/internal hosts forbidden" }, { status: 403 })
  }

  try {
    const { imageUrl, source } = await resolveToImageUrl(rawUrl)
    return Response.json(
      { imageUrl, source },
      {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          // Cache successful resolutions for 24h
          "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600",
        },
      }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[resolve-image] Failed to resolve URL:", rawUrl, message)
    return Response.json({ error: message }, { status: 502 })
  }
}
