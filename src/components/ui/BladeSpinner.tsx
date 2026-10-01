"use client"

import React from "react"

interface BladeSpinnerProps {
  className?: string
  size?: number | string
}

export function BladeSpinner({ className = "", size = "1em" }: BladeSpinnerProps) {
  const style = typeof size === "number" ? { fontSize: `${size}px` } : { fontSize: size }
  return (
    <div className={`spinner ${className}`} style={style} role="status" aria-label="Loading">
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
      <div className="spinner-blade" />
    </div>
  )
}
