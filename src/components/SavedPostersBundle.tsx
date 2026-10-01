"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { posterUrl } from "@/lib/utils"
import { BookmarkCheck, ArrowRight, Layers, Sparkles } from "lucide-react"
import type { Mapping } from "@/lib/types"

interface SavedPostersBundleProps {
  onOpenLightbox?: (mapping: Mapping) => void
}

export function SavedPostersBundle({ onOpenLightbox }: SavedPostersBundleProps) {
  const mappings = usePSelector((v) => v.mappings)
  const router = usePSelector((v) => v.router)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [containerHovered, setContainerHovered] = useState(false)
  const { t } = useT()

  // Select 5-6 random posters on initial client load
  const bundleItems = useMemo(() => {
    if (!mappings || mappings.length === 0) return []
    const shuffled = [...mappings].sort(() => 0.5 - Math.random())
    return shuffled.slice(0, Math.min(6, mappings.length))
  }, [mappings])

  if (!mappings || mappings.length === 0 || bundleItems.length === 0) {
    return null
  }

  const handleCardClick = (m: Mapping) => {
    if (onOpenLightbox) {
      onOpenLightbox(m)
    } else {
      router.push("myposters")
    }
  }

  return (
    <section className="my-10 md:my-16 max-w-5xl mx-auto px-4">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 backdrop-blur-md">
              <BookmarkCheck className="w-3 h-3 text-amber-400" />
              <span>Your Library</span>
            </span>
            <span className="text-xs text-zinc-400 font-medium tabular-nums">
              ({mappings.length} saved)
            </span>
          </div>
          <h2 className="text-2xl md:text-3xl font-extrabold text-zinc-100 tracking-tight flex items-center gap-2">
            Your SpatialPosters
          </h2>
        </div>

        <Link
          href="/myposters"
          className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-zinc-200 hover:text-white transition-all duration-200 active:scale-95 cursor-pointer backdrop-blur-md shadow-lg group"
        >
          <span>View Collection</span>
          <ArrowRight className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
        </Link>
      </div>

      {/* 3D Stacked Bundle Container */}
      <div
        className="relative py-12 md:py-16 px-4 rounded-3xl bg-zinc-900/40 border border-white/10 backdrop-blur-xl overflow-hidden flex flex-col items-center justify-center transition-all duration-500 hover:border-white/20 shadow-2xl group/bundle"
        onMouseEnter={() => setContainerHovered(true)}
        onMouseLeave={() => {
          setContainerHovered(false)
          setHoveredIdx(null)
        }}
      >
        {/* Background Ambient Glow */}
        <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/5 via-orange-500/5 to-purple-500/5 blur-2xl opacity-60 pointer-events-none" />

        <div className="relative w-full max-w-2xl h-[320px] md:h-[380px] flex items-center justify-center isolate">
          {bundleItems.map((m, index) => {
            const count = bundleItems.length
            const centerIdx = (count - 1) / 2
            const offset = index - centerIdx
            const isHovered = hoveredIdx === index

            // Calculate 3D transforms for stacked fan-out
            let rotate = offset * 7
            let translateX = offset * (containerHovered ? 65 : 42)
            let translateY = Math.abs(offset) * 8
            let scale = 1 - Math.abs(offset) * 0.05
            let zIndex = count - Math.abs(Math.round(offset))

            if (isHovered) {
              scale = 1.12
              translateY = -20
              rotate = 0
              zIndex = 50
            }

            const posterSrc = m.imgbbUrl || `/api/poster/${m.mediaType}/${m.tmdbId}` || (m.posterPath ? posterUrl(m.posterPath, "w342") : null)

            return (
              <div
                key={`${m.mediaType}:${m.tmdbId}`}
                onClick={() => handleCardClick(m)}
                onMouseEnter={() => setHoveredIdx(index)}
                style={{
                  transform: `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotate}deg) scale(${scale})`,
                  zIndex,
                }}
                className="absolute w-[170px] sm:w-[200px] md:w-[220px] aspect-[2/3] rounded-2xl overflow-hidden border border-white/15 shadow-[0_16px_36px_rgba(0,0,0,0.6)] cursor-pointer transition-all duration-500 ease-out hover:shadow-[0_25px_50px_rgba(232,93,42,0.25)] group/card bg-zinc-900"
              >
                {/* Poster Image */}
                {posterSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={posterSrc}
                    alt={m.title}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement
                      const fallback = m.posterPath ? posterUrl(m.posterPath, "w342") : null
                      if (fallback && img.src !== fallback) {
                        img.src = fallback
                      }
                    }}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 text-zinc-500">
                    <Layers className="w-8 h-8 mb-2" />
                    <span className="text-xs font-semibold">{m.title}</span>
                  </div>
                )}

                {/* Logo Overlay */}
                {m.logoPath && (
                  <div
                    className="absolute inset-x-0 bottom-[10%] flex items-center justify-center pointer-events-none p-2"
                    style={{
                      transform: `translate(${m.logoOffsetX ?? 0}%, ${-(m.logoOffsetY ?? 0)}%)`,
                    }}
                  >
                    <div style={{ width: `${m.logoScale ?? 75}%` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={posterUrl(m.logoPath, "w300")}
                        alt=""
                        className="w-full drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)] object-contain"
                      />
                    </div>
                  </div>
                )}

                {/* Hover Details Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-300 p-3.5 flex flex-col justify-end">
                  <p className="text-xs font-bold text-white truncate drop-shadow-md">{m.title}</p>
                  <p className="text-[10px] text-zinc-300 font-medium capitalize mt-0.5">
                    {m.mediaType === "movie" ? "Movie" : "TV Series"} • {(m.releaseDate || m.firstAirDate || "").slice(0, 4)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom Hint */}
        <p className="text-xs text-zinc-400 font-medium mt-4 flex items-center gap-1.5 opacity-80 group-hover/bundle:opacity-100 transition-opacity">
          <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
          <span>Click any poster to manage your collection</span>
        </p>
      </div>
    </section>
  )
}
