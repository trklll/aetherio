"use client"

import React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Home, Settings } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePSelector } from "@/lib/context"

export function MobileDock() {
  const { t } = useT()
  const pathname = usePathname()
  const router = useRouter()

  const mappings = usePSelector((v) => v.mappings)
  const view = usePSelector((v) => v.view)
  const setView = usePSelector((v) => v.setView)
  const goHome = usePSelector((v) => v.goHome)

  const isHomeActive = pathname === "/" && (view === "edit" || !view)
  const isMyPostersActive = pathname === "/myposters" || view === "myposters"
  const isCatalogsActive = pathname === "/cataloghi" || view === "cataloghi"
  const isSettingsActive = pathname === "/settings"
  const isInstallActive = pathname === "/install"

  return (
    <nav
      aria-label={t("ui.mainNav") || "Main navigation"}
      className="md:hidden fixed bottom-3 left-3 right-3 z-40 max-w-md mx-auto flex items-center gap-2.5 transition-all duration-300 pb-[env(safe-area-inset-bottom)]"
    >
      {/* Left Floating Navigation Pill */}
      <div className="mobile-dock-nav flex-1">
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
          className={`mobile-dock-item ${isHomeActive ? "mobile-dock-item-active text-white font-bold" : ""}`}
          title="Home"
        >
          <Home className="w-4.5 h-4.5 text-zinc-100" />
          <span className="text-[9px] font-medium tracking-tight truncate">Home</span>
        </button>

        {/* SpatialPosters / My Posters */}
        <Link
          href="/myposters"
          className={`mobile-dock-item relative ${isMyPostersActive ? "mobile-dock-item-active text-white font-bold" : ""}`}
          title="SpatialPosters"
        >
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
            <img src="/icon/myposter.webp" alt="My Posters" className="w-4.5 h-4.5 object-contain brightness-0 invert" />
            {mappings.length > 0 && (
              <span className="absolute -top-1 -right-2 px-1 min-w-3.5 h-3.5 bg-accent-orange text-[9px] font-bold text-white rounded-full flex items-center justify-center leading-none shadow-sm">
                {mappings.length > 99 ? "99+" : mappings.length}
              </span>
            )}
          </div>
          <span className="text-[9px] font-medium tracking-tight truncate">{t("ui.myPostersBtn") || "I Miei"}</span>
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
          className={`mobile-dock-item ${isCatalogsActive ? "mobile-dock-item-active text-white font-bold" : ""}`}
          title="Cataloghi"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
          <img src="/icon/collection.webp" alt="Catalogs" className="w-4.5 h-4.5 object-contain brightness-0 invert" />
          <span className="text-[9px] font-medium tracking-tight truncate">{t("ui.catalogs") || "Cataloghi"}</span>
        </button>

        {/* Settings */}
        <Link
          href="/settings"
          className={`mobile-dock-item ${isSettingsActive ? "mobile-dock-item-active text-white font-bold" : ""}`}
          title="Settings"
        >
          <Settings className="w-4.5 h-4.5 text-zinc-100" />
          <span className="text-[9px] font-medium tracking-tight truncate">{t("ui.settingsTitle") || "Opzioni"}</span>
        </Link>
      </div>

      {/* Right Floating Circular Action Button (Install Hub) */}
      <Link
        href="/install"
        title="Install Hub"
        className={`mobile-dock-action group flex items-center justify-center ${isInstallActive ? "ring-2 ring-amber-400" : ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- custom icon */}
        <img src="/icon/install-hub.webp" alt="Install Hub" className="w-5 h-5 object-contain brightness-0 invert group-active:scale-90 transition-transform" />
      </Link>
    </nav>
  )
}
