"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Sparkles } from "lucide-react"
import { PictoriumRoot, usePSelector } from "@/lib/context"
import EditView from "@/components/EditView"
import { ToastProvider } from "@/components/Toast"
import { AmbientBackground } from "@/components/AmbientBackground"
import { useT } from "@/lib/contexts/TranslationContext"
import { setLang, getLang } from "@/lib/i18n"
import { BladeSpinner } from "@/components/ui/BladeSpinner"

interface PosterEditorContainerProps {
  id: number
  mediaType: "movie" | "tv"
}

function PosterEditorContent({ id, mediaType }: PosterEditorContainerProps) {
  const { t } = useT()
  const selected = usePSelector((v) => v.selected)
  const navigateToPoster = usePSelector((v) => v.navigateToPoster)
  const titleOf = usePSelector((v) => v.titleOf)
  const yearOf = usePSelector((v) => v.yearOf)
  const [init, setInit] = useState(false)

  const [, setLangTick] = useState(0)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("preferred_lang")
      if (saved && saved !== getLang()) {
        setLang(saved)
        setLangTick((n) => n + 1)
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (!selected || selected.id !== id || selected.media_type !== mediaType) {
      navigateToPoster({ id, media_type: mediaType, title: "", poster_path: null })
    }
    setInit(true)
  }, [id, mediaType, selected, navigateToPoster])

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <AmbientBackground />
      <ToastProvider>
        <div className="relative z-10 max-w-[1680px] mx-auto px-3 sm:px-4 py-3 sm:py-5">
          {/* Top navigation header (desktop only, EditView handles mobile header) */}
          <div className="hidden lg:flex items-center justify-between mb-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t("ui.back") || "Torna alla Home"}</span>
            </Link>

            {selected ? (
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-bold text-zinc-100 max-w-xs sm:max-w-md truncate">
                  {titleOf(selected)}
                </span>
                <span className="text-[10px] font-mono text-zinc-400 bg-white/[0.04] px-2.5 py-0.5 rounded-lg border border-white/[0.08]">
                  {yearOf(selected)} · {selected.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-mono bg-white/[0.04] px-3 py-1 rounded-lg border border-white/[0.08]">
                <Sparkles className="w-3.5 h-3.5 text-accent-orange" />
                <span>{mediaType.toUpperCase()} #{id}</span>
              </div>
            )}
          </div>

          {/* Main Editor View */}
          {!init || (!selected && (
            <div className="h-96 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <BladeSpinner size="24px" />
              <span className="text-xs font-medium animate-pulse">{t("ui.loadingPoster") || "Caricamento editor poster..."}</span>
            </div>
          ))}

          <EditView />
        </div>
      </ToastProvider>
    </div>
  )
}

export function PosterEditorContainer(props: PosterEditorContainerProps) {
  return (
    <PictoriumRoot>
      <PosterEditorContent {...props} />
    </PictoriumRoot>
  )
}
