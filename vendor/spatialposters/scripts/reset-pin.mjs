import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Leggi .env e .env.local se esistono
for (const envFile of [".env.local", ".env"]) {
  const envPath = path.join(rootDir, envFile)
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8")
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eqIdx = trimmed.indexOf("=")
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim()
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "")
          if (!process.env[key]) {
            process.env[key] = val
          }
        }
      }
    } catch {}
  }
}

async function resetPin() {
  console.log("🔐 Starting PIN Security Reset...")
  let resetLocal = false
  let resetKv = false

  // 1. Reset file locale security.json
  const dataDir = process.env.DATA_DIR || process.env.PICTORIUM_DATA_DIR || path.join(rootDir, "data")
  const secFile = path.join(dataDir, "security.json")

  if (existsSync(secFile)) {
    try {
      await fs.unlink(secFile)
      console.log(`✅ Local file deleted: ${secFile}`)
      resetLocal = true
    } catch (err) {
      console.error(`❌ Failed to delete local security.json:`, err)
    }
  } else {
    console.log(`ℹ️  No local ${secFile} found.`)
  }

  // 2. Reset Vercel KV se configurato
  const kvUrl = process.env.KV_REST_API_URL
  const kvToken = process.env.KV_REST_API_TOKEN

  if (kvUrl && kvToken) {
    try {
      const { createClient } = await import("@vercel/kv")
      const kv = createClient({ url: kvUrl, token: kvToken })
      await kv.del("security")
      console.log("✅ Vercel KV key 'security' deleted successfully.")
      resetKv = true
    } catch (err) {
      console.error("❌ Failed to clear Vercel KV security key:", err)
    }
  }

  if (resetLocal || resetKv) {
    console.log("\n🎉 SUCCESS: All PIN security settings have been reset! You can now access your site without any password.")
  } else {
    console.log("\n✨ Notice: No PIN configuration was found in local file or Vercel KV.")
  }
}

resetPin().catch((err) => {
  console.error("Fatal error during PIN reset:", err)
  process.exit(1)
})
