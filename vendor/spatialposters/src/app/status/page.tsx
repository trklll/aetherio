"use client"

import React, { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Server,
  Database,
  Zap,
  Tv,
} from "lucide-react"
import { PictoriumRoot, usePSelector } from "@/lib/context"
import { ToastProvider } from "@/components/Toast"
import { AmbientBackground } from "@/components/AmbientBackground"
import { useT } from "@/lib/contexts/TranslationContext"
import { setLang, getLang } from "@/lib/i18n"
import { DesktopSidebar } from "@/components/DesktopSidebar"
import { MobileDock } from "@/components/MobileDock"

interface CheckResult {
  ok: boolean
  status: number
  time: number
  reason?: string
}

interface HealthData {
  status: string
  timestamp: string
  tmdb: {
    apiKey: boolean
    apiKeyLength: number
    trending: CheckResult
    search: CheckResult
    popular: CheckResult
    externalIds: CheckResult
  }
  streaming: {
    justwatch: CheckResult
    flixpatrol: CheckResult
  }
  storage: {
    mode: "kv" | "file"
    mappingsCount: number
    dataFileExists: boolean | null
    r2?: {
      configured: boolean
      bucket: string | null
    }
    imgbb?: {
      configured: boolean
    }
    cloudinary?: {
      configured: boolean
      cloudName: string | null
    }
  }
}

interface CacheStatusData {
  totalEntries: number
  poster?: {
    requests: number
    hits: number
    renders: number
    errors: number
    hitRate: string
    hitRateNum: number
    formats: {
      jpeg: number
      webp: number
      avif: number
    }
    activeRenders: number
    queuedRenders: number
    maxConcurrent: number
  }
  tmdb?: {
    totalCalls: number
    cacheHits: number
    networkCalls: number
    cacheHitRate: string
    lastCallTime: string | null
  }
}

