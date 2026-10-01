// Test della coda bounded del limiter render (F5, opzionale): con
// POSTERIUM_RENDER_QUEUE=N, i waiter oltre N ricevono 503 immediato.
// Env impostata PRIMA del dynamic import (letture a module level).
process.env.POSTERIUM_RENDER_QUEUE = "1"
process.env.POSTERIUM_RENDER_SLOT_WAIT_MS = "500"

import { afterEach, describe, expect, it } from "vitest"

// El limite se lee del modulo y no se escribe a mano: el default subio de 4 a 8
// y los numeri fissati aqui habrían Describe(algo que ya no era el limite real),
// con lo que el test pasaba o fallaba por casualidad y no por lo que verifica.
const { MAX_CONCURRENT_RENDERS, acquirePosterRenderSlot, __resetPosterRenderLimiter } = await import(
  "@/lib/poster-runtime-cache"
)

describe("bounded render queue", () => {
  afterEach(() => {
    __resetPosterRenderLimiter()
  })

  it("rejects waiters beyond the queue limit immediately", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < MAX_CONCURRENT_RENDERS; i++) {
      const release = await acquirePosterRenderSlot()
      expect(release).toBeTruthy()
      releases.push(release!)
    }

    // El acquire que excede los slots: si accoda (coda limite 1).
    let queued = false
    const queuedAcquire = acquirePosterRenderSlot().then((r) => { queued = true; return r })
    await new Promise((r) => setTimeout(r, 50))
    expect(queued).toBe(false)

    // El siguiente: coda piena → 503 immediato (null), senza attendere.
    const started = Date.now()
    const rejected = await acquirePosterRenderSlot()
    expect(rejected).toBeNull()
    expect(Date.now() - started).toBeLessThan(200)

    // Rilasciando un posto, il waiter in coda entra.
    releases[0]()
    const queuedRelease = await queuedAcquire
    expect(queuedRelease).toBeTruthy()
    queuedRelease!()
    releases.slice(1).forEach((r) => r())
  })
})
