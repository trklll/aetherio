"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { Download, ArrowLeft } from "lucide-react"
import { PictoriumRoot, usePSelector } from "@/lib/context"
import { InstallHubPanel } from "@/components/InstallModal"
import { ToastProvider } from "@/components/Toast"
import { AmbientBackground } from "@/components/AmbientBackground"
import { useT } from "@/lib/contexts/TranslationContext"
import { setLang, getLang } from "@/lib/i18n"
import { DesktopSidebar } from "@/components/DesktopSidebar"
import { MobileDock } from "@/components/MobileDock"

function InstallContent() {
  const { t } = useT()
  const urlPattern = usePSelector((v) => v.urlPattern)

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

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <AmbientBackground />
      <DesktopSidebar />
      <ToastProvider>
        <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 md:pt-14 lg:pt-16 pb-24 md:pb-8 md:pl-20">
          {/* Header section with back navigation */}
          <div className="flex items-center justify-between mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t("ui.back") || "Torna alla Home"}</span>
            </Link>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 bg-white/[0.04] px-3 py-1 rounded-lg border border-white/[0.08]">
                Install Hub
              </span>
            </div>
          </div>

          {/* Hero title banner */}
          <div className="metallic-card p-5 sm:p-6 mb-6 group relative overflow-hidden">
            <div className="metallic-card-glow" />
            <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-accent-orange/15 border border-accent-orange/30 flex items-center justify-center shrink-0 shadow-lg shadow-accent-orange/10">
                  <Download className="w-6 h-6 text-accent-orange" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
                    <span>{t("ui.installHubTitle") || "Install SpatialPosters Hub"}</span>
                  </h1>
                  <p className="text-xs text-zinc-400 mt-1 max-w-xl leading-relaxed">
                    {t("ui.installHubSub") || "Configura l'addon Stremio, scansiona il QR Code o copia i template per i poster personalizzati."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Install Hub Panel embedded directly */}
          <div className="metallic-card p-4 sm:p-6 shadow-2xl relative z-10">
            <InstallHubPanel
              posterUrlPattern={urlPattern}
              embedded
            />
          </div>
        </div>
      </ToastProvider>
      <MobileDock />
    </div>
  )
}

export default function InstallPage() {
  return (
    <PictoriumRoot>
      <InstallContent />
    </PictoriumRoot>
  )
}