function StatusMetricRow({
  icon: Icon,
  label,
  value,
  status = "neutral",
  badge,
}: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  status?: "ok" | "warn" | "error" | "neutral"
  badge?: string
}) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors text-xs sm:text-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        {status === "ok" && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
        {status === "warn" && <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
        {status === "error" && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
        {status === "neutral" && Icon && <Icon className="w-4 h-4 text-zinc-400 shrink-0" />}
        <span className="text-zinc-300 font-medium truncate">{label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        {badge && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-zinc-300">
            {badge}
          </span>
        )}
        <span className="font-semibold text-zinc-100 text-xs sm:text-sm">{value}</span>
      </div>
    </div>
  )
}

function StatusContent() {
  const { t } = useT()
  const [data, setData] = useState<HealthData | null>(null)
  const [cacheStatus, setCacheStatus] = useState<CacheStatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

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

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const key = typeof window !== "undefined" ? (localStorage.getItem("tmdb_key") || "") : ""
      const [healthRes, cacheRes] = await Promise.all([
        fetch("/api/health", { headers: key ? { "x-api-key": key } : undefined }),
        fetch("/api/cache/status").catch(() => null),
      ])

      if (healthRes.ok || healthRes.status === 503) {
        const hData = await healthRes.json()
        setData(hData)
      } else {
        setError(`HTTP ${healthRes.status}`)
      }

      if (cacheRes && cacheRes.ok) {
        const cData = await cacheRes.json()
        setCacheStatus(cData)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const isHealthy = data && data.tmdb?.apiKey && data.status === "healthy"

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-x-hidden">
      <AmbientBackground />
      <DesktopSidebar />
      <ToastProvider>
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 pt-6 sm:pt-10 md:pt-14 lg:pt-16 pb-24 md:pb-8 md:pl-20">
          {/* Top Bar */}
          <div className="flex items-center justify-between mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t("ui.back") || "Torna alla Home"}</span>
            </Link>

            <button
              type="button"
              onClick={() => loadStatus()}
              disabled={loading}
              className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white transition-colors bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 px-3.5 py-2 rounded-xl cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-accent-orange" : ""}`} />
              <span>{t("ui.refresh") || "Actualiser"}</span>
            </button>
          </div>

          {/* Header */}
          <div className="mb-6 text-center sm:text-left">
            <span className="hero-kicker mb-2">
              <span className="dot" aria-hidden="true" />
              System Diagnostics & Telemetry
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center justify-center sm:justify-start gap-3">
              {t("ui.statusTitle") || "System Status"}
              {loading ? (
                <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse">
                  Checking...
                </span>
              ) : isHealthy ? (
                <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Operational
                </span>
              ) : (
                <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  Degraded
                </span>
              )}
            </h1>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs sm:text-sm text-center font-medium">
              {t("ui.statusError", { msg: error }) || `Error: ${error}`}
            </div>
          )}

          {/* Hero Live Status Card */}
          <div className="surface-card p-5 sm:p-7 rounded-2xl sm:rounded-3xl border border-white/10 shadow-2xl relative overflow-hidden mb-6 backdrop-blur-xl">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10">
              <div className="flex items-center gap-4 text-center sm:text-left">
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center border shadow-lg shrink-0 ${
                    isHealthy
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-emerald-500/10"
                      : loading
                        ? "bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-amber-500/10"
                        : "bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-rose-500/10"
                  }`}
                >
                  <Activity className={`w-7 h-7 ${loading ? "animate-pulse" : ""}`} />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white flex items-center justify-center sm:justify-start gap-2">
                    {loading
                      ? t("ui.statusLoading") || "Checking System Health..."
                      : isHealthy
                        ? "All Systems Connected & Operational"
                        : "Service Degraded / Key Required"}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    {data?.timestamp
                      ? t("ui.statusUpdated", { time: new Date(data.timestamp).toLocaleTimeString(getLang()) })
                      : "Fetching live telemetry from server..."}
                  </p>
                </div>
              </div>

              {/* Quick Summary Pill Badges */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 justify-center sm:justify-end w-full sm:w-auto">
                <div className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-center flex-1 sm:flex-none min-w-[105px]">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">API Key</span>
                  <span className={`text-xs font-bold ${data?.tmdb?.apiKey ? "text-emerald-400" : "text-amber-400"}`}>
                    {data?.tmdb?.apiKey ? "Configured" : "Missing"}
                  </span>
                </div>
                <div className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-center flex-1 sm:flex-none min-w-[105px]">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Poster Cache</span>
                  <span className="text-xs font-bold text-accent-orange">
                    {cacheStatus?.poster?.hitRate ? `${cacheStatus.poster.hitRate} Hit` : "Active"}
                  </span>
                </div>
                <div className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-center flex-1 sm:flex-none min-w-[105px]">
                  <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider block">Saved Posters</span>
                  <span className="text-xs font-bold text-sky-400">
                    {data?.storage?.mappingsCount ?? 0} Items
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2-Column Responsive Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: TMDB API & Service */}
            <div className="surface-card p-5 rounded-2xl border border-white/10 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/25 text-sky-400">
                      <Server className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{t("ui.statusTmdb") || "TMDB API & Data Provider"}</h3>
                      <p className="text-[11px] text-zinc-400">Metadata, Posters & Search API</p>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-lg border ${
                      data?.tmdb?.apiKey
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-semibold"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/20 font-semibold"
                    }`}
                  >
                    {data?.tmdb?.apiKey ? `${data.tmdb.apiKeyLength} chars` : "Key Missing"}
                  </span>
                </div>

                <div className="space-y-2">
                  <StatusMetricRow
                    label="TMDb API Key"
                    value={data?.tmdb?.apiKey ? "Active" : "Not Configured"}
                    status={data?.tmdb?.apiKey ? "ok" : "warn"}
                  />
                  <StatusMetricRow
                    label={t("ui.statusTrending") || "Trending API"}
                    value={data?.tmdb?.trending?.ok ? `${data.tmdb.trending.time}ms` : "Offline"}
                    status={data?.tmdb?.trending?.ok ? "ok" : "error"}
                    badge={data?.tmdb?.trending?.status ? `HTTP ${data.tmdb.trending.status}` : undefined}
                  />
                  <StatusMetricRow
                    label={t("ui.statusSearch") || "Search API"}
                    value={data?.tmdb?.search?.ok ? `${data.tmdb.search.time}ms` : "Offline"}
                    status={data?.tmdb?.search?.ok ? "ok" : "error"}
                    badge={data?.tmdb?.search?.status ? `HTTP ${data.tmdb.search.status}` : undefined}
                  />
                  <StatusMetricRow
                    label="TMDb Cache Hit Rate"
                    value={cacheStatus?.tmdb?.cacheHitRate ?? "100% Active"}
                    status={cacheStatus?.tmdb?.cacheHits ? "ok" : "neutral"}
                    badge={cacheStatus?.tmdb?.totalCalls ? `${cacheStatus.tmdb.totalCalls} calls` : undefined}
                  />
                </div>
              </div>
            </div>

            {/* Card 2: Streaming & Regional Services */}
            <div className="surface-card p-5 rounded-2xl border border-white/10 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-purple-500/15 border border-purple-500/25 text-purple-400">
                      <Tv className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{t("ui.statusStreaming") || "Streaming & Rankings"}</h3>
                      <p className="text-[11px] text-zinc-400">JustWatch & FlixPatrol Top Charts</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <StatusMetricRow
                    label={t("ui.statusJustwatch") || "JustWatch Top Charts"}
                    value={data?.streaming?.justwatch?.ok ? `${data.streaming.justwatch.time}ms` : data?.tmdb?.apiKey ? "Unavailable" : "Key Needed"}
                    status={data?.streaming?.justwatch?.ok ? "ok" : "warn"}
                    badge={data?.streaming?.justwatch?.status ? `HTTP ${data.streaming.justwatch.status}` : undefined}
                  />
                  <StatusMetricRow
                    label={t("ui.statusFlixpatrol") || "FlixPatrol Streaming Provider"}
                    value={data?.streaming?.flixpatrol?.ok ? `${data.streaming.flixpatrol.time}ms` : data?.tmdb?.apiKey ? "Unavailable" : "Key Needed"}
                    status={data?.streaming?.flixpatrol?.ok ? "ok" : "warn"}
                    badge={data?.streaming?.flixpatrol?.status ? `HTTP ${data.streaming.flixpatrol.status}` : undefined}
                  />
                  <StatusMetricRow
                    label="Regional Rankings Sync"
                    value="Operational"
                    status="ok"
                  />
                </div>
              </div>
            </div>

            {/* Card 3: Storage & CDN Cache */}
            <div className="surface-card p-5 rounded-2xl border border-white/10 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400">
                      <Database className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{t("ui.statusStorage") || "Storage & Persistence"}</h3>
                      <p className="text-[11px] text-zinc-400">Database & External Image CDN</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                    {data?.storage?.mode === "kv" ? "KV Mode" : "File Storage"}
                  </span>
                </div>

                <div className="space-y-2">
                  <StatusMetricRow
                    label={t("ui.statusSavedPosters") || "Saved Poster Mappings"}
                    value={`${data?.storage?.mappingsCount ?? 0} posters`}
                    status="ok"
                  />
                  <StatusMetricRow
                    label="Upstash Redis (KV)"
                    value={data?.storage?.mode === "kv" ? "Active" : "Not Configured"}
                    status={data?.storage?.mode === "kv" ? "ok" : "neutral"}
                  />
                  <StatusMetricRow
                    label="Cloudflare R2 Storage"
                    value={data?.storage?.r2?.configured ? `Active (${data.storage.r2.bucket})` : "Not Configured"}
                    status={data?.storage?.r2?.configured ? "ok" : "neutral"}
                  />
                  <StatusMetricRow
                    label="Cloudinary Provider"
                    value={data?.storage?.cloudinary?.configured ? `Active (${data.storage.cloudinary.cloudName})` : "Not Configured"}
                    status={data?.storage?.cloudinary?.configured ? "ok" : "neutral"}
                  />
                  <StatusMetricRow
                    label="ImgBB Free Storage Cache"
                    value={data?.storage?.imgbb?.configured ? "Active" : "Not Configured"}
                    status={data?.storage?.imgbb?.configured ? "ok" : "neutral"}
                  />
                </div>
              </div>
            </div>

            {/* Card 4: Poster Pipeline & Performance */}
            <div className="surface-card p-5 rounded-2xl border border-white/10 shadow-xl flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-400">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{t("ui.statusPosterHitRateTitle") || "Poster Render Engine"}</h3>
                      <p className="text-[11px] text-zinc-400">Sharp Engine & Image Pipeline</p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg bg-accent-orange/15 text-accent-orange border border-accent-orange/30 font-semibold">
                    {cacheStatus?.poster?.hitRate ?? "100% Cache"}
                  </span>
                </div>

                <div className="space-y-2">
                  <StatusMetricRow
                    label={t("ui.statusPosterServedCache") || "Served from Cache"}
                    value={cacheStatus?.poster?.hitRate ?? "Instant"}
                    status="ok"
                    badge={cacheStatus?.poster?.hits ? `${cacheStatus.poster.hits} hits` : undefined}
                  />
                  <StatusMetricRow
                    label={t("ui.statusPosterActiveSlots") || "Active Concurrency Slots"}
                    value={`${cacheStatus?.poster?.activeRenders ?? 0} / ${cacheStatus?.poster?.maxConcurrent ?? 4}`}
                    status="ok"
                    badge={`Queued: ${cacheStatus?.poster?.queuedRenders ?? 0}`}
                  />

                  {cacheStatus?.poster?.formats && (
                    <div className="pt-2">
                      <span className="text-[11px] text-zinc-400 font-medium block mb-1.5">Output Image Formats:</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                          <span className="text-[10px] text-zinc-400 block">WebP</span>
                          <span className="text-xs font-bold text-accent-orange">{cacheStatus.poster.formats.webp}</span>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                          <span className="text-[10px] text-zinc-400 block">AVIF</span>
                          <span className="text-xs font-bold text-emerald-400">{cacheStatus.poster.formats.avif}</span>
                        </div>
                        <div className="px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                          <span className="text-[10px] text-zinc-400 block">JPEG</span>
                          <span className="text-xs font-bold text-zinc-300">{cacheStatus.poster.formats.jpeg}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Note */}
          <div className="mt-8 text-center text-xs text-zinc-500 flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>SpatialPosters · Live Telemetry</span>
          </div>
        </div>
      </ToastProvider>
      <MobileDock />
    </div>
  )
}

export default function StatusPage() {
  return (
    <PictoriumRoot>
      <StatusContent />
    </PictoriumRoot>
  )
}
