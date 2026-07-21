const QUANTIZE_STEP = 24
const SAMPLE_SIZE = 80
const MIN_BRIGHTNESS = 45
const MIN_DISTANCE = 55

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Failed to load image"))
    img.src = src
  })
}

function brightness(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function distance(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function rgb(r: number, g: number, b: number) {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

export async function extractDominantColors(
  imageUrl: string,
  colorCount = 3,
): Promise<string[]> {
  const img = await loadImage(imageUrl)
  const canvas = document.createElement("canvas")
  const size = SAMPLE_SIZE
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D context not available")

  ctx.drawImage(img, 0, 0, size, size)
  const data = ctx.getImageData(0, 0, size, size).data

  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>()

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue

    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]

    if (brightness(r, g, b) < MIN_BRIGHTNESS) continue

    r = Math.round(r / QUANTIZE_STEP) * QUANTIZE_STEP
    g = Math.round(g / QUANTIZE_STEP) * QUANTIZE_STEP
    b = Math.round(b / QUANTIZE_STEP) * QUANTIZE_STEP

    const key = (r << 16) | (g << 8) | b
    const existing = buckets.get(key)
    if (existing) {
      existing.count++
    } else {
      buckets.set(key, { r, g, b, count: 1 })
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count)

  const picked: string[] = []
  for (const c of sorted) {
    if (picked.length >= colorCount) break
    const distinct = picked.every(p => {
      const m = p.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/)
      if (!m) return true
      return distance(c.r, c.g, c.b, parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)) >= MIN_DISTANCE
    })
    if (distinct) picked.push(rgb(c.r, c.g, c.b))
  }

  while (picked.length < colorCount) {
    picked.push(rgb(31, 31, 31))
  }

  return picked
}
