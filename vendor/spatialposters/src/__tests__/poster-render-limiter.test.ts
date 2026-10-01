import { afterEach, describe, expect, it } from "vitest"
import {
  MAX_CONCURRENT_RENDERS,
  acquirePosterRenderSlot,
  __resetPosterRenderLimiter,
} from "@/lib/poster-runtime-cache"

// Los tests leen el limite real en vez de escribir un 4 a mano. Cuando el
// default subio de 4 a 8 para que Aetherio drenara la cola de Home en la
// pantalla de carga, los numeros copiados aqui dejaron de describir el
// comportamiento y el test empezaba a pasar por casualidad.
describe("poster render concurrency limiter", () => {
  afterEach(() => {
    __resetPosterRenderLimiter()
  })

  it("acquires up to the max concurrent slots immediately", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < MAX_CONCURRENT_RENDERS; i++) {
      const release = await acquirePosterRenderSlot()
      expect(release).toBeTruthy()
      releases.push(release!)
    }
    releases.forEach((r) => r())
  })

  it("queues requests beyond the limit and resolves them when a slot frees", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < MAX_CONCURRENT_RENDERS; i++) {
      releases.push((await acquirePosterRenderSlot())!)
    }
    const beyond = MAX_CONCURRENT_RENDERS
    let beyondResolved = false
    const beyondPromise = acquirePosterRenderSlot().then((r) => { beyondResolved = true; return r })
    await new Promise((r) => setTimeout(r, 50))
    expect(beyondResolved).toBe(false)

    releases[0]()
    const beyondRelease = await beyondPromise
    expect(beyondResolved).toBe(true)
    expect(beyondRelease).toBeTruthy()
    beyondRelease!()

    releases.slice(1).forEach((r) => r())
  })

  it("handles multiple queued waiters in FIFO order", async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < MAX_CONCURRENT_RENDERS; i++) {
      releases.push((await acquirePosterRenderSlot())!)
    }
    const order: number[] = []
    const waiters = [1, 2, 3].map((n) => acquirePosterRenderSlot().then((r) => { order.push(n); return r }))
    releases[0]()
    releases[1]()
    releases[2]()
    const resolved = await Promise.all(waiters)
    expect(order).toEqual([1, 2, 3])
    resolved.forEach((r) => r?.())
    releases.slice(3).forEach((r) => r())
  })

  it("tiene el limite por defecto suficiente para drenar la cola de Home", () => {
    // El pool de sockets del navegador es 6 por host, asi que por debajo de 6
    // el proxy y sharp quedan ociosos; muy por encima no ayuda porque sharp es
    // CPU-bound y sube el pico de memoria. 8 es el punto de equilibrio que se
    // eligio para que ~260 posters se carguen todos en la pantalla de arranque.
    expect(MAX_CONCURRENT_RENDERS).toBeGreaterThanOrEqual(6)
    expect(MAX_CONCURRENT_RENDERS).toBeLessThanOrEqual(32)
  })
})
