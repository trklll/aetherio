"use client"

export interface PosterTab {
  key: string
  label: string
  count: number
}

/**
 * Tab di selezione del gruppo poster (Clean / lingua). Estrazione da
 * PosterOptions per riuso e leggibilità: puro render, nessuna logica.
 */
export function PosterTabs({
  tabs,
  activeGroup,
  onSelect,
}: {
  tabs: PosterTab[]
  activeGroup: string
  onSelect: (key: string) => void
}) {
  if (tabs.length <= 1) return null
  return (
    <div className="flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl shadow-inner overflow-x-auto scrollbar-none scroll-fade-mask w-full min-w-0">
      {tabs.map((tab) => (
        <button
          type="button"
          aria-label={tab.label}
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          className={`tab-chip h-auto min-h-[30px] px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center gap-1 shrink-0 whitespace-nowrap ${
            activeGroup === tab.key
              ? "tab-chip-active bg-zinc-100 text-zinc-950 shadow-md shadow-white/10 border border-white/80"
              : "text-zinc-400 hover:text-zinc-100 border-transparent bg-transparent"
          }`}
        >
          <span>{tab.label}</span>
          <span className={`text-[10px] font-semibold opacity-75 ${activeGroup === tab.key ? "text-zinc-800" : "text-zinc-500"}`}>{tab.count}</span>
        </button>
      ))}
    </div>
  )
}
