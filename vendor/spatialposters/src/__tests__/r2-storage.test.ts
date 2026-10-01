import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { isR2Configured, getR2Config, getR2Poster, putR2Poster, deleteR2Poster } from "@/lib/r2-storage"

describe("R2 Storage Adapter", () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.R2_ACCOUNT_ID
    delete process.env.R2_ACCESS_KEY_ID
    delete process.env.R2_SECRET_ACCESS_KEY
    delete process.env.R2_BUCKET_NAME
    delete process.env.R2_PUBLIC_DOMAIN
    delete process.env.SPATIALPOSTERS_R2_ACCOUNT_ID
    delete process.env.SPATIALPOSTERS_R2_ACCESS_KEY_ID
    delete process.env.SPATIALPOSTERS_R2_SECRET_ACCESS_KEY
  })

  afterEach(() => {
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  it("detects when R2 is not configured", () => {
    expect(isR2Configured()).toBe(false)
    expect(getR2Config()).toBeNull()
  })

  it("detects when R2 environment variables are configured", () => {
    process.env.R2_ACCOUNT_ID = "acc123"
    process.env.R2_ACCESS_KEY_ID = "key123"
    process.env.R2_SECRET_ACCESS_KEY = "secret123"
    process.env.R2_BUCKET_NAME = "mybucket"

    expect(isR2Configured()).toBe(true)
    const config = getR2Config()
    expect(config).toEqual({
      accountId: "acc123",
      accessKeyId: "key123",
      secretAccessKey: "secret123",
      bucket: "mybucket",
      endpoint: "https://acc123.r2.cloudflarestorage.com",
      publicDomain: undefined,
    })
  })

  it("supports public domain unauthenticated fetch when configured", async () => {
    process.env.R2_ACCOUNT_ID = "acc123"
    process.env.R2_ACCESS_KEY_ID = "key123"
    process.env.R2_SECRET_ACCESS_KEY = "secret123"
    process.env.R2_PUBLIC_DOMAIN = "pub-test.r2.dev"

    const mockBuffer = Buffer.from("fake-image-bytes")
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockBuffer, {
        status: 200,
        headers: { "content-type": "image/webp", etag: '"etag-123"' },
      })
    )

    const result = await getR2Poster("posters/test.webp")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pub-test.r2.dev/posters/test.webp",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result).not.toBeNull()
    expect(result?.contentType).toBe("image/webp")
    expect(result?.etag).toBe('"etag-123"')
    expect(result?.buffer).toEqual(mockBuffer)
  })

  it("executes SigV4 signed PUT request when saving a poster", async () => {
    process.env.R2_ACCOUNT_ID = "acc123"
    process.env.R2_ACCESS_KEY_ID = "key123"
    process.env.R2_SECRET_ACCESS_KEY = "secret123"
    process.env.R2_BUCKET_NAME = "mybucket"

    const mockBuffer = Buffer.from("image-content")
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 200 })
    )

    const success = await putR2Poster("posters/saved.jpeg", mockBuffer, "image/jpeg", { etag: '"etag-999"' })
    expect(success).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://acc123.r2.cloudflarestorage.com/mybucket/posters/saved.jpeg",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: expect.stringContaining("AWS4-HMAC-SHA256"),
          "content-type": "image/jpeg",
        }),
      })
    )
  })

  it("executes SigV4 signed DELETE request when invalidating a poster", async () => {
    process.env.R2_ACCOUNT_ID = "acc123"
    process.env.R2_ACCESS_KEY_ID = "key123"
    process.env.R2_SECRET_ACCESS_KEY = "secret123"
    process.env.R2_BUCKET_NAME = "mybucket"

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 204 })
    )

    const success = await deleteR2Poster("posters/tobedeleted.jpeg")
    expect(success).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://acc123.r2.cloudflarestorage.com/mybucket/posters/tobedeleted.jpeg",
      expect.objectContaining({ method: "DELETE" })
    )
  })
})
