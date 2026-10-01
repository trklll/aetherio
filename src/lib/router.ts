"use client"

export type View = "edit" | "search" | "myposters" | "cataloghi"

/**
 * API di navigazione centralizzata. Tutte le transizioni di view passano da
 * qui (push/replace/back), così il history stack e il popstate di useNavigation
 * restano coerenti e i componenti non chiamano più direttamente window.history.
 */
export function pushView(view: View, extra?: Record<string, unknown>): void {
  let targetUrl = window.location.href
  if (view === "edit" && extra?.item) {
    const item = extra.item as { id: number; media_type: string }
    if (item.id && item.media_type) {
      targetUrl = `/${item.media_type}/${item.id}`
    }
  }
  window.history.pushState({ view, ...extra }, "", targetUrl)
}

export function replaceView(view: View, extra?: Record<string, unknown>): void {
  let targetUrl = window.location.href
  if (view === "edit" && extra?.item) {
    const item = extra.item as { id: number; media_type: string }
    if (item.id && item.media_type) {
      targetUrl = `/${item.media_type}/${item.id}`
    }
  }
  window.history.replaceState({ view, ...extra }, "", targetUrl)
}

export function goBack(): void {
  window.history.back()
}
