"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Sparkles } from "lucide-react"
import { PictoriumRoot, usePSelector } from "@/lib/context"
import { MyPostersView } from "@/components/MyPostersView"
import EditView from "@/components/EditView"
import { ToastProvider } from "@/components/Toast"
import { AmbientBackground } from "@/components/AmbientBackground"
import { useT } from "@/lib/contexts/TranslationContext"
import { setLang, getLang } from "@/lib/i18n"
import { BladeSpinner } from "@/components/ui/BladeSpinner"
import { DesktopSidebar } from "@/components/DesktopSidebar"
import { MobileDock } from "@/components/MobileDock"

function MyPostersContent() {
  const { t } = useT()
  const view = usePSelector((v) => v.view)
  const setView = usePSelector((v) => v.setView)
  const selected = usePSelector((v) => v.selected)
  const titleOf = usePSelector((v) => v.titleOf)
  const yearOf = usePSelector((v) => v.yearOf)
  const router = usePSelector((v) => v.router)

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

  // Garantisce che all'apertura diretta di /myposters la view sia "myposters" se non c'è una selezione attiva
  useEffect(() => {
    if (!selected && view === "edit") {
      setView("myposters")
    }
  }, [selected, view, setView])

  if (view === "edit" && selected) {
    return (
      <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
        <AmbientBackground />
        <DesktopSidebar />
        <ToastProvider>
          <div className="relative z-10 max-w-[1680px] mx-auto px-4 sm:px-6 pt-6 sm:pt-10 md:pt-14 lg:pt-16 pb-24 md:pb-8 md:pl-20">
            {/* Top navigation header */}
            <div className="hidden lg:flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{t("ui.back") || "Torna indietro"}</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-bold text-zinc-100 max-w-xs sm:max-w-md truncate">
                  {titleOf(selected)}
                </span>
                <span className="text-[10px] font-mono text-zinc-400 bg-white/[0.04] px-2.5 py-0.5 rounded-lg border border-white/[0.08]">
                  {yearOf(selected)} · {selected.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")}
                </span>
              </div>
            </div>

            {/* Main Editor View */}
            <EditView />
          </div>
        </ToastProvider>
        <MobileDock />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <AmbientBackground />
      <DesktopSidebar />
      <ToastProvider>
        <div className="relative z-10 max-w-[1680px] mx-auto px-4 sm:px-6 pt-6 sm:pt-10 md:pt-14 lg:pt-16 pb-24 md:pb-8 md:pl-20">
          {/* Top navigation bar */}
          <div className="flex items-center justify-between mb-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t("ui.back") || "Torna alla Home"}</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 bg-white/[0.04] px-3 py-1 rounded-lg border border-white/[0.08]">
                {t("ui.myPosters") || "SpatialPosters"}
              </span>
            </div>
          </div>

          {/* Main My Posters View */}
          <MyPostersView />
        </div>
      </ToastProvider>
      <MobileDock />
    </div>
  )
}

export default function MyPostersPage() {
  return (
    <PictoriumRoot>
      <MyPostersContent />
    </PictoriumRoot>
  )
}

