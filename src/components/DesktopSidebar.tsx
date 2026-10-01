"use client"

import React, { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Home, RefreshCw, Settings, Check, Heart } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { setLang, getLang } from "@/lib/i18n"
import { LANG_NAMES, UI_LANGUAGES } from "@/lib/utils"
import { usePSelector } from "@/lib/context"
import { BladeSpinner } from "@/components/ui/BladeSpinner"
import { ProxyModal } from "@/components/ProxyModal"

export function DesktopSidebar() {
  const { t } = useT()
  const pathname = usePathname()
  const router = useRouter()

  const mappings = usePSelector((v) => v.mappings)
  const refreshLists = usePSelector((v) => v.refreshLists)
  const view = usePSelector((v) => v.view)
  const setView = usePSelector((v) => v.setView)
  const selected = usePSelector((v) => v.selected)
  const goHome = usePSelector((v) => v.goHome)

  const [refreshing, setRefreshing] = useState(false)
  const [proxyOpen, setProxyOpen] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [closingLang, setClosingLang] = useState(false)
  const [currentLang, setCurrentLangState] = useState("en")
  const langRef = useRef<HTMLDivElement>(null)
  const closingLangRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    try {
      setCurrentLangState(getLang())
    } catch {}
  }, [])

  const closeLang = () => {
    setClosingLang(true)
    closingLangRef.current = setTimeout(() => {
      setLangOpen(false)
      setClosingLang(false)
    }, 150)
  }

  useEffect(() => {
    return () => {
      if (closingLangRef.current) clearTimeout(closingLangRef.current)
    }
  }, [])

  // Chiude il menu lingua se si clicca fuori
  useEffect(() => {
    if (!langOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        closeLang()
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [langOpen])

  const pickLanguage = (code: string) => {
    setLang(code)
    setCurrentLangState(code)
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("preferred_lang", code)
      } catch {}
    }
  }

  const isHomeActive = pathname === "/" && (view === "edit" || !view) && !selected
  const isMyPostersActive = pathname === "/myposters" || view === "myposters"
  const isCatalogsActive = pathname === "/cataloghi" || view === "cataloghi"
  const isInstallActive = pathname === "/install"
  const isStatusActive = pathname === "/status"
  const isSettingsActive = pathname === "/settings"

  return (
    <>
      {/* Desktop Unified Left Sidebar Dock - Visible across ALL desktop pages */}
      <aside className="hidden md:flex fixed left-5 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-2 p-2 sidebar-dock-shell">
        {/* Top Group: Main Navigation */}
        <div className="flex flex-col items-center gap-1.5">
          {/* Home */}
          <button
            type="button"
            onClick={() => {
              if (pathname === "/") {
                goHome()
                setView("edit")
              } else {
                router.push("/")
              }
            }}
            title={t("ui.home") || "Home"}
            className={`group sidebar-dock-btn ${isHomeActive ? "sidebar-dock-btn-active" : ""}`}
          >
            <Home className="w-4.5 h-4.5 transition-all duration-200 text-zinc-300 group-hover:text-white" />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              Home
            </span>
          </button>

          {/* SpatialPosters / My Posters */}
          <Link
            href="/myposters"
            title={t("ui.myPosters") || "SpatialPosters"}
            className={`group sidebar-dock-btn ${isMyPostersActive ? "sidebar-dock-btn-active" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
            <img
              src="/icon/myposter.webp"
              alt="My Posters"
              className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100"
            />
            {mappings.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold shadow-md bg-white text-zinc-950">
                {mappings.length > 99 ? "99+" : mappings.length}
              </span>
            )}
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              SpatialPosters ({mappings.length})
            </span>
          </Link>

          {/* Catalogs */}
          <button
            type="button"
            onClick={() => {
              if (pathname === "/") {
                setView("cataloghi")
              } else {
                router.push("/#cataloghi")
              }
            }}
            title={t("ui.catalogs") || "Catalogs"}
            className={`group sidebar-dock-btn ${isCatalogsActive ? "sidebar-dock-btn-active" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
            <img
              src="/icon/collection.webp"
              alt="Catalogs"
              className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100"
            />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              {t("ui.catalogs") || "Catalogs"}
            </span>
          </button>

          {/* Install Hub */}
          <Link
            href="/install"
            title="Install Hub"
            className={`group sidebar-dock-btn ${isInstallActive ? "sidebar-dock-btn-active" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
            <img
              src="/icon/install-hub.webp"
              alt="Install Hub"
              className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100"
            />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              Install Hub
            </span>
          </Link>
        </div>

        {/* Divider */}
        <div className="w-7 h-px my-0.5 bg-white/10" />

        {/* Bottom Group: Status, Settings & Tools */}
        <div className="flex flex-col items-center gap-1.5">
          {/* Addon Proxy */}
          <button
            type="button"
            onClick={() => setProxyOpen(true)}
            title={t("ui.addonProxy")}
            className="group sidebar-dock-btn"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
            <img
              src="/icon/proxy.webp"
              alt="Addon Proxy"
              className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100"
            />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              {t("ui.addonProxy")}
            </span>
          </button>

          {/* Refresh Lists */}
          <button
            type="button"
            onClick={async () => {
              setRefreshing(true)
              await refreshLists()
              setRefreshing(false)
            }}
            disabled={refreshing}
            title={t("ui.refreshLists")}
            className="group sidebar-dock-btn disabled:opacity-50"
          >
            {refreshing ? (
              <BladeSpinner size="18px" />
            ) : (
              <RefreshCw className="w-4.5 h-4.5 transition-all duration-200 text-zinc-300 group-hover:text-white" />
            )}
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              {t("ui.refreshLists")}
            </span>
          </button>

          {/* Language Picker */}
          <div ref={langRef} className="relative group">
            <button
              type="button"
              onClick={() => setLangOpen((o) => !o)}
              title={LANG_NAMES[currentLang] || "Language"}
              className={`sidebar-dock-btn ${langOpen ? "sidebar-dock-btn-active" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
              <img
                src="/icon/lang.webp"
                alt="Language"
                className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100"
              />
            </button>
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              {LANG_NAMES[currentLang]} ({currentLang.toUpperCase()})
            </span>

            {(langOpen || closingLang) && (
              <div
                className={`absolute left-full top-0 ml-3 backdrop-blur-2xl border rounded-2xl p-1.5 shadow-2xl z-50 min-w-44 bg-zinc-950/95 border-white/15 text-white shadow-black/90 ${
                  closingLang ? "animate-fade-scale-out" : "animate-fade-scale-in"
                }`}
              >
                {UI_LANGUAGES.map((l) => (
                  <button
                    type="button"
                    key={l.code}
                    onClick={() => {
                      pickLanguage(l.code)
                      closeLang()
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all duration-150 text-left hover:bg-white/10 cursor-pointer ${
                      l.code === currentLang
                        ? "bg-white text-zinc-950 font-bold"
                        : "text-zinc-300"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{l.flag}</span>
                      <span>{l.name}</span>
                    </span>
                    {l.code === currentLang && (
                      <Check className="w-3.5 h-3.5 shrink-0 text-zinc-950" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Status Page */}
          <Link
            href="/status"
            title={t("ui.statusTitle")}
            className={`group sidebar-dock-btn ${isStatusActive ? "sidebar-dock-btn-active" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
            <img
              src="/icon/status.webp"
              alt="Status"
              className="w-4.5 h-4.5 object-contain transition-all duration-200 brightness-0 invert opacity-75 group-hover:opacity-100"
            />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              Status
            </span>
          </Link>

          {/* Settings */}
          <Link
            href="/settings"
            title={t("ui.settings")}
            className={`group sidebar-dock-btn ${isSettingsActive ? "sidebar-dock-btn-active" : ""}`}
          >
            <Settings className="w-4.5 h-4.5 transition-all duration-200 text-zinc-300 group-hover:text-white" />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-zinc-900 text-zinc-100 border-white/10 shadow-black/80">
              {t("ui.settings")}
            </span>
          </Link>

          {/* Patreon Support */}
          <a
            href="https://patreon.com/theaceofficials"
            target="_blank"
            rel="noopener noreferrer"
            title="Support on Patreon"
            className="group sidebar-dock-btn border-rose-500/30 hover:border-rose-500/60 bg-rose-500/10 hover:bg-rose-500/20"
          >
            <Heart className="w-4.5 h-4.5 transition-all duration-200 text-rose-400 group-hover:text-rose-300 fill-rose-500/30 group-hover:fill-rose-500/60" />
            <span className="pointer-events-none absolute left-full ml-3.5 px-2.5 py-1 text-xs font-semibold rounded-xl border opacity-0 group-hover:opacity-100 transition-all duration-200 whitespace-nowrap shadow-xl z-50 bg-rose-950 text-rose-100 border-rose-500/30 shadow-black/80">
              Support on Patreon 💖
            </span>
          </a>
        </div>
      </aside>

      <ProxyModal isOpen={proxyOpen} onClose={() => setProxyOpen(false)} />
    </>
  )
}
