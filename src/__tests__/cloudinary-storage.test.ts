import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  getCloudinaryConfig,
  isCloudinaryConfigured,
  buildCloudinaryPublicId,
  generateCloudinarySignature,
  uploadToCloudinary,
} from "../lib/cloudinary-storage"

describe("Cloudinary Storage Adapter", () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.CLOUDINARY_CLOUD_NAME
    delete process.env.CLOUDINARY_API_KEY
    delete process.env.CLOUDINARY_API_SECRET
    delete process.env.CLOUDINARY_URL
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it("returns null when Cloudinary env vars are missing", () => {
    expect(isCloudinaryConfigured()).toBe(false)
    expect(getCloudinaryConfig()).toBeNull()
  })

  it("parses individual Cloudinary env vars correctly", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo_cloud"
    process.env.CLOUDINARY_API_KEY = "123456789"
    process.env.CLOUDINARY_API_SECRET = "abcdef_secret"

    expect(isCloudinaryConfigured()).toBe(true)
    expect(getCloudinaryConfig()).toEqual({
      cloudName: "demo_cloud",
      apiKey: "123456789",
      apiSecret: "abcdef_secret",
    })
  })

  it("parses CLOUDINARY_URL format correctly", () => {
    process.env.CLOUDINARY_URL = "cloudinary://key999:secret888@mycloud"

    expect(isCloudinaryConfigured()).toBe(true)
    expect(getCloudinaryConfig()).toEqual({
      cloudName: "mycloud",
      apiKey: "key999",
      apiSecret: "secret888",
    })
  })

  it("constructs clean, structured public IDs", () => {
    expect(buildCloudinaryPublicId("movie", 550)).toBe("spatialposters/movie/550")
    expect(buildCloudinaryPublicId("tv", 13916)).toBe("spatialposters/tv/13916")
    expect(buildCloudinaryPublicId("tv", 13916, "clean-1")).toBe("spatialposters/tv/13916/clean-1")
    expect(buildCloudinaryPublicId("tv", 13916, "/clean-2/")).toBe("spatialposters/tv/13916/clean-2")
  })

  it("generates correct SHA1 signature for Cloudinary API", () => {
    const params = {
      invalidate: true,
      overwrite: true,
      public_id: "spatialposters/tv/13916",
      timestamp: 1700000000,
    }
    const secret = "mysecret"
    const sig = generateCloudinarySignature(params, secret)

    expect(typeof sig).toBe("string")
    expect(sig.length).toBe(40) // SHA1 hex string length
  })

  it("uploads image buffer to Cloudinary API with signature & overwrite parameters", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "testcloud"
    process.env.CLOUDINARY_API_KEY = "key123"
    process.env.CLOUDINARY_API_SECRET = "secret123"

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        secure_url: "https://res.cloudinary.com/testcloud/image/upload/v12345/spatialposters/tv/13916.jpg",
        public_id: "spatialposters/tv/13916",
        bytes: 1024,
      }),
    })

    vi.stubGlobal("fetch", mockFetch)

    const dummyBuffer = Buffer.from("dummy image data")
    const publicId = buildCloudinaryPublicId("tv", 13916)
    const result = await uploadToCloudinary(dummyBuffer, publicId)

    expect(result).not.toBeNull()
    expect(result?.secure_url).toBe("https://res.cloudinary.com/testcloud/image/upload/f_auto,q_auto/v12345/spatialposters/tv/13916.jpg")
    expect(result?.public_id).toBe("spatialposters/tv/13916")
    expect(mockFetch).toHaveBeenCalledOnce()

    const [callUrl, callInit] = mockFetch.mock.calls[0]
    expect(callUrl).toContain("api.cloudinary.com/v1_1/testcloud/image/upload")
    expect(callInit.method).toBe("POST")
    expect(callInit.body).toContain("spatialposters%2Ftv%2F13916")
    expect(callInit.body).toContain("overwrite=true")
    expect(callInit.body).toContain("invalidate=true")
  })
})
