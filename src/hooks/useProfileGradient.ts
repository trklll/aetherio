import { useEffect, useState, useRef } from "react"
import {
  getActiveProfile,
  LOCAL_PROFILES_CHANGED_EVENT,
} from "../utils/localProfiles.ts"
import { extractDominantColors } from "../utils/colorExtractor.ts"

const FALLBACK_GRADIENT = ""

function blendWithBase(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  const base = brightness > 160 ? [60, 60, 60] : [31, 31, 31]
  const f = brightness > 160 ? Math.max(factor, 0.4) : factor
  const rr = Math.round(r * f + base[0] * (1 - f))
  const gg = Math.round(g * f + base[1] * (1 - f))
  const bb2 = Math.round(b * f + base[2] * (1 - f))
  return `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb2.toString(16).padStart(2, "0")}`
}

function buildGradient(colors: string[]): string {
  if (!colors.length) return FALLBACK_GRADIENT
  const stops = colors
    .map((c, i) => {
      const pct = Math.round((i / (colors.length - 1)) * 50)
      return `${blendWithBase(c, 0.15)} ${pct}%`
    })
    .join(", ")
  return `linear-gradient(172deg, ${stops}, #1f1f1f 95%)`
}

export function useProfileGradient(): { gradient: string; loading: boolean } {
  const [gradient, setGradient] = useState(FALLBACK_GRADIENT)
  const [loading, setLoading] = useState(true)
  const cacheRef = useRef<Map<string, string>>(new Map())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    const update = async () => {
      const profile = getActiveProfile()

      if (!profile?.avatarDataUrl) {
        if (mountedRef.current) {
          setGradient(FALLBACK_GRADIENT)
          setLoading(false)
        }
        return
      }

      const cached = cacheRef.current.get(profile.avatarDataUrl)
      if (cached) {
        if (mountedRef.current) {
          setGradient(cached)
          setLoading(false)
        }
        return
      }

      if (mountedRef.current) setLoading(true)

      try {
        const colors = await extractDominantColors(profile.avatarDataUrl, 3)
        const g = buildGradient(colors)
        cacheRef.current.set(profile.avatarDataUrl, g)
        if (mountedRef.current) {
          setGradient(g)
          setLoading(false)
        }
      } catch {
        if (mountedRef.current) {
          setGradient(FALLBACK_GRADIENT)
          setLoading(false)
        }
      }
    }

    update()

    const handleChange = () => {
      cacheRef.current.clear()
      update()
    }

    window.addEventListener(LOCAL_PROFILES_CHANGED_EVENT, handleChange)
    window.addEventListener("storage", handleChange)

    return () => {
      mountedRef.current = false
      window.removeEventListener(LOCAL_PROFILES_CHANGED_EVENT, handleChange)
      window.removeEventListener("storage", handleChange)
    }
  }, [])

  return { gradient, loading }
}
