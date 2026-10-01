"use client"

import { useState } from "react"
import { PICKER_LANGS } from "@/lib/utils"
import { REGIONS } from "@/lib/regions"
import { useT } from "@/lib/contexts/TranslationContext"
import { AnimatedSpatialWord } from "@/components/AnimatedSpatialWord"
import { ChevronLeft, ArrowRight, Sparkles, Languages, MapPin, Check } from "lucide-react"

interface SetupWizardProps {
  /** Applica la lingua (codice 2 lettere) senza chiudere il wizard. */
  onPickLang: (code: string) => void
  /** Applica la nazionalità delle liste (codice regione, es. "IT"). */
  onPickRegion: (regionCode: string) => void
  /** Chiude il wizard. */
  onDone: () => void
}

/**
 * Configurazione guidata iniziale in 2 passi (SpatialPosters Setup):
 * 1. lingua dell'interfaccia (12 nazionalità),
 * 2. nazionalità delle liste/classifiche (stesse 12).
 */
export function LangPicker({ onPickLang, onPickRegion, onDone }: SetupWizardProps) {
  const { t } = useT()
  const [step, setStep] = useState<"lang" | "region">("lang")
  const [selectedLang, setSelectedLang] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)

  const pickLang = (code: string) => {
    setSelectedLang(code)
    onPickLang(code)
    setTimeout(() => {
      setStep("region")
    }, 180)
  }

  const pickRegion = (regionCode: string) => {
    setSelectedRegion(regionCode)
    onPickRegion(regionCode)
    setTimeout(() => {
      onDone()
    }, 180)
  }

  const getTitle = () => {
    if (step === "region") return t("ui.setupRegionTitle")
    return "Welcome to SpatialPosters"
  }

  const getSubtitle = () => {
    if (step === "region") return t("ui.setupRegionSubtitle")
    return "Select your preferred language"
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-4 animate-fade-in overflow-y-auto select-none">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-accent-orange/15 rounded-full blur-[130px] opacity-70" />
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 w-[350px] h-[350px] bg-purple-600/10 rounded-full blur-[110px] opacity-60" />

      <div className="relative z-10 w-full max-w-xl my-auto">
        {/* Main Glass Card Container */}
        <div className="glass-card p-6 sm:p-8 rounded-3xl border border-white/12 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl relative overflow-hidden">
          
          {/* Top Decorative Highlight Bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-accent-orange to-purple-500" />

          {/* Rebranded Header */}
          <div className="text-center mb-7 relative">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/12 backdrop-blur-md mb-4 shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-accent-orange animate-pulse" />
              <span className="text-[11px] font-semibold tracking-wider text-zinc-300 uppercase">
                Welcome to <AnimatedSpatialWord />
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {getTitle()}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1.5 max-w-md mx-auto">
              {getSubtitle()}
            </p>

            {/* Stepper Bar (2 Steps Only) */}
            <div className="flex items-center justify-center gap-3 mt-6">
              {/* Step 1: Language */}
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold transition-all duration-300 ${
                step === "lang" 
                  ? "bg-accent-orange/20 border border-accent-orange/40 text-accent-orange shadow-[0_0_15px_rgba(249,115,22,0.2)]" 
                  : "bg-emerald-500/15 border border-emerald-500/30 text-emerald-400"
              }`}>
                {step === "region" ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Languages className="w-3.5 h-3.5" />
                )}
                <span>1. Language</span>
              </div>

              <div className="w-4 h-[1px] bg-white/15" />

              {/* Step 2: Region */}
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold transition-all duration-300 ${
                step === "region" 
                  ? "bg-accent-orange/20 border border-accent-orange/40 text-accent-orange shadow-[0_0_15px_rgba(249,115,22,0.2)]" 
                  : "bg-white/5 border border-white/10 text-zinc-500"
              }`}>
                <MapPin className="w-3.5 h-3.5" />
                <span>2. Region</span>
              </div>
            </div>
          </div>

          {/* STEP 1: LANGUAGE SELECTION GRID */}
          {step === "lang" && (
            <div key="lang" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[48vh] overflow-y-auto pr-1 scrollbar-none animate-step-enter">
              {PICKER_LANGS.map((l) => {
                const isSelected = selectedLang === l.code
                return (
                  <button
                    type="button"
                    key={l.key}
                    onClick={() => pickLang(l.code)}
                    className={`group relative flex items-center gap-3.5 px-4 py-3 rounded-2xl border text-left transition-all duration-200 cursor-pointer overflow-hidden ${
                      isSelected
                        ? "bg-accent-orange/20 border-accent-orange/60 shadow-[0_0_20px_rgba(249,115,22,0.25)] scale-[0.98]"
                        : "bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/25 hover:-translate-y-0.5 active:scale-[0.98]"
                    }`}
                  >
                    <span className="text-3xl shrink-0 p-1.5 rounded-xl bg-white/[0.05] border border-white/10 shadow-inner group-hover:scale-110 transition-transform">
                      {l.flag}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-100 group-hover:text-accent-orange transition-colors truncate">
                        {l.name}
                      </p>
                      <p className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest mt-0.5">
                        {l.sub}
                      </p>
                    </div>
                    {isSelected ? (
                      <div className="w-6 h-6 rounded-full bg-accent-orange text-black flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 group-hover:translate-x-1 transition-all shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* STEP 2: REGION SELECTION GRID */}
          {step === "region" && (
            <div key="region" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[48vh] overflow-y-auto pr-1 scrollbar-none animate-step-enter">
              {REGIONS.map((r) => {
                const isSelected = selectedRegion === r.code
                return (
                  <button
                    type="button"
                    key={r.code}
                    onClick={() => pickRegion(r.code)}
                    className={`group relative flex items-center gap-3.5 px-4 py-3 rounded-2xl border text-left transition-all duration-200 cursor-pointer overflow-hidden ${
                      isSelected
                        ? "bg-accent-orange/20 border-accent-orange/60 shadow-[0_0_20px_rgba(249,115,22,0.25)] scale-[0.98]"
                        : "bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/25 hover:-translate-y-0.5 active:scale-[0.98]"
                    }`}
                  >
                    <span className="text-3xl shrink-0 p-1.5 rounded-xl bg-white/[0.05] border border-white/10 shadow-inner group-hover:scale-110 transition-transform">
                      {r.flag}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-zinc-100 group-hover:text-accent-orange transition-colors truncate">
                        {r.label}
                      </p>
                      <p className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest mt-0.5">
                        {r.code}
                      </p>
                    </div>
                    {isSelected ? (
                      <div className="w-6 h-6 rounded-full bg-accent-orange text-black flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : (
                      <ArrowRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-200 group-hover:translate-x-1 transition-all shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* BACK BUTTON */}
          {step === "region" && (
            <div className="mt-6 pt-4 border-t border-white/10 flex justify-center">
              <button
                type="button"
                onClick={() => setStep("lang")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-95 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                {t("ui.back")}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
