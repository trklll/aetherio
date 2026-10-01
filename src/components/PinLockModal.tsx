"use client"

import React, { useState, useEffect, useRef } from "react"
import { Lock, ShieldAlert, Eye, EyeOff, ArrowRight, KeyRound } from "lucide-react"
import { useT } from "@/lib/contexts/TranslationContext"
import { BladeSpinner } from "@/components/ui/BladeSpinner"

interface PinLockModalProps {
  onSuccess: () => void
}

export function PinLockModal({ onSuccess }: PinLockModalProps) {
  const { t } = useT()
  const [pin, setPin] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Focus input on mount
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!pin || pin.trim().length === 0 || loading) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: pin.trim() }),
      })

      if (res.ok) {
        onSuccess()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || t("ui.pinLockWrong") || "Incorrect Admin Password / PIN")
        setShake(true)
        setTimeout(() => setShake(false), 500)
        setPin("")
        inputRef.current?.focus()
      }
    } catch {
      setError(t("ui.pinConnError") || "Connection error. Please try again.")
      setShake(true)
      setTimeout(() => setShake(false), 500)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-2xl animate-fade-in select-none">
      {/* Background Ambient Aura Light */}
      <div className="absolute w-72 h-72 rounded-full bg-amber-500/10 blur-[100px] pointer-events-none -z-10 animate-pulse" />

      <div
        className={`w-full max-w-md rounded-3xl bg-[#121216]/90 border border-white/10 p-6 sm:p-8 shadow-2xl shadow-black/90 flex flex-col items-center text-center backdrop-blur-3xl relative overflow-hidden transition-transform duration-150 ${
          shake ? "animate-shake" : ""
        }`}
      >
        {/* Top Accent Bar Glow */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />

        {/* Lock Icon Header */}
        <div className="relative mb-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 via-orange-500/15 to-amber-600/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-500/10">
            <Lock className="w-7 h-7" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
            <KeyRound className="w-3 h-3" />
          </div>
        </div>

        {/* Titles */}
        <h2 className="text-xl font-bold tracking-tight text-white mb-1.5 flex items-center gap-2">
          <span>Protected Workspace</span>
        </h2>
        <p className="text-xs text-zinc-400 max-w-xs mb-6 leading-relaxed">
          Enter your Admin Password or PIN to unlock SpatialPosters studio controls.
        </p>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="relative flex items-center">
            <input
              ref={inputRef}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value)
                setError(null)
              }}
              placeholder="Enter Admin Password..."
              className="w-full pl-4 pr-11 py-3.5 rounded-2xl bg-black/50 border border-white/12 text-white placeholder-zinc-500 text-sm font-medium focus:outline-none focus:border-amber-500/60 focus:ring-2 focus:ring-amber-500/20 transition-all shadow-inner"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-3.5 p-1 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="flex items-center justify-center gap-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 font-medium animate-fade-in">
              <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Unlock Submit Button */}
          <button
            type="submit"
            disabled={!pin.trim() || loading}
            className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-orange-500 text-zinc-950 font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 hover:brightness-105 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer border border-amber-300/40"
          >
            {loading ? (
              <BladeSpinner size="18px" />
            ) : (
              <>
                <span>Unlock Workspace</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
