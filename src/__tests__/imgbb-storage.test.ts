import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { isImgBBConfigured, uploadToImgBB, getImgBBCachedUrl, setImgBBCachedUrl, getImgBBCachedUrlAsync, setImgBBCachedUrlAsync } from "@/lib/imgbb-storage"

describe("ImgBB Storage Adapter", () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.IMGBB_API_KEY
    delete process.env.SPATIALPOSTERS_IMGBB_API_KEY
  })

  afterEach(() => {
    process.env = { ...origEnv }
    vi.restoreAllMocks()
  })

  it("detects when ImgBB is not configured", () => {
    expect(isImgBBConfigured()).toBe(false)
  })

  it("detects when ImgBB API key is configured", () => {
    process.env.IMGBB_API_KEY = "test_imgbb_key_123"
    expect(isImgBBConfigured()).toBe(true)
  })

  it("stores and retrieves key-to-URL mappings synchronously and asynchronously", async () => {
    const key = "test_cache_key_999"
    const url = "https://i.ibb.co/abc1234/poster.webp"
    expect(getImgBBCachedUrl(key)).toBeNull()
    expect(await getImgBBCachedUrlAsync(key)).toBeNull()

    await setImgBBCachedUrlAsync(key, url)
    expect(getImgBBCachedUrl(key)).toBe(url)
    expect(await getImgBBCachedUrlAsync(key)).toBe(url)
  })

  it("uploads image buffer to ImgBB API successfully", async () => {
    process.env.IMGBB_API_KEY = "test_imgbb_key_123"
    const fakeBuffer = Buffer.from("fake-webp-image-data")

    const mockResponsePayload = {
      success: true,
      data: {
        url: "https://i.ibb.co/abc1234/poster.webp",
        display_url: "https://i.ibb.co/abc1234/poster.webp",
        delete_url: "https://ibb.co/abc1234/delete",
      },
    }

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponsePayload), { status: 200 })
    )

    const result = await uploadToImgBB(fakeBuffer, "test-poster")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.imgbb.com/1/upload?key=test_imgbb_key_123",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    )
    expect(result).not.toBeNull()
    expect(result?.url).toBe("https://i.ibb.co/abc1234/poster.webp")
  })
})
