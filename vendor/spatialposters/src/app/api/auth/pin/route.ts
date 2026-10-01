import { NextRequest } from "next/server"
import {
  hasPinConfigured,
  verifyPin,
  setPin,
  removePin,
  createSessionToken,
  buildSessionCookie,
  buildClearSessionCookie,
  verifySessionFromRequest,
  getAdminPinFromEnv,
} from "@/lib/pin-auth"
import { isSameOrigin, originMismatchResponse, checkAdminToken } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET(req: NextRequest) {
  const hasPin = await hasPinConfigured()
  const authenticated = hasPin ? await verifySessionFromRequest(req) : true
  return Response.json(
    { hasPin, authenticated },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  )
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "auth-pin")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { pin?: string }
  try {
    body = (await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)) as { pin?: string }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const pin = typeof body?.pin === "string" ? body.pin.trim() : ""
  if (!pin) {
    return Response.json({ error: "Admin Password / PIN is required" }, { status: 400 })
  }

  const hasPin = await hasPinConfigured()
  if (!hasPin) {
    return Response.json({ error: "No Admin Password or PIN is configured" }, { status: 400 })
  }

  const isValid = await verifyPin(pin)
  if (!isValid) {
    return Response.json({ error: "Incorrect Admin Password / PIN" }, { status: 401 })
  }

  const token = await createSessionToken()
  if (!token) {
    return Response.json({ error: "Failed to generate session token" }, { status: 500 })
  }

  const cookie = buildSessionCookie(token)
  return new Response(JSON.stringify({ success: true, token }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    },
  })
}

export async function PUT(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "auth-pin")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  if (getAdminPinFromEnv()) {
    return Response.json({ error: "PIN protection is managed securely via environment variable SPATIALPOSTERS_ADMIN_PIN" }, { status: 403 })
  }

  let body: { currentPin?: string; newPin?: string }
  try {
    body = (await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)) as { currentPin?: string; newPin?: string }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const newPin = typeof body?.newPin === "string" ? body.newPin.trim() : ""
  if (!newPin || newPin.length < 4) {
    return Response.json({ error: "Il nuovo PIN deve avere almeno 4 cifre" }, { status: 400 })
  }

  const hasPin = await hasPinConfigured()
  if (hasPin) {
    const currentPin = typeof body?.currentPin === "string" ? body.currentPin.trim() : ""
    const isCurrentValid = currentPin ? await verifyPin(currentPin) : false
    const isAdmin = checkAdminToken(req)
    if (!isCurrentValid && !isAdmin) {
      return Response.json({ error: "PIN attuale non corretto" }, { status: 401 })
    }
  }

  const success = await setPin(newPin)
  if (!success) {
    return Response.json({ error: "Impossibile salvare il PIN" }, { status: 500 })
  }

  const token = await createSessionToken()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) {
    headers["Set-Cookie"] = buildSessionCookie(token)
  }

  return new Response(JSON.stringify({ success: true, token }), {
    status: 200,
    headers,
  })
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "auth-pin")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { currentPin?: string }
  try {
    body = (await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)) as { currentPin?: string }
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const searchToken = req.nextUrl.searchParams.get("token") || req.nextUrl.searchParams.get("adminToken")
  const envAdminToken = process.env.PICTORIUM_ADMIN_TOKEN || process.env.ADMIN_TOKEN
  const isQueryTokenValid = !!envAdminToken && searchToken === envAdminToken
  const currentPin = typeof body?.currentPin === "string" ? body.currentPin.trim() : ""
  const isCurrentValid = currentPin ? await verifyPin(currentPin) : false
  const isAdmin = checkAdminToken(req) || isQueryTokenValid

  if (!isCurrentValid && !isAdmin) {
    return Response.json({ error: "PIN attuale non corretto" }, { status: 401 })
  }

  if (currentPin) {
    await removePin(currentPin)
  } else {
    // Admin token rimuove direttamente
    const { writeSecurityConfig, readSecurityConfig } = await import("@/lib/pin-auth")
    const cfg = await readSecurityConfig()
    await writeSecurityConfig({ ...cfg, pinHash: undefined, sessionSecret: undefined })
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": buildClearSessionCookie(),
    },
  })
}
